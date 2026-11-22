# AutoClip &amp; Collage Studio

AutoClip &amp; Collage Studio is a self-hosted media creation workspace for building polished photo collages, Polaroid-style spreads, and video slideshows. It combines a Next.js browser interface with asynchronous background workers, object storage, PostgreSQL, Redis, and FFmpeg.

The collage workflow is implemented and usable today. Long-video auto-clipping is the intended next major feature; the job infrastructure and API foundations are already in place.

## Features

- Justified-row, named-template, and custom-template photo collages
- Photo-wall arrangements with warm, gallery, midnight, and scrapbook presets
- Polaroid-style carousel spreads with four placement templates
- Video slideshows rendered from images
- Presigned browser uploads to S3-compatible MinIO storage
- API-key authentication and owner-scoped jobs
- Signed webhook delivery support
- Docker Compose deployment for the web app and worker

## Prerequisites

- Node.js LTS
- npm
- Docker with Compose
- FFmpeg and ffprobe on `PATH`

## Quick start

1. Install dependencies:
   ```sh
   npm install
   ```
2. Copy `.env.example` to `.env` and set the database, storage, queue, signing, and API-key values.
3. Start the infrastructure:
   ```sh
   docker compose up -d
   npm run db:migrate
   ```
4. Create an API key:
   ```sh
   npm run create-key -- local
   ```
   Save the key securely. It is displayed only once.
5. Run the worker and web app in separate terminals:
   ```sh
   npm run worker
   npm run dev
   ```
