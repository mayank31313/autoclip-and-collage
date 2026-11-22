# Contributing

Thank you for helping improve AutoClip &amp; Collage Studio. Contributions should be small, reviewable, and covered by tests.

## Before you start

1. Check open issues and pull requests to avoid duplicate work.
2. Open an issue for a new feature, API shape, or behavior change.
3. Keep bug fixes and unrelated refactoring in separate pull requests.
4. Read the relevant Zod schemas and existing implementation before adding logic.

## Development setup

Install the prerequisites described in [README.md](README.md), then start the local dependencies and application:

```sh
npm install
docker compose up -d
npm run db:migrate
npm run worker
npm run dev
```

Create a local API key with:

```sh
npm run create-key -- local
```

## Repository conventions

- Use TypeScript in strict mode and avoid `any`.
- Use Zod contracts for API and media specifications.
- Keep planner code pure and deterministic. It must not perform I/O or import server-only modules.
- Keep Next.js route handlers thin and put long-running work in `worker/`.
- Use `@/` for imports from `src/`.
- Use FFmpeg argument arrays rather than shell commands.
- Add `import "server-only";` to server modules that must not reach the browser bundle.
- Keep comments focused on non-obvious reasoning.

## Development flow

1. Create a focused branch from the current main branch.
2. Make the smallest complete implementation.
3. Add or update tests with the code change.
4. Update directly related documentation and API contracts.
5. Run formatting and validation.
6. Open a pull request with a concise summary and verification evidence.

For layout changes, add Vitest and fast-check coverage for canvas bounds, overlap, image reuse, pinned cells, and deterministic output.

## Validation

Run the relevant checks before submitting:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run e2e
```

Browser tests require Chromium once:

```sh
npx playwright install chromium
```

Do not submit large media, model weights, credentials, presigned URLs, or secrets.

## Pull requests

A good pull request includes:

- The problem or requested behavior
- The implementation approach
- Files or APIs affected
- Tests run and their results
- Screenshots or sample output for visible UI changes

Keep the diff focused. Reviewers may request a split, tests, or documentation before merge.

## Reporting issues

Include the expected behavior, actual behavior, reproduction steps, runtime or browser version, and relevant request IDs or logs. Remove credentials and personal or private media first.

## Code of conduct

Contributions and discussions must follow the standards in [the README](README.md#code-of-conduct). Maintainers may remove contributions or restrict participation that does not meet those standards.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
