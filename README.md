# AutoClip & Collage Studio

A self-hosted auto-clipping and collage builder. The current foundation provides health, upload
presigning, job status, and placeholder workers; media processing is not yet implemented.

## Prerequisites

- Node.js LTS and npm
- Docker with Compose
- FFmpeg and ffprobe on PATH

## Start locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set appropriate credentials and secrets.
3. Run `docker compose up -d`, then `npm run db:migrate`.
4. Create an API key with `npm run create-key -- smoke`. Save the key securely; it is shown once.
5. In separate terminals run `npm run worker` and `npm run dev`.
6. Visit `http://localhost:3000` or check `http://localhost:3000/api/health`.
7. Run `npm run smoke -- <api-key>` to enqueue a placeholder job and wait for it to succeed.
8. Open `http://localhost:3000/collages` to build a collage in the browser. The API key you enter is
   held only in page memory.

Browser end-to-end tests mock the API and object store: run `npx playwright install chromium`
once, then `npm run e2e`.

See [docs/api.md](docs/api.md) for the available API and webhook contract.
