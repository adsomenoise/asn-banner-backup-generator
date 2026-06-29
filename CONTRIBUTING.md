# Contributing

## Prerequisites

- Node.js 20+
- `npm install`
- `npx playwright install chromium`

Copy `.env.example` to `.env` before starting the server. Tests run without a `.env`.

## Development workflow

```bash
npm run serve:dev      # start server with --watch
npm test               # run all tests
npm run test:watch     # re-run tests on file changes
npm run lint           # ESLint check
npm run lint:fix       # auto-fix lint errors
npm run quality:gate   # lint + test (run before committing)
```

## Code conventions

- ES modules (`import`/`export`) throughout — no CommonJS.
- No TypeScript. Plain `.js` files.
- ESLint flat config (`eslint.config.js`). `src/public/**/*.js` uses `globals.browser`.
- No comments by default. Add one only when the *why* is non-obvious.
- No extra error handling, abstractions, or backwards-compat shims beyond what the task requires.

## Tests

Test files live in `test/` and mirror the source file they cover (`src/extractZip.js` → `test/extractZip.test.js`).

Uses the Node.js built-in `node:test` runner — no Jest or Vitest.

```bash
node --test                        # all tests
node --test test/extractZip.test.js # single file
```

Every new feature or bug fix should include tests. The quality gate (`npm run quality:gate`) must pass before committing.

## Adding a validator preset

1. Add the preset object to `src/validator/presets.js`.
2. Add the corresponding `<option>` to the `<select>` in `src/public/index.html` (the frontend list is hardcoded).
3. Add or update tests in `test/validatorChecks.test.js` and `test/validatorFrontend.test.js`.

## Environment variables

See `.env.example` for the full list. Key variables for local development:

| Variable | Value |
|---|---|
| `NODE_ENV` | `development` |
| `AUTH_MODE` | `development` |
| `PORT` | `3001` |

## Deployment

See [docs/release-runbook.md](docs/release-runbook.md) for the full deploy checklist. Briefly:

1. Run `npm run quality:gate`.
2. Build and push via Coolify using the `Dockerfile` (not Nixpacks auto-detect).
3. Verify the health endpoint: `GET /api/v1/health`.

## Architecture

See [CLAUDE.md](CLAUDE.md) for a detailed description of the request flow, key files, patterns, and known technical debt.
