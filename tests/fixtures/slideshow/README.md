# Slideshow test fixtures

No binary fixtures are checked into this directory. The slideshow renderer and
processor tests generate tiny source media at runtime instead, to keep the
repository free of committed media and the test suite fast and deterministic:

- `tests/unit/slideshowRenderer.test.ts` writes tiny fake image/video files
  (via `node:fs/promises`) purely to exercise path handling; it stubs
  `runFfmpeg` so no real encoding happens.
- `tests/integration/slideshowProcessor.test.ts` generates a real ~1-2 second
  320x180 PNG (via `sharp`) and a real ~2 second 320x180 H.264 MP4 (via
  `ffmpeg -f lavfi -i testsrc=...`) in a temp directory during `beforeAll`,
  then runs the real renderer/processor against them (with fake
  asset-repository/storage dependencies) and verifies the rendered
  master/slide outputs and zip with `ffprobe`.

If you need to add a larger or more realistic fixture in the future, prefer
generating it at test runtime (as above) over committing new binary files
here, unless a specific regression requires a byte-for-byte checked-in file.
