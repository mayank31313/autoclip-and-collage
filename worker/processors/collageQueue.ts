import type { Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";
import { SLIDESHOW_JOB_TYPE } from "@/lib/schemas/slideshow";
import { buildCollageProcessor } from "./buildCollage";
import { buildPolaroidProcessor } from "./buildPolaroid";
import { buildSlideshowProcessor } from "./buildSlideshow";

type Processor = (job: Job<JobData>) => Promise<void>;

/**
 * The `collage` queue carries several job types; route each to its processor by type. `slideshow`
 * is optional so existing callers that only exercise grid/polaroid routing keep compiling; the
 * production dispatcher below always supplies all three.
 */
export function createCollageDispatcher(handlers: {
  grid: Processor;
  polaroid: Processor;
  slideshow?: Processor;
}): Processor {
  return (job) => {
    if (job.data.type === POLAROID_JOB_TYPE) return handlers.polaroid(job);
    if (job.data.type === SLIDESHOW_JOB_TYPE) {
      if (!handlers.slideshow) throw new Error("No slideshow processor configured");
      return handlers.slideshow(job);
    }
    return handlers.grid(job);
  };
}

export const collageDispatcher = createCollageDispatcher({
  grid: buildCollageProcessor,
  polaroid: buildPolaroidProcessor,
  slideshow: buildSlideshowProcessor,
});