6. Visit [http://localhost:3000](http://localhost:3000), open [the collage studio](http://localhost:3000/collages), or check [service health](http://localhost:3000/api/health).

The browser stores an API key only in page memory. Browser end-to-end tests use mocked APIs and storage:

```sh
npx playwright install chromium
npm run e2e
```

See [docs/api.md](docs/api.md) for endpoints and the webhook contract.

## How it works

### 1. Upload

The browser requests a short-lived presigned upload URL from the Next.js API. The image or video is then sent directly to MinIO without passing the full media payload through the application server.

### 2. Plan

The API validates the request and creates an owner-scoped job. Pure TypeScript planners convert collage options into a layout specification:

- Aspect ratios determine justified-row or template placement.
- The Hungarian assignment algorithm matches images to slots.
- Polaroid geometry determines print positions, rotations, and slide boundaries.
- Slideshow options determine timing and transitions.

Pinned or preexisting layout decisions remain separate from final rendering decisions.

### 3. Queue

The API records the job in PostgreSQL and submits it to a BullMQ queue backed by Redis. Route handlers remain fast and do not execute FFmpeg or image processing inline.

### 4. Render

A separate worker loads the job, reads source objects from MinIO, and calls the appropriate renderer:

- Sharp renders grid, template, photo-wall, and Polaroid outputs.
- FFmpeg renders video slideshow output.
- The worker writes deterministic result objects back to storage.

### 5. Collect

The browser polls job status and progress. On success, it receives result URLs and can download or share the generated media. The job event or signed webhook also reports the final status to an integration.

## Design and Architecture

```text
Browser
  |
  | HTTP
  v
Next.js App Router + API routes
  |             |             |
  |             |             +--> MinIO (presigned uploads/results)
  |             +----------------> PostgreSQL (jobs/assets/delivery state)
  +-------------------------------> Redis + BullMQ
                                        |
                                        v
                                  Worker process
                                        |
                               +--------+--------+
                               |                 |
                              Sharp            FFmpeg
```

### Application structure

- `src/app/` - App Router pages and API route handlers
- `src/components/` - React and collage UI components
- `src/features/` - client hooks and form/API state
- `src/lib/schemas/` - Zod contracts and inferred TypeScript types
- `src/lib/planner/` - deterministic, isomorphic layout and slideshow logic
- `src/server/` - database, storage, queue, security, and rendering adapters
- `worker/` - BullMQ worker entry point and job processors
- `tests/` - unit, property, integration, and browser tests
- `docs/` - API documentation and implementation specifications

### Core design principle

The system separates creative decisions from media execution:

1. **Analyzer** extracts metadata and relevant features.
2. **Planner** converts those features into a validated JSON specification.
3. **Renderer** executes the specification without making layout or creative decisions.

This separation keeps browser previews predictable, worker retries idempotent, and layout logic testable outside image or video I/O.

### Processing guarantees

- Route handlers validate with Zod and return a consistent error envelope.
- Uploads are owner-scoped and large media bypasses Next.js.
- Jobs transition through queued, running, succeeded, failed, or cancelled states.
- Renderers use argument-array FFmpeg commands and sharp-based image processing.
- Webhooks use HMAC-SHA256 signatures with timestamp headers.
- Analysis and render work is retried safely by deterministic job keys and result paths.

## Development

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

Layout planners should include focused unit and property tests. The test suite uses Vitest and fast-check for pure logic, plus Playwright for browser workflows.

### GitHub Actions image publishing

Pull requests run lint, type-checking, tests, and build both production images without
publishing. Pushes to `main` publish `autoclip-server` and `autoclip-worker` to
`ghcr.io/<repository-owner>`, tagged with the commit SHA and `latest`. The server uses Next.js standalone
output; the worker includes FFmpeg and runs separately.

The workflow authenticates with `GITHUB_TOKEN` and requires permission to write
packages. Configure package visibility and access in GitHub as needed. See
[GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Code of Conduct

We want this project to be a respectful, inclusive, and constructive community.

- Be kind and assume good intent.
- Keep feedback specific, actionable, and focused on the work.
- Welcome contributors with different backgrounds and levels of experience.
- Do not publish private, confidential, or sensitive information.
- Do not harass, discriminate, threaten, or intentionally disrupt collaboration.
- Resolve disagreements through evidence, empathy, and a documented technical decision.

Maintainers may edit, reject, or remove contributions and discussions that violate these standards. Repeated or serious violations may result in a ban from participation.

## Collaboration

See [CONTRIBUTING.md](CONTRIBUTING.md) for the detailed development workflow and validation requirements.

### Before changing code

- Read the relevant Zod schemas and existing tests.
- Follow the planner/analyzer/renderer separation.
- Keep route handlers thin and move long-running work into the worker.
- Update API documentation whenever an API contract changes.
- Use the existing repository conventions and path alias `@/` for `src/`.

### Making a contribution

1. Create a focused branch for your change.
2. Add or update tests in the same change.
3. Run lint, type checking, tests, and the relevant build.
4. Open a pull request with the problem, implementation, and verification steps.
5. Respond to review constructively and keep the diff scoped.

Small bug fixes may be submitted directly. New media modes or API shapes should first be discussed in an issue or design document.

### Reporting issues

Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser or runtime version
- Relevant logs, request IDs, or screenshots

Remove credentials, presigned URLs, private media, and personal data before sharing evidence.

## Future Improvements

The project follows a staged roadmap:

1. Complete the auto-clipping MVP
   - Scene and transcript analysis
   - Speech, audio, motion, face, and quality scoring
   - Hook selection and maximal marginal relevance
   - FFmpeg clip rendering and burned-in captions
2. Add face and saliency-aware crops
   - Tracked 9:16 re-framing
   - Smooth crop paths
   - Focus-aware image placement
3. Expand collage editing
   - Interactive cell editing and pinning
   - Browser-side live relayout
   - Collage reverse-detection
4. Improve sequence media
   - Timeline and storyboard layouts
   - EXIF-aware ordering
   - Ken Burns slideshows with transitions
5. Strengthen platform operations
   - Authentication accounts and team ownership
   - Redis-backed public rate limits
   - GPU acceleration
   - Metrics, tracing, and stronger webhook observability

## License

This project is licensed under the [MIT License](LICENSE).
