# CLAUDE.md — Backup Banner Generator

Internal tool that generates JPEG backup images from HTML5 banner ZIPs, `.riv` Rive files, and video files, for ad platform delivery. Secondary subsystem: Ad Validator that checks creatives against platform presets.

**Live:** https://bbg.mrwolf.be | **Stack:** Node 20, Express, Playwright, Sharp, AdmZip

---

## Commands

```bash
npm test                  # Run all tests (Node built-in test runner)
npm run test:watch        # Re-run on file changes
npm run lint              # ESLint (flat config)
npm run lint:fix          # Auto-fix lint
npm run quality:gate      # lint + test (run before committing)
npm run serve             # Start web server on :3001
npm run serve:dev         # Start with --watch
npm run serve:prod        # Preflight checks + start (requires NODE_ENV=production)
npm run preflight         # Validate production env vars
npm run generate          # CLI mode: input/ → output/
```

Copy `.env.example` to `.env` before running. Tests do not need a `.env`.

---

## Architecture

### Request flow (web UI)

```
POST /api/v1/jobs          → multer upload → create Job in InMemoryJobStore
POST /api/v1/jobs/:id/process → processJob() fires async (fire-and-forget)
  ├── startFileServer(3002, serveDir)     local static server for Playwright
  ├── per file (semaphore, max 3):
  │   ├── ZIP: extractZip → findBannerEntry → detectBannerSize → captureBackup
  │   ├── RIV: parseRivDimensions → generateRiveHTML → captureBackup
  │   └── video: captureVideoFrame (ffmpeg)
  └── build output ZIP (AdmZip) → job.status = 'complete'
GET /api/v1/jobs/:id/download → res.download → cleanupJob
```

### Key files

| File | Role |
|---|---|
| `src/webServer.js` | Express server, all routes, Multer, job lifecycle (1113 lines — the monolith) |
| `src/captureBackup.js` | 4-strategy Playwright screenshot + Sharp JPEG compression |
| `src/browserPool.js` | Singleton Chromium pool (reuses browsers, fresh context per capture) |
| `src/extractZip.js` | ZIP extraction with path-traversal + size limits |
| `src/findBannerEntry.js` | Recursive HTML file discovery, prefers shallowest |
| `src/detectBannerSize.js` | meta tag → canvas → div → filename → 300×250 |
| `src/localServer.js` | Job-scoped static file server for Playwright |
| `src/riveTemplate.js` | Generates wrapper HTML for `.riv` files |
| `src/auth/middleware.js` | Auth factory: DevAuthAdapter vs HeaderAuthAdapter |
| `src/jobs/Job.js` | Job + FileInfo models with state machines |
| `src/jobs/JobStore.js` | JobStore interface + InMemoryJobStore |
| `src/storage/LocalStorage.js` | Job-scoped path helpers under `temp/` |
| `src/validator/` | Ad validator subsystem (checks, presets, findings) |
| `src/public/index.html` | Entire frontend — HTML + 1200-line inline `<script>` |

### Directory layout under `temp/`

```
temp/
  uploads/{jobId}/{fileId}/originalfile.zip
  work/{jobId}/{fileId}/extracted/index.html  ← served to Playwright
  results/{jobId}/banner.jpg
  results/{jobId}.zip                         ← download artifact
  validator/{jobId}/...                       ← validator work dirs
```

---

## Patterns

### Job lifecycle states

```
Job:   uploaded → processing → complete | error
File:  uploaded → queued → processing → complete | failed
```

### Capture strategies (tried in order)

1. `?backup=1` query param + `window.__backupReady = true`
2. `window.generateBackupFrame()` function call
3. `window.riveInstance.scrub(MAX_SAFE_INTEGER)`
4. Fallback: wait `waitTimeout`ms, drain RAF callbacks, hash canvas stability

### Auth modes

- `development` (default): DevAuthAdapter — always resolves to `dev-user/dev-tenant/dev-client`
- `production`: HeaderAuthAdapter — reads `x-auth-user-id`, `x-auth-tenant-id`, `x-auth-client-id` from trusted proxy headers

