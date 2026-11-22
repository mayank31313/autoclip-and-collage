import { describe, expect, it } from "vitest";
import { overlapRatio, rotatedBounds } from "@/lib/planner/collage/polaroid/geometry";
import { planPaper } from "@/lib/planner/collage/polaroid/paper";
import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";
import { framePieces, windowAspect } from "@/lib/planner/collage/polaroid/frame";
import { defaultSlideCount, slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { validatePolaroidSpec } from "@/lib/planner/collage/polaroid/validate";
import { POLAROID_TEMPLATE_IDS } from "@/lib/planner/collage/polaroid/templates";
import { PolaroidSpec } from "@/lib/schemas/polaroid";
import { createRng, hashStrings } from "@/lib/utils/rng";

const images = (count: number, prefix = "a") =>
  Array.from({ length: count }, (_, i) => ({
    assetId: `${prefix}${i}`,
    caption: i % 2 === 1 ? `cap ${i}` : "",
  }));

describe("rng", () => {
  it("repeats a seed's sequence and stays in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const first = Array.from({ length: 50 }, () => a());
    expect(first).toEqual(Array.from({ length: 50 }, () => b()));
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(first[0]);
  });

  it("hashes the ordered ids", () => {
    expect(hashStrings(["a", "b"])).toBe(hashStrings(["a", "b"]));
    expect(hashStrings(["a", "b"])).not.toBe(hashStrings(["b", "a"]));
    expect(hashStrings(["a", "b"])).not.toBe(hashStrings(["ab"]));
  });
});

describe("geometry", () => {
  it("returns the frame itself when unrotated", () => {
    expect(rotatedBounds({ x: 10, y: 20, w: 100, h: 200, rotationDeg: 0 })).toEqual({
      x0: 10,
      y0: 20,
      x1: 110,
      y1: 220,
    });
  });

  it("swaps width and height at 90 degrees about the centre", () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 100, h: 200, rotationDeg: 90 });
    expect([b.x0, b.y0, b.x1, b.y1].map(Math.round)).toEqual([-50, 50, 150, 150]);
  });

  it("measures overlap against the smaller box", () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(overlapRatio(a, { x0: 20, y0: 0, x1: 30, y1: 10 })).toBe(0);
    expect(overlapRatio(a, { x0: 0, y0: 0, x1: 5, y1: 5 })).toBe(1);
    expect(overlapRatio(a, { x0: 5, y0: 0, x1: 15, y1: 10 })).toBeCloseTo(0.5);
  });
});

describe("slide counts", () => {
  it("derives about three images per slide within 2..10", () => {
    expect([1, 6, 7, 20, 60].map(defaultSlideCount)).toEqual([2, 2, 3, 7, 10]);
  });

  it("explains combinations that cannot work", () => {
    expect(slideCountProblem(1, 2)).toBe("2 slides need at least 2 images");
    expect(slideCountProblem(13, 2)).toBe("2 slides hold at most 12 images");
    expect(slideCountProblem(2, 2)).toBeNull();
    expect(slideCountProblem(12, 2)).toBeNull();
  });
});

describe("planPaper", () => {
  const spread = { w: 3240, h: 1350 };

  it("is deterministic for a seed", () => {
    expect(planPaper(spread, 7, createRng(7))).toEqual(planPaper(spread, 7, createRng(7)));
    expect(planPaper(spread, 7, createRng(7))).not.toEqual(planPaper(spread, 8, createRng(8)));
  });

  it("keeps a torn sheet strictly inside the spread", () => {
    const { sheet } = planPaper(spread, 7, createRng(7));
    expect(sheet.outline.length).toBeGreaterThan(400);
    for (const [x, y] of sheet.outline) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(spread.w);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(spread.h);
    }
  });

  it("punches binding holes along the top margin", () => {
    const { page } = planPaper(spread, 7, createRng(7));
    expect(page.holes.xs).toHaveLength(Math.floor(spread.w / 90));
    expect(Math.max(...page.holes.xs)).toBeLessThan(spread.w);
  });
});

