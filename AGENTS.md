# AGENTS.md

Internal tool: generates JPEG backup images from HTML5 banner ZIPs, `.riv` files, and videos (plus a secondary Ad Validator subsystem). Node 20+, Express, Playwright, Sharp. Plain ESM JavaScript — no TypeScript, no bundler.

## Commands

```bash
npm run quality:gate      # lint + test — MUST pass before committing (also what CI runs)
npm run lint              # eslint .
npm run lint:fix
npm test                  # node --test (all tests)
node --test test/extractZip.test.js   # single test file — no npm wrapper needed
npm run serve             # web server on :3001
npm run serve:dev         # with --watch
npm run generate          # CLI mode: input/ → output/
npm run preflight         # validate env for production start (serve:prod runs it)
```

CI (`.github/workflows/ci.yml`): Node 24, `npm ci`, `npx playwright install --with-deps chromium`, then `npm run lint` and `npm test`. There is no typecheck step.

## Setup quirks

- **No `.env` loading.** There is no `dotenv` dependency — nothing reads `.env` automatically. Every setting falls back to a code default; to override, export vars in the shell (`CAPTURE_CONCURRENCY=5 npm run serve`). `.env.example` documents production-only vars. (Ignore `CLAUDE.md`'s "copy `.env.example` to `.env`" line — it's stale.)
- `npm install` has a `postinstall` hook running `npx playwright install chromium`. Some tests launch a real headless Chromium (`test/frontendUi.test.js`, `test/validatorFrontend.test.js`), so tests fail if that was skipped (`--ignore-scripts`).

## Testing

- Node built-in `node:test` runner — no Jest/Vitest. Tests live in `test/` and mirror source names (`src/foo.js` → `test/foo.test.js`).
- Several tests start servers on port `0` and launch Playwright; the full suite takes a while but needs no external services.
- Tests write scratch dirs into the repo root (`test-temp-*`, including `test-temp-capute/`). These are eslint-ignored and disposable — don't commit them.

## Architecture

- `src/webServer.js` is the monolith: all Express routes, multer upload, job lifecycle, auth, rate limiting. Exported `startWebServer(port, opts)` is what tests boot.
- Two entrypoints: `src/webServer.js` (web UI/API) and `src/index.js` (CLI batch).
- Job flow: `POST /api/v1/jobs` (upload) → `POST /api/v1/jobs/:id/process` → `processJob()` runs **fire-and-forget** (no `await`); errors are written to job state, never to the HTTP response. Poll `GET /api/v1/jobs/:id`.
- Capture pipeline: extract ZIP → find entry HTML → detect banner size → Playwright screenshot (4 ordered strategies) → Sharp JPEG. `.riv` files get generated wrapper HTML; videos go through ffmpeg.
- Jobs are **in-memory only** (`InMemoryJobStore`) — restart = data loss. Runtime state lives under `temp/` (uploads → work → results), all path handling via `src/storage/LocalStorage.js`.
- API is versioned at `/api/v1/`, with legacy `/api/` aliases that must keep returning identical shapes (covered by `test/apiContract.test.js`).
- Frontend: `src/public/index.html` has **no inline scripts** (CSP forbids `'unsafe-inline'`) — all UI logic is in `src/public/app.js`, which ESLint treats as a browser script, not a module.

## Conventions (differ from defaults — see CONTRIBUTING.md)

- No comments by default; only when the *why* is non-obvious.
- No extra error handling, abstractions, or backwards-compat shims beyond what the task requires.
- ESLint flat config (`eslint.config.js`); `src/public/**/*.js` gets browser globals, tests get `no-unused-vars` off.

## Gotchas that bite agents

- **Validator presets live in two places**: add to `src/validator/presets.js` *and* the hardcoded `<select>` in `src/public/index.html`, plus tests in `test/validatorChecks.test.js` and `test/validatorFrontend.test.js`.
- **Validator mode is hidden off-localhost** — `isLocalhost()` guard in `app.js` is an intentional soft feature flag.
- **Uploaded ZIP HTML runs inside the shared Chromium pool** (`browserPool.js` launches headless with no site isolation beyond a separate context per capture) and can reach localhost services while it executes. Treat any change that serves user content as security-sensitive; see `SEC-*` items in the audit.
- **Local file server for Playwright binds port 3002 with +1 fallback** — concurrent jobs race on it; known issue `PERF-2`.
- **Auth**: `AUTH_MODE=development` (default) auto-resolves `dev-user`; `production` reads trusted proxy headers and requires `ADMIN_PASSWORD` + `AUTH_SESSION_SECRET`. Don't weaken header validation.
- Adding a validator preset, capture strategy, or endpoint usually means updating: source + `index.html` (if user-facing) + a mirrored test file + `test/apiContract.test.js` (if the API shape changes).

## Reference docs

- `CLAUDE.md` — full request flow, key-file table, capture strategies, env var table, and the audit backlog (`SEC-*`, `CQ-*`, `PERF-*`, `UX-*`). Its stale lines: the `.env` claim, `webServer.js` line counts, and the `--disable-web-security` gotcha (current launch args in `browserPool.js` no longer include it).
- `docs/audit-2026-06-26.md` — evidence for the backlog; `docs/release-runbook.md` — deploy checklist.
- Deploy: Docker multi-stage build via Coolify (`deploy/coolify/`) — the `Dockerfile` must be selected explicitly (not Nixpacks) or Playwright runtime libs are missing. Health check: `GET /api/v1/health`.