### Validator preset check

Presets live in `src/validator/presets.js`. The frontend preset `<select>` is hardcoded in `index.html` — when adding a preset, update both.

---

## Non-obvious gotchas

- **`webServer.js:processJob()` is fire-and-forget** — called without `await`. Errors inside are caught and written to job state, not propagated to the HTTP response.

- **Playwright runs with `--disable-web-security`** — intentional (Rive CDN loading), but means banner JS can reach any localhost port and bypass CSP. `.riv` files are now validated against the Rive binary signature before being served, but uploaded ZIP HTML still runs unrestricted. See SEC-7 in the audit.

- ~~**`renderChecks.js` does NOT use the browser pool** — it calls `chromium.launch()` directly. Under concurrent validator jobs this can spawn many Chromium processes. Fix is in the audit backlog (PERF-1).~~ ✅

- **Download callback cleans up the job on any outcome**, including aborted downloads. If a user's network drops mid-download, their results are gone. Fix: defer cleanup to TTL (CQ-10 in audit).

- **Validator mode is hidden on non-localhost** — `initModeSwitch()` in `index.html` only shows the mode switch when `isLocalhost()` is true. The live site doesn't show it. Currently intentional as a soft feature flag.

- **Local file server starts at port 3002 with recursive +1 fallback** — concurrent jobs race on port 3002. Should use `port: 0` (PERF-2 in audit).

- **Jobs are in-memory only** — server restart loses all active/completed jobs. `InMemoryJobStore` is the only implementation.

- **`APP_VERSION = '1.0.0'` is hardcoded** in `webServer.js:41` — not read from `package.json`.

- **`isSafeFilename` only blocks `..`, `/`, `\`** — does not block null bytes or Unicode tricks. Acceptable for current threat model.

- **The Rive wrapper HTML hardcodes a CDN URL** — `https://s0.2mdn.net/creatives/assets/5617025/rive.js`. No SRI hash, version pinned by path only.

- **Login comparison is not timing-safe** — `===` used in `handleLogin`. Rate limiter makes this low risk but it should be `crypto.timingSafeEqual`.

---

## Testing

Uses Node.js built-in `node:test` (no Jest/Vitest). Test files live in `test/*.test.js`.

```bash
node --test                  # all tests
node --test test/foo.test.js  # single file
```

Test naming: mirror the source file (`src/extractZip.js` → `test/extractZip.test.js`).

**Missing coverage** (from audit): integration ZIP→screenshot→JPG, `renderChecks.js` concurrency, browser pool crash recovery, download-on-disconnect cleanup, stuck `processing` job TTL.

---

## Environment variables

See `.env.example` for full list. Key vars:

| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | Set to `production` for deployed envs |
| `PORT` | `3001` | Web server port |
| `AUTH_MODE` | `development` | `production` requires proxy-injected auth headers |
| `CAPTURE_CONCURRENCY` | `3` | Max concurrent Playwright captures (1–8) |
| `RIVE_DEBUG_DIR` | _(unset)_ | Set to save debug HTML/errors on failed captures |
| `ADMIN_PASSWORD` | _(required in prod)_ | Password for the built-in login UI |
| `CORS_ORIGIN` | `*` | Restrict in production |

---

## Technical debt (from audit 2026-06-26)

Full details + evidence in `docs/audit-2026-06-26.md`.

### Security

