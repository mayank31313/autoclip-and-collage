import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">AutoClip &amp; Collage Studio</h1>
      <p className="mt-2 text-muted-foreground">
        Self-hosted auto-clipping and collage builder. See <code>docs/api.md</code> for the API.
      </p>
      <nav className="mt-4 flex flex-col items-start gap-2">
        <Link className="underline" href="/collages">
          Create a collage
        </Link>
        <a className="underline" href="/api/health">
          Service health
        </a>
      </nav>
    </main>
  );
}