describe("planPolaroidCarousel", () => {
  it("sizes the spread from the slide count and aspect", () => {
    const portrait = planPolaroidCarousel({ images: images(4), slideCount: 2, slideAspect: "4:5" });
    expect(portrait.spread).toEqual({ w: 2160, h: 1350 });
    expect(portrait.slide).toEqual({ w: 1080, h: 1350, count: 2 });
    const square = planPolaroidCarousel({ images: images(4), slideCount: 3, slideAspect: "1:1" });
    expect(square.spread).toEqual({ w: 3240, h: 1080 });
  });

  it("places every image once, left to right, keeping captions", () => {
    const spec = planPolaroidCarousel({ images: images(5), slideCount: 2, slideAspect: "4:5" });
    expect(spec.polaroids.map((p) => p.image)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(spec.polaroids.map((p) => p.caption)).toEqual(["", "cap 1", "", "cap 3", ""]);
    const centres = spec.polaroids.map((p) => p.x + p.w / 2);
    expect(centres).toEqual([...centres].sort((a, b) => a - b));
  });

  it("is deterministic and depends on the image ids", () => {
    const input = { images: images(6), slideCount: 3, slideAspect: "4:5" } as const;
    expect(planPolaroidCarousel(input)).toEqual(planPolaroidCarousel(input));
    const other = planPolaroidCarousel({ ...input, images: images(6, "b") });
    const tilts = (spec: PolaroidSpec) => spec.polaroids.map((p) => p.rotationDeg);
    expect(tilts(other)).not.toEqual(tilts(planPolaroidCarousel(input)));
  });

  it("lets a polaroid straddle a slide seam", () => {
    const spec = planPolaroidCarousel({ images: images(6), slideCount: 2, slideAspect: "4:5" });
    expect(spec.polaroids.some((p) => p.x < 1080 && p.x + p.w > 1080)).toBe(true);
  });

  it("alternates sizes and upper and lower bands", () => {
    const spec = planPolaroidCarousel({ images: images(6), slideCount: 2, slideAspect: "4:5" });
    const [p0, p1, p2] = spec.polaroids;
    expect(p0 && p1 && p0.y + p0.h / 2 < p1.y + p1.h / 2).toBe(true);
    expect(p0 && p2 && p2.w < p0.w).toBe(true);
  });

  it("sizes each frame's photo window to its photo's shape", () => {
    const frameFor = (aspect: number | undefined) => {
      const input = { images: images(4), slideCount: 2, slideAspect: "4:5" } as const;
      const withAspect = input.images.map((i) => ({ ...i, aspect }));
      const first = planPolaroidCarousel({ ...input, images: withAspect }).polaroids[0];
      if (!first) throw new Error("missing polaroid");
      const { photoW, photoH } = framePieces(first.w, first.h);
      return { photoW, photoH, w: first.w, h: first.h };
    };
    const square = frameFor(undefined);
    expect(square.photoW / square.photoH).toBeCloseTo(1, 1);
    const portrait = frameFor(2 / 3);
    expect(portrait.photoW / portrait.photoH).toBeCloseTo(2 / 3, 1);
    expect(portrait.h / portrait.w).toBeGreaterThan(square.h / square.w);
    const landscape = frameFor(3 / 2);
    expect(landscape.photoW / landscape.photoH).toBeCloseTo(3 / 2, 1);
    expect(landscape.h / landscape.w).toBeLessThan(square.h / square.w);
  });

  it("limits the window's shape for panoramas so frames stay a sensible size", () => {
    expect(windowAspect(5)).toBe(2);
    expect(windowAspect(0.1)).toBe(0.5);
    expect(windowAspect(undefined)).toBe(1);
    expect(windowAspect(Number.NaN)).toBe(1);
  });

  it("makes polaroids larger than before", () => {
    const spec = planPolaroidCarousel({ images: images(6), slideCount: 2, slideAspect: "4:5" });
    expect(Math.max(...spec.polaroids.map((p) => p.w))).toBeGreaterThan(432);
  });

  it("splits images evenly across slides by default", () => {
    const spec = planPolaroidCarousel({ images: images(5), slideCount: 2, slideAspect: "4:5" });
    const onSlide = (s: number) =>
      spec.polaroids.filter((p) => Math.floor((p.x + p.w / 2) / 1080) === s).length;
    expect([onSlide(0), onSlide(1)]).toEqual([3, 2]);
  });

  it("puts the requested number of images on each slide", () => {
    const spec = planPolaroidCarousel({
      images: images(6),
      slideCount: 3,
      slideAspect: "4:5",
      imagesPerSlide: [1, 4, 1],
    });
    const slides = spec.polaroids.map((p) => Math.floor((p.x + p.w / 2) / 1080));
    expect(slides).toEqual([0, 1, 1, 1, 1, 2]);
  });

  it("sizes polaroids per slide", () => {
    const base = {
      images: images(4),
      slideCount: 2,
      slideAspect: "4:5",
      template: "tidy",
    } as const;
    const widths = (slideSizes: Array<"small" | "medium" | "large">) =>
      planPolaroidCarousel({ ...base, slideSizes }).polaroids.map((p) => p.w);
    const [a0, a1, a2, a3] = widths(["small", "large"]);
    expect(a0).toBe(a1);
    expect(a2).toBe(a3);
    expect(a0).toBeLessThan(a2 ?? 0);
    const medium = widths(["medium", "medium"])[0] ?? 0;
    expect(medium).toBeGreaterThan(a0 ?? 0);
    expect(medium).toBeLessThan(a2 ?? 0);
  });

  it("plans a large slide beside a crowded small one without invalid overlap", () => {
    const spec = planPolaroidCarousel({
      images: images(7),
      slideCount: 2,
      slideAspect: "4:5",
      template: "spotlight",
      imagesPerSlide: [1, 6],
      slideSizes: ["large", "small"],
    });
    expect(spec.polaroids).toHaveLength(7);
  });

  it("defaults to the scatter template", () => {
    const input = { images: images(6), slideCount: 2, slideAspect: "4:5" } as const;
    expect(planPolaroidCarousel({ ...input, template: "scatter" })).toEqual(
      planPolaroidCarousel(input),
    );
  });

  it("lays out each template differently", () => {
    const input = { images: images(6), slideCount: 2, slideAspect: "4:5" } as const;
    const layouts = POLAROID_TEMPLATE_IDS.map((template) =>
      JSON.stringify(planPolaroidCarousel({ ...input, template }).polaroids),
    );
    expect(new Set(layouts).size).toBe(POLAROID_TEMPLATE_IDS.length);
  });

  it("spotlight makes every third polaroid the largest and centred", () => {
    const spec = planPolaroidCarousel({
      images: images(6),
      slideCount: 2,
      slideAspect: "4:5",
      template: "spotlight",
    });
    const [p0, p1, p2, p3] = spec.polaroids;
    expect(p0 && p1 && p2 && p3).toBeTruthy();
    expect(p0?.w).toBeGreaterThan(p1?.w ?? 0);
    expect(p3?.w).toBe(p0?.w);
    const mid = spec.spread.h / 2;
    expect(Math.abs((p0?.y ?? 0) + (p0?.h ?? 0) / 2 - mid)).toBeLessThan(40);
  });
});

describe("validatePolaroidSpec", () => {
  const spec = planPolaroidCarousel({ images: images(4), slideCount: 2, slideAspect: "4:5" });
  const messages = (candidate: unknown) =>
    validatePolaroidSpec(candidate as PolaroidSpec).map((issue) => issue.message);

  it("accepts a planned spec", () => {
    expect(messages(spec)).toEqual([]);
  });

  it("rejects a polaroid outside the spread", () => {
    const polaroids = spec.polaroids.map((p, i) => (i === 0 ? { ...p, x: -200 } : p));
    expect(messages({ ...spec, polaroids })).toContain("polaroid extends outside the spread");
  });

  it("rejects a reused image", () => {
    const polaroids = spec.polaroids.map((p, i) => (i === 1 ? { ...p, image: "a0" } : p));
    expect(messages({ ...spec, polaroids })).toContain("image is used more than once");
  });

  it("rejects an empty slide", () => {
    const polaroids = spec.polaroids.slice(0, 1);
    expect(messages({ ...spec, polaroids })).toContain("slide 2 has no polaroid");
  });

  it("rejects heavily stacked polaroids", () => {
    const [first, second] = spec.polaroids;
    if (!first || !second) throw new Error("fixture needs two polaroids");
    const polaroids = [first, { ...second, x: first.x, y: first.y }];
    expect(messages({ ...spec, polaroids }).join()).toContain("overlaps polaroid 0 too much");
  });

  it("rejects a spec whose slide sizes disagree with the spread", () => {
    expect(messages({ ...spec, slide: { ...spec.slide, count: 3 } })).toContain(
      "slide width times count must equal spread width",
    );
  });

  it("is enforced by the schema", () => {
    expect(PolaroidSpec.safeParse(spec).success).toBe(true);
    const polaroids = spec.polaroids.map((p, i) => (i === 0 ? { ...p, x: -200 } : p));
    expect(PolaroidSpec.safeParse({ ...spec, polaroids }).success).toBe(false);
  });
});