| ID | Issue | File | Priority |
| --- | --- | --- | --- |
| ~~SEC-1~~ | ~~CSP allows `'unsafe-inline'` — move `<script>` block to `app.js`~~ | ~~`webServer.js:968`~~ | ~~High~~ ✅ |
| ~~SEC-2~~ | ~~`handleLogin` uses `===` not `crypto.timingSafeEqual`~~ | ~~`webServer.js:863`~~ | ~~Medium~~ ✅ |
| ~~SEC-3~~ | ~~`.riv` file is copied as `.js` and executed in Playwright — no binary validation~~ | ~~`webServer.js:363`~~ | ~~High~~ ✅ |
| SEC-4 | Auth session in `localStorage` — XSS-accessible (mitigated once SEC-1 fixed) | `index.html:142` | Medium |
| SEC-5 | Rate limiter `Map` grows unbounded — stale IPs never pruned | `webServer.js:1002` | Medium |
| SEC-6 | Health endpoint is public and exposes auth mode + all metrics | `webServer.js:876` | Low |
| SEC-7 | Playwright launched with `--disable-web-security` — required but risky; bundle `rive.js` locally to remove | `browserPool.js:85` | Medium |
| SEC-8 | No magic-byte validation for `.riv` or video uploads | `webServer.js:547` | Medium |

### Code quality

| ID | Issue | File | Priority |
| --- | --- | --- | --- |
| CQ-1 | `webServer.js` is 1113-line monolith — too many responsibilities | `webServer.js` | Medium |
| CQ-2 | `APP_VERSION = '1.0.0'` hardcoded — not read from `package.json` | `webServer.js:41` | Low |
| CQ-3 | `parseNumberEnv`, `parsePortValue`, `boolEnv` defined inline — belong in `config.js` | `webServer.js:44` | Low |
| CQ-4 | `assertOwnership` and `assertValidatorOwnership` are identical functions | `webServer.js:216` | Low |
| CQ-5 | `validatorWorkRoot()` ignores its argument — called as `validatorWorkRoot(job.id)` | `webServer.js:139,673` | Low |
| CQ-6 | `shouldIgnore` uses `.includes('__MACOSX')` — over-broad, use `.startsWith('__MACOSX/')` | `extractZip.js:11` | Low |
| CQ-7 | `isPathSafe` exported API is confusing — silently returns `false` for relative paths | `extractZip.js:25` | Low |
| CQ-8 | `riveTemplate.js` hardcodes CDN URL with no SRI hash; version may be stale | `riveTemplate.js:44` | Medium |
| CQ-9 | `Semaphore` class in `webServer.js` duplicates `BrowserPool` waiter logic | `webServer.js:89` | Low |
| CQ-10 | Download callback cleans up job on any outcome including mid-transfer disconnect | `webServer.js:792` | Medium |

### Performance & reliability

| ID | Issue | File | Priority |
| --- | --- | --- | --- |
| ~~PERF-1~~ | ~~`renderChecks.js` calls `chromium.launch()` directly — bypasses browser pool~~ | ~~`renderChecks.js:35`~~ | ~~High~~ ✅ |
| PERF-2 | Local file server starts at port 3002, recursive +1 fallback — use `port: 0` | `localServer.js:31` | Medium |
| PERF-3 | Jobs in-memory only — `InMemoryJobStore` has no persistence; restart = data loss | `JobStore.js:27` | Medium |
| PERF-4 | Stuck `processing` jobs never cleaned up — `pruneStaleSessions` skips them | `webServer.js:270` | Low |
| PERF-5 | AdmZip builds output ZIP synchronously in memory — memory spike on large batches | `webServer.js:449` | Low |
| PERF-6 | No per-user concurrency limit — one user can occupy all browser slots | `webServer.js:111` | Low |
| PERF-7 | Browser pool doesn't detect Chromium crashes — dead browser returned to next caller | `browserPool.js:14` | Medium |

### UX

| ID | Issue | File | Priority |
| --- | --- | --- | --- |
| UX-1 | Validator mode hidden on non-localhost — `isLocalhost()` guard in `initModeSwitch()` | `index.html:538` | Medium |
| UX-2 | No file size shown in the uploaded files list | `index.html` | Low |
| UX-3 | Download triggers immediate cleanup even on network failure (see CQ-10) | `webServer.js:792` | Medium |
| UX-4 | No way to cancel in-progress processing | — | Low |
| UX-5 | Upload limits (200 MB, 50 files) not shown in the drop zone hint | `index.html` | Low |
| UX-6 | Polling uses fixed interval (1 s backup, 500 ms validator) — no backoff | `index.html:1232` | Low |

---

## Roadmap

### Immediate (production risk or security)

1. ~~**SEC-3** — Validate `.riv` binary signature before serving to Playwright~~ ✅
2. ~~**SEC-1** — Move `<script>` block to `app.js`, remove `'unsafe-inline'` from CSP~~ ✅
3. ~~**PERF-1** — Route `renderChecks.js` through the browser pool or add a semaphore cap~~ ✅
4. ~~**SEC-2** — Use `crypto.timingSafeEqual` in `handleLogin`~~ ✅
5. **CQ-10 / UX-3** — Defer result ZIP cleanup to TTL instead of download callback

### Short-term (reliability + UX)

1. **PERF-7** — Detect Chromium crashes in `BrowserPool` (`browser.on('disconnected')`)
2. **PERF-2** — Use `port: 0` for local file server
3. **SEC-5** — Prune stale entries from rate limiter Map
4. **PERF-4** — Add TTL for stuck `processing` jobs
5. **UX-1** — Remove `isLocalhost()` guard once validator is production-ready
6. **SEC-6** — Strip sensitive metrics from public health endpoint
7. **SEC-8** — Add magic-byte validation for video and `.riv` uploads
8. **CQ-8** — Bundle `rive.js` locally; remove CDN dependency
9. **UX-2 / UX-5** — Show file size and add upload limit hints to the UI
10. **PERF-6** — Add per-tenantId concurrency limit

### Medium-term (architecture)

- Persist jobs to SQLite — survive restarts, enable download-retry
- Extract `processJob` + lifecycle into `src/jobs/jobProcessor.js`
- Extract rate limiter into `src/rateLimiter.js`; replace with `express-rate-limit`
- Extract `Semaphore` into `src/semaphore.js` (shared with browser pool)
- Move `parseNumberEnv` / `boolEnv` utilities to `config.js`
- Fix `APP_VERSION` — read from `package.json`
- Add exponential backoff to client polling
- Add cancel-job endpoint (`DELETE /api/v1/jobs/:jobId`)
- Replace AdmZip output with streaming `archiver` for large batches
- Add architecture diagram to docs

### Future features

- Final-frame detection heuristic — confirm screenshot captures the intended last frame, not a loading state
- Downloadable per-creative audit report (PDF/JSON)
- Batch ZIP processing — accept a ZIP-of-ZIPs
- CM360/DV360 deep compliance (VAST tag, safe-frame API check)
- Per-platform backup size/quality/naming presets
- Webhook/callback on job completion (instead of polling)
- Multi-instance support (Redis job store + shared rate limiter)
- Asset path resolution check — validate that all referenced assets exist in the ZIP before capture
- Combined backup + validation run in one job
- Rive animation validation (dimensions, state machine names, loop behaviour)

---

## Testing gaps (from audit 2026-06-26)

Current coverage is good (18 files, ~300+ tests). Missing:

| Gap | Related finding |
|---|---|
| Integration: full ZIP → screenshot → actual JPG output | — |
| `renderChecks.js` Chromium concurrency / resource exhaustion | PERF-1 |
| Browser pool crash recovery (dead browser detection) | PERF-7 |
| Download callback cleanup fires on disconnect | CQ-10 |
| Stuck `processing` job pruning | PERF-4 |
| Malicious `.riv` binary (non-Rive payload) rejected | SEC-3 |
| Rate limiter Map memory growth | SEC-5 |
| Retry with mix of failed + complete files | — |
| Concurrent uploads from the same user | PERF-6 |

---

## Documentation gaps (from audit 2026-06-26)

- No architecture diagram
- No CHANGELOG
- No CONTRIBUTING.md
- Validator API response shapes not fully documented in README
- Known limitations not listed (no job persistence, no cancel, single-instance rate limiter)

---

## Deployment

Docker multi-stage build, deployed via Coolify. See `deploy/coolify/` for compose + nginx config.

The Dockerfile must be selected explicitly in Coolify (not auto-detected Nixpacks) or Playwright runtime libs will be missing.

Health check: `GET /api/v1/health` (public, no auth required).
