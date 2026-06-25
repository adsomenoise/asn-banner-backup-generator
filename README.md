# Rive Backup Image Generator

Batch-process HTML5 banner ZIP files and generate static JPG backup images for ad platforms (CM360, DV360, Amazon Ads, etc.).

## Installation

```bash
npm install
npx playwright install chromium
```

## Quality Gates

```bash
npm run lint
npm test
```

CI runs the same checks on push and pull requests via [.github/workflows/ci.yml](.github/workflows/ci.yml).

For production deploy safety checks:

```bash
npm run preflight
```

See the full release/deploy checklist in [docs/release-runbook.md](docs/release-runbook.md).

## Production Environment

Create your runtime environment file from [.env.example](.env.example) and set the values for your deployment target.

Key variables:

- `NODE_ENV` (`production` for deployed environments)
- `PORT` (web server bind port)
- `CORS_ORIGIN` (frontend origin or `*`)
- `RATE_LIMIT_MAX` (requests per minute per IP for mutation endpoints)
- `CAPTURE_CONCURRENCY` (1-8, defaults to 3)
- `AUTH_MODE` (`development` or `production`)
- `AUTH_USER_ID_HEADER`, `AUTH_TENANT_ID_HEADER`, `AUTH_CLIENT_ID_HEADER` (identity headers expected from your gateway)

### Coolify Live Deploy Checklist

When deploying to Coolify, make sure the app is built from the repository `Dockerfile` (not auto-detected Nixpacks), otherwise Playwright runtime libraries can be missing.

1. In Coolify, set build mode to `Dockerfile` and redeploy with cache disabled.
2. Configure these required environment variables:
  - `NODE_ENV=production`
  - `PORT=3001`
  - `CORS_ORIGIN=https://<your-domain>`
  - `AUTH_MODE=production`
  - `AUTH_USER_ID_HEADER=x-user-id`
  - `AUTH_TENANT_ID_HEADER=x-tenant-id`
  - `AUTH_CLIENT_ID_HEADER=x-client-id`
  - `ADMIN_PASSWORD=<strong-secret>`
3. Mount persistent storage to `/app/temp`.
4. Keep initial `CAPTURE_CONCURRENCY=2` and increase only after monitoring CPU/RAM.

#### Verify Runtime Dependencies In The Running Container

If uploads fail with Playwright launch errors like `error while loading shared libraries`, open a shell in the running container and run:

```bash
ldconfig -p | grep -E 'libatk-bridge-2.0.so.0|libgtk-3.so.0|libcups.so.2'
```

Expected: all three libraries are listed.

#### Verify Playwright Browser Install

```bash
ls -la /root/.cache/ms-playwright
```

You should see a Chromium folder (for example `chromium_headless_shell-*`).

#### Quick Health Check

```bash
curl -i http://127.0.0.1:3001/api/v1/health
```

If `authMode` is `production`, the frontend login flow must complete before upload calls.
Successful frontend logins are remembered in the browser for 14 days.

## Usage — CLI

1. Place banner ZIP files in the `input/` directory
2. Run:

```bash
npm run generate
```

3. Find JPG backup images in the `output/` directory

### CLI Options

```bash
node src/index.js \
  --input ./input \
  --output ./output \
  --wait 15000 \
  --quality 95 \
  --port 3000 \
  --strategy auto
```

| Option | Default | Description |
|--------|---------|-------------|
| `--input, -i` | `./input` | Input folder with ZIP files |
| `--output, -o` | `./output` | Output folder for JPGs |
| `--wait, -w` | `15000` | Creative duration in ms before fallback screenshot capture |
| `--quality, -q` | `95` | Preferred JPEG quality (10–100); falls back through lower tiers to stay under 80 KB |
| `--port, -p` | `3000` | Local server port |
| `--strategy, -s` | `auto` | Backup strategy: `auto`, `query`, `generate`, `scrub` |

## Usage — Web Interface

```bash
npm run serve
```

Open `http://localhost:3001` in your browser.

To tune parallel capture throughput, set `CAPTURE_CONCURRENCY` before starting the server:

```bash
CAPTURE_CONCURRENCY=5 npm run serve
```

The default is `3`. Invalid values fall back to `3`; values above `8` are capped at `8`.

### Workflow

1. **Drop files** onto the drop zone (`.zip` or `.riv`, multiple allowed).
2. Each file appears in the list with a state badge: `uploaded` → `queued` → `processing` (with spinner) → `done` or `failed`.
3. The progress region announces how many files are ready, then exposes processing progress with real `progressbar` semantics during generation.
4. Click **Generate backups** to start processing. An overlay with an animation GIF, cycling messages, accessible progress, and per-file status updates appears.
5. On completion:
   - **Success**: files show a green checkmark.
   - **Failure**: files show a red cross with an inline explanation (e.g. missing dimensions, no HTML found).
   - **Partial success**: download button still appears for successful files; a **Retry failed** button lets you re-process only the failed ones.
   - **Start over** resets everything.
6. Click **Download ZIP** to get a single archive containing: JPGs for successful files, nested per-creative ZIPs (`.html` + `.js`) for `.riv` files, and `errors.json` if any file failed.

### Ad Validator

The web UI includes a separate **Validate Ads** mode. It accepts `.zip`, `.riv`, and supported video files, runs a selected validation preset, and renders a report without generating backup JPGs.

Initial presets:

- Generic QA
- CM360 / DV360
- Google Ads
- Amazon Ads
- Rive
- Video

Validator reports include an overall `pass`, `warning`, or `fail` result, per-file findings grouped by severity, detected metadata, and suggested fixes such as adding a missing HTML entry point, renaming unsafe files, bundling external assets, or re-encoding oversized video.

### Accessibility

- The upload target is keyboard-operable and exposes a button role for assistive technologies.
- Login and processing dialogs move focus into the modal, keep keyboard focus inside while open, mark the background inert, and restore focus when closed.
- Overall and modal processing bars use `role="progressbar"` with `aria-valuemin`, `aria-valuemax`, and dynamic `aria-valuenow` values.
- Status regions use polite live announcements for ready, processing, and completion states (for example: `Complete. 0 files succeeded, 1 failed.`).
- Each uploaded file row exposes an accessible summary such as `banner.zip, ZIP file, processing` or `layout.zip, ZIP file, failed: The ZIP must contain at least one .html file.`
- Overlay file statuses include screen-reader text in addition to visual status dots.

## API Reference

All API endpoints are versioned under `/api/v1/`. Legacy `/api/` routes remain available for backwards compatibility (see [Legacy Aliases](#legacy-aliases)).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health/readiness check |
| `POST` | `/api/v1/jobs` | Create a job and upload files |
| `POST` | `/api/v1/jobs/{jobId}/process` | Start processing a job |
| `GET` | `/api/v1/jobs/{jobId}` | Get job status with per-file details |
| `GET` | `/api/v1/jobs/{jobId}/files` | Get per-file details only |
| `GET` | `/api/v1/jobs/{jobId}/download` | Download result ZIP |
| `GET` | `/api/v1/validator/presets` | List validator presets |
| `POST` | `/api/v1/validator/jobs` | Create a validator job and upload files |
| `POST` | `/api/v1/validator/jobs/{jobId}/validate` | Start validation for a selected preset |
| `GET` | `/api/v1/validator/jobs/{jobId}` | Get validator status and report |

---

### `GET /api/v1/health`

Returns server health information.

**Response `200 OK`**
```json
{
  "status": "ok",
  "timestamp": "2026-06-16T13:00:00.000Z",
  "version": "1.0.0",
  "uptime": 1234.56
}
```

---

### `POST /api/v1/jobs`

Upload files and create a processing job. Accepts `multipart/form-data`.

**Form fields**
| Field | Type | Description |
|-------|------|-------------|
| `files` | `File[]` | One or more `.zip` or `.riv` files (max 50, max 200 MB each) |

**Response `201 Created`**
```json
{
  "jobId": "a1b2c3d4",
  "status": "uploaded",
  "createdAt": "2026-06-16T13:00:00.000Z",
  "files": [
    {
      "fileId": "001-banner_300x250",
      "fileName": "banner_300x250.zip",
      "fileType": "zip",
      "state": "uploaded",
      "error": null
    }
  ],
  "progress": {
    "total": 1,
    "completed": 0,
    "failed": 0,
    "results": 0
  }
}
```

**Error responses**

- `400` — `NO_FILES` (no files attached)
- `400` — `INVALID_FILE_TYPE` (file doesn't end in `.zip` or `.riv`)
- `400` — `FILE_TOO_LARGE` (single file >200 MB)
- `400` — `TOO_MANY_FILES` (>50 files)
- `400` — `UNSAFE_FILENAME` (name contains `..`, `/`, or `\`)

---

### `POST /api/v1/jobs/{jobId}/process`

Start processing all files in a job. Returns immediately; progress is tracked via `GET /api/v1/jobs/{jobId}`.

**Response `200 OK`**
```json
{
  "jobId": "a1b2c3d4",
  "status": "processing",
  "createdAt": "2026-06-16T13:00:00.000Z",
  "files": [
    {
      "fileId": "001-banner_300x250",
      "fileName": "banner_300x250.zip",
      "fileType": "zip",
      "state": "queued",
      "error": null
    }
  ],
  "progress": {
    "total": 1,
    "completed": 0,
    "failed": 0,
    "results": 0
  }
}
```

**Error responses**
- `404` — `NOT_FOUND` (unknown `jobId`)
- `409` — `ALREADY_PROCESSING` (job is already being processed)

---

### `GET /api/v1/jobs/{jobId}`

Get the full job status, including per-file states and progress counters.

**Response `200 OK`** (status: `uploaded`)
```json
{
  "jobId": "a1b2c3d4",
  "status": "uploaded",
  "createdAt": "2026-06-16T13:00:00.000Z",
  "files": [
    {
      "fileId": "001-banner_300x250",
      "fileName": "banner_300x250.zip",
      "fileType": "zip",
      "state": "uploaded",
      "error": null
    }
  ],
  "progress": {
    "total": 1,
    "completed": 0,
    "failed": 0,
    "results": 0
  }
}
```

**Response `200 OK`** (status: `complete`)
```json
{
  "jobId": "a1b2c3d4",
  "status": "complete",
  "createdAt": "2026-06-16T13:00:00.000Z",
  "files": [
    {
      "fileId": "001-banner_300x250",
      "fileName": "banner_300x250.zip",
      "fileType": "zip",
      "state": "complete",
      "error": null
    },
    {
      "fileId": "002-layout",
      "fileName": "layout.zip",
      "fileType": "zip",
      "state": "failed",
      "error": "The ZIP must contain at least one .html file. None was found."
    }
  ],
  "progress": {
    "total": 2,
    "completed": 1,
    "failed": 1,
    "results": 1
  },
  "download": "/api/v1/jobs/a1b2c3d4/download"
}
```

The `download` field is present only when `status` is `complete` and at least one file succeeded.

**Error responses**
- `404` — `NOT_FOUND` (unknown `jobId`)

---

### `GET /api/v1/jobs/{jobId}/files`

Get only the per-file detail array (lighter than the full job response).

**Response `200 OK`**
```json
{
  "jobId": "a1b2c3d4",
  "files": [
    {
      "fileId": "001-banner_300x250",
      "fileName": "banner_300x250.zip",
      "fileType": "zip",
      "state": "complete",
      "error": null
    }
  ]
}
```

**Error responses**
- `404` — `NOT_FOUND` (unknown `jobId`)

---

### `GET /api/v1/jobs/{jobId}/download`

Download the result ZIP archive. Each successful file's JPG is included. Failed files are excluded. If any file failed, an `errors.json` manifest is included.

**Response `200 OK`** — Binary ZIP download (`Content-Type: application/zip`)

**Error responses**
- `404` — `NOT_FOUND` (unknown `jobId` or result file missing)
- `400` — `NOT_COMPLETE` (job is still processing or not yet started)

---

### Standard Error Shape

Every error response follows this shape:

```json
{
  "error": "Human-readable description of what went wrong",
  "code": "MACHINE_READABLE_CODE"
}
```

| Code | Meaning |
|------|---------|
| `NOT_FOUND` | The requested job ID does not exist |
| `NOT_COMPLETE` | The job is not yet in `complete` status |
| `ALREADY_PROCESSING` | Cannot start processing again while already running |
| `NO_FILES` | No files were attached to the upload request |
| `INVALID_FILE_TYPE` | A file does not have `.zip` or `.riv` extension |
| `FILE_TOO_LARGE` | A single file exceeds the 200 MB limit |
| `TOO_MANY_FILES` | More than 50 files were uploaded in one request |
| `UNSAFE_FILENAME` | Filename contains `..`, `/`, or `\` |
| `UPLOAD_ERROR` | A generic upload error occurred |
| `BAD_REQUEST` | A generic client error |
| `UNAUTHORIZED` | Authentication credentials are missing or invalid (production mode) |
| `FORBIDDEN` | The authenticated user is not permitted to access this resource |
| `INTERNAL_ERROR` | An unexpected server error occurred |

---

### File Lifecycle

Each file in a job transitions through these states:

| State | Description |
|-------|-------------|
| `uploaded` | File has been received and stored |
| `queued` | Job is processing; this file is waiting for a worker slot |
| `processing` | Actively being processed (screenshot taken, JPG compressed) |
| `complete` | Backup image generated successfully |
| `failed` | Processing failed; `error` field contains the reason |

---

### Legacy Aliases

| Legacy path | v1 equivalent | Notes |
|-------------|---------------|-------|
| `POST /api/upload` | `POST /api/v1/jobs` | Uses form field `zips` instead of `files` |
| `POST /api/process/:sessionId` | `POST /api/v1/jobs/:jobId/process` | — |
| `GET /api/status/:sessionId` | `GET /api/v1/jobs/:jobId` | Returns v1-shaped response (not the old shape) |
| `GET /api/download/:sessionId` | `GET /api/v1/jobs/:jobId/download` | — |

The legacy routes invoke the same handler functions and return the same response shapes as their v1 counterparts.

## How It Works

1. Scans `input/` for `.zip` files (CLI) or accepts uploads (web)
2. Extracts each ZIP to `temp/{zip-name}/`
3. Locates the only `.html` file automatically (any filename)
4. Detects banner dimensions (meta tag > canvas > filename > default 300x250)
5. Serves the banner via a local HTTP server (no `file://` URLs)
6. Opens the banner in headless Chromium via a reusable Playwright browser pool
7. Applies backup strategies to reach the final visual state
8. If no explicit backup hook is available, waits for the configured creative duration and drains queued `requestAnimationFrame` callbacks
9. Captures a PNG screenshot and compresses to JPEG (multi-tier quality, targets ≤80 KB)
10. Saves to `output/` with optional dedup suffix

## Backup Strategies

### Strategy 1 — Query Parameter (Recommended)

Loads the HTML with `?backup=1` appended. Creatives should check for this parameter, render the final static backup frame immediately, then set:

```js
window.__backupReady = true;
```

### Strategy 2 — `window.generateBackupFrame()`

If the page exposes this function, the generator calls it and waits for `window.__backupReady = true`.

```js
window.generateBackupFrame = async function () {
  await stopAnimations();
  renderBackupFrame();
  window.__backupReady = true;
};
```

The function may be synchronous or async. If it returns `true`, the generator also treats the backup frame as ready. The legacy marker `window.__BACKUP_READY__ = true` remains supported for older creatives.

### Strategy 3 — Rive Instance Scrub

If `window.riveInstance` is exposed with a `scrub` method, attempts to scrub to the final frame.

### Strategy 4 — Fallback Timeout

When no explicit backup hook is available, waits until the configured creative duration has elapsed from navigation start, drains queued animation frames, detects canvas stability, then captures whatever is on screen. The default duration is `15000` ms.

This path is slower than the explicit backup contract and can add about 15 seconds per creative. See [Creative Backup Image Contract](docs/creative-backup-contract.md) for implementation examples.

## Authentication

All API endpoints (except `/api/v1/health`) require authentication when the server is started in production mode. Requests without valid credentials receive a `401` response.

### Configuration

```js
// startWebServer accepts an optional auth config object and security options
await startWebServer(3001, {
  auth: {
    mode: 'production',             // 'development' | 'production'
    headers: {
      userId: 'x-user-id',         // default header names
      tenantId: 'x-tenant-id',
      clientId: 'x-client-id'
    }
  },
  corsOrigin: 'https://my-platform.com',  // restrict CORS (default: '*')
  rateLimitMax: 30                         // POST requests per 60s/IP (default: 30)
});
```

### Adapters

| Adapter | Mode | Description |
|---------|------|-------------|
| `HeaderAuthAdapter` | `production` | Extracts user/tenant/client identity from trusted HTTP headers set by the parent platform's proxy/ingress. Returns `null` if required headers are missing — the middleware then rejects with `401`. |
| `DevAuthAdapter` | `development` (default) | Returns a configurable default identity (`dev-user` / `dev-tenant` / `dev-client`) when no auth headers are present. Also respects headers if provided, making integration testing easy. |

### Identity & Ownership

Every job is tagged with the authenticated identity at creation time:

- `userId` — **required**. Uniquely identifies the actor. All subsequent operations on the job verify this matches.
- `tenantId` — optional. Enables tenant isolation when set.
- `clientId` — optional. Enables sub-account isolation when set.

Access to a job requires a full match on all non-null identity fields:

```
userId  MATCH
tenantId  MATCH  (if both job and request have it)
clientId  MATCH  (if both job and request have it)
```

Mismatches return `404` (not `403`) to avoid leaking job existence across users or tenants.

### Custom Adapter

For non-header auth (session cookies, JWTs, platform SDKs), provide a custom adapter object:

```js
const myAdapter = {
  extract(req) {
    // Return { userId, tenantId?, clientId? } or null to reject
    const token = req.headers['authorization'];
    const payload = verifyMyToken(token);
    return payload ? {
      userId: payload.sub,
      tenantId: payload.tenant,
      clientId: payload.client
    } : null;
  }
};

await startWebServer(3001, {
  auth: { mode: 'production', adapter: myAdapter }
});
```

### Health Endpoint

`GET /api/v1/health` is registered before the auth middleware and does not require authentication, even in production mode.

### Frontend Login Persistence

The built-in web UI exposes `POST /api/login` for the simple admin login form. On successful login, the browser stores the returned identity in `localStorage` with a 14-day expiry and sends it as auth headers on `/api/*` requests. Expired or malformed login records are cleared automatically.

Set `ADMIN_PASSWORD` in production. `ADMIN_USERNAME` defaults to `admin` when unset.

## Security & Production Notes

### ZIP Safety

- **Path-traversal protection**: extracted entry paths are resolved and verified to stay within the extraction directory; entries such as `/etc/passwd` or `../../etc/shadow` are rejected (see `src/extractZip.js`).
- **Entry limits**: maximum 1,000 entries per ZIP; any entry exceeding 50 MB rejected; total extracted content capped at 200 MB.
- **Ignored entries**: `__MACOSX`, `.DS_Store`, dotfiles, and `__`-prefixed files are silently dropped.
- On extraction failure, the partial output directory is removed immediately.

### File Uploads (Web UI)

- **Max file size**: 200 MB per file (configurable via `MAX_UPLOAD_SIZE` in `src/webServer.js`).
- **Max files**: 50 per upload request (configurable via `MAX_UPLOAD_FILES`).
- **Filename safety**: uploads with `..`, `/`, or `\` in the original name are rejected.
- **Session TTL**: idle sessions are pruned after 30 minutes.
- **ZIP magic-byte validation**: uploaded `.zip` files are checked for the `PK\x03\x04` magic bytes before processing; files without a valid ZIP header are rejected with `INVALID_FILE_TYPE`.
- **File type filtering**: the multer `fileFilter` rejects any file that does not end in `.zip` or `.riv`.

### HTTP Security

- **Security headers** are set on every response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 0`
  - `Referrer-Policy: no-referrer`
- **CORS** is configurable via `startWebServer(port, { corsOrigin })`. Defaults to `*` for local development. In production, set to the specific origin of the parent platform.
- **Rate limiting** is applied to mutation endpoints (`POST /api/v1/jobs` and `POST /api/v1/jobs/:jobId/process`). Default: 30 requests per 60-second window per IP. Configurable via `rateLimitMax` option.
- **Local server scoping**: each job's Playwright-accessible file server is scoped to that job's work directory only — files from other jobs are not accessible.
- **Playwright Chromium** is launched with `--disable-web-security` (required to load cross-origin Rive resources via CDN). This is acceptable because the local server only serves job-scoped directories and binds to `localhost`. Chromium processes are pooled, but each capture gets a fresh browser context and page.

### HTML Template

- The `generateRiveHTML()` function applies **HTML escaping** to the JS filename inserted into the `<title>` tag and **JS string escaping** to the filename used in the Rive constructor `src` argument, preventing XSS via crafted filenames.

### Concurrency

- A global semaphore limits concurrent captures. Configure it with `CAPTURE_CONCURRENCY`; default is `3`, maximum is `8`.
- Each session's files are processed in parallel within that limit.
- Playwright Chromium processes are reused through a browser pool. Each capture still gets a fresh browser context and page for isolation.
- The local file server in CLI mode uses a factory pattern (no shared mutable state).

### Quality Settings

The `--quality` flag sets the *preferred* JPEG quality. The encoder tries the requested quality first, then falls back through `[95, 80, 65, 50, 35]` until the output fits in 80 KB. This ensures small output files even if the preferred quality would exceed the limit.

### Error Handling

- Background processing in the web server is wrapped in a try/catch — if any part of the job fails, the session transitions to `error` status (never stuck in `processing`).
- Temporary files (uploaded ZIPs, extracted directories, result JPGs) are cleaned up on success and failure.
- Playwright browser contexts are closed reliably via `try/finally` in `captureBackup.js`; pooled Chromium processes are reused across captures.
- **Per-file error tracking**: each file has an independent `state` (`uploaded` → `queued` → `processing` → `complete`/`failed`). Failed files include a user-friendly error message explaining the issue (e.g. missing `.html` in ZIP, missing dimensions in `.riv` filename, file too large).
- **Friendly error mapping**: common cryptic errors are mapped to actionable messages. Unknown errors pass through as-is.
- **`errors.json`**: when any file in a session fails, the download ZIP includes an `errors.json` with `{file, error, friendly}` entries for every failure.

### Threat Model Assumptions

- For platform-managed auth, deploy the service behind an **authenticated reverse proxy** that strips downstream headers and injects a trusted `X-User-Id` (or equivalent) header. The built-in frontend login is a lightweight admin flow for the bundled web UI and stores remembered identity client-side for 14 days.
- The local file server binds to `localhost` and is never exposed to external traffic.
- The global rate limiter is an in-memory token bucket — it resets on process restart. For multi-instance deployments, a shared rate limiter (e.g. Redis) should be added via custom middleware.
- The `--disable-web-security` Playwright flag is required for Rive CDN cross-origin loading and is safe because the URLs Playwright navigates to are always derived from job-scoped storage paths.

### Known Tradeoffs

- Playwright requires Chromium installed (`npx playwright install chromium`); on Linux, system dependencies are needed (`npx playwright install-deps chromium`).
- The local file server serves extracted content without authentication — it is intended only for local Playwright access.
- Sessions are stored in memory; restarting the web server loses all active and completed sessions.

## Observability

### Structured Logging

All modules emit structured log entries via `src/logger.js`. In development, output is human-readable with colors. In production (set `NODE_ENV=production` or `LOG_FORMAT=json`), each line is a JSON object for ingestion by log aggregators.

#### Common log fields

| Field | Type | Description | Present |
|---|---|---|---|
| `timestamp` | ISO 8601 | Event time | Always |
| `level` | string | `info`, `warn`, `error`, `debug` | Always |
| `message` | string | Human-readable description | Always |
| `module` | string | Source module (e.g. `handleUpload`, `processJob`, `captureBackup`, `extractZip`) | Always |
| `jobId` | string | 8-char hex job identifier | Job-scoped events |
| `fileId` | string | Per-file identifier (e.g. `001-Banner_300x250`) | Per-file events |
| `userId` | string | Authenticated user identity | Auth-aware events |
| `tenantId` | string | Tenant context | Auth-aware events |
| `clientId` | string | Client/brand context | Auth-aware events |
| `duration` | number | Elapsed milliseconds | After timed operations |
| `error` | string | Error message text | On failure |
| `code` | string | Machine-readable error code | On failure |
| `fileCount` | number | Number of files in upload/batch | Upload, process events |
| `strategy` | string | Backup capture strategy name | Capture complete |
| `dimensions` | string | `{width}x{height}` | Capture events |
| `browserErrors` | number | Count of captured browser console errors | Capture complete |

#### Log levels

| Level | Usage |
|---|---|
| `info` | Normal operational events (upload, process start/complete, capture complete) |
| `warn` | Recoverable issues (no files uploaded, job already processing, browser errors) |
| `error` | Failures (file processing error, load failure, ZIP build error) |
| `debug` | Detailed diagnostics (compression tier attempts) |

#### Creating a child logger

```js
import { logger } from './logger.js';
const log = logger.child({ module: 'myModule', jobId, userId });
log.info('Processing file', { fileId, fileType: 'zip' });
```

### Metrics

`src/metrics.js` provides a simple in-memory metrics collector for counters and timings. Each metric accepts optional tags for dimensional breakdown.

#### Metric types

| Method | Description | Example |
|---|---|---|
| `increment(name, tags?)` | Increment counter by 1 | `metrics.increment('upload.complete')` |
| `count(name, value, tags?)` | Add arbitrary value to counter | `metrics.count('upload.files', files.length)` |
| `timing(name, ms, tags?)` | Record a duration | `metrics.timing('extract.duration', 150)` |
| `startTimer()` / `endTimer(name, start, tags?)` | Convenience timing pair | `const t = metrics.startTimer(); ... metrics.endTimer('job.duration', t)` |
| `snapshot()` | Return all counters + timing summaries | For health endpoint or periodic export |

#### Exposed counters

| Counter | Tags | When incremented |
|---|---|---|
| `upload.complete` | — | Successful upload |
| `upload.rejected` | `reason` | Upload rejected (no_files, bad_magic, invalid_type, etc.) |
| `upload.files` | — | Count of files uploaded (via `count()`) |
| `process.started` | — | Processing started for a job |
| `process.rejected` | `reason` | Process request rejected (already_processing) |
| `file.complete` | `type` | File processed successfully |
| `file.failed` | `type`, `reason` | File processing failed |
| `job.complete` | — | Job completed successfully |
| `job.failed` | `reason` | Job failed (server_start_error, zip_build_error) |
| `extract.complete` | — | ZIP extraction succeeded |
| `extract.rejected` | `reason` | Extraction rejected (too_many_entries, path_traversal, etc.) |
| `capture.strategy` | `strategy` | Capture strategy used |
| `capture.load_error` | — | Creative URL failed to load |
| `compression.complete` | — | JPEG written to disk |
| `compression.bytes` | — | Bytes written (via `count()`) |
| `compression.tier_selected` | `quality` | Quality tier that fit under 80 KB |
| `download.started` | — | Download initiated |
| `download.complete` | — | Download finished |
| `http.rate_limited` | — | Request rate-limited |
| `http.request_duration` | `method`, `path`, `status` | Per-request duration (via `timing()`) |

#### Exposed timings

| Timing | Tags | Unit |
|---|---|---|
| `upload.duration` | — | ms |
| `job.duration` | — | ms |
| `extract.duration` | — | ms |
| `capture.duration` | `strategy` | ms |
| `compression.duration` | — | ms |
| `download.duration` | — | ms |
| `http.request_duration` | `method`, `path`, `status` | ms |

#### Health endpoint

The `/api/v1/health` endpoint includes a `metrics` object with all counters and timing summaries (count, sum, min, max, avg, p50, p95, p99):

```json
{
  "status": "ok",
  "timestamp": "2026-06-16T13:58:18.000Z",
  "version": "1.0.0",
  "uptime": 12345.6,
  "jobs": 3,
  "metrics": {
    "counters": { "upload.complete": 10, "upload.rejected|reason=no_files": 2 },
    "timings": { "upload.duration": { "count": 10, "sum": 45, "min": 0, ... } }
  }
}
```

### Browser Error Capture

During Playwright screenshot capture, the system listens for:

- **Console errors** (`page.on('console')`): Captured when `msg.type()` is `error` or `warning`, up to 500 characters of text, including source location.
- **Page errors** (`page.on('pageerror')`): Unhandled JavaScript exceptions, up to 500 characters of message and 5 stack frames (1,000 chars total).

Browser errors are included in the capture result's `browserErrors` array and logged at `warn` level with a count. The errors themselves are NOT logged (to avoid exposing creative contents) — only the count is surfaced in structured logs.

### Debug Artifacts

Set `RIVE_DEBUG_DIR` environment variable to a directory path to save debug artifacts on failed captures:

```sh
export RIVE_DEBUG_DIR=/tmp/rive-debug
npm run serve
```

When a file processing fails, the following may be saved:

| File | Content | Size Limit |
|---|---|---|
| `{baseName}_errors.json` | JSON array of browser errors | Full |
| `{baseName}_page.html` | Page HTML at time of failure | First 50 KB |

These artifacts contain creative content and should be handled with appropriate access controls.

### Testing Observability

Run `test/observability.test.js` to verify:
- Logger child creation and context propagation
- Logger step/banner/saved methods
- Metrics increment, count, timing, percentile, reset
- Health endpoint includes metrics counters and timings

### Adding Custom Metrics

1. Import `metrics` from `./metrics.js`
2. Call `metrics.increment('my.event')` or `metrics.timing('my.duration', elapsed)`
3. The value appears in the next `/api/v1/health` response

## Tests

```bash
npm test            # Run all tests
npm run test:watch  # Re-run on file changes
```

Test files: `test/utils.test.js`, `test/riveTemplate.test.js`, `test/extractZip.test.js`, `test/findBannerEntry.test.js`, `test/captureBackup.test.js`, `test/browserPool.test.js`, `test/concurrencyConfig.test.js`, `test/frontendUi.test.js`, `test/validatorModel.test.js`, `test/validatorChecks.test.js`, `test/validatorService.test.js`, `test/validatorApi.test.js`, `test/validatorFrontend.test.js`, `test/apiContract.test.js`, `test/auth.test.js`, `test/jobs.test.js`, `test/storage.test.js`, `test/security.test.js`, `test/observability.test.js`.

Tests cover:
- ZIP path-traversal safety (`isPathSafe`)
- ZIP extraction limits (max entries, max entry size, max total size) and filtration (`__MACOSX`, dotfiles)
- HTML banner discovery (single file, subdirectories, shallowest preference, ignored dirs)
- Dimension parsing from HTML meta/canvas/div tags and filenames
- Rive HTML template generation and XSS escaping
- JPEG quality tier fallback (size cap, preferred-quality priority)
- Output file deduplication
- Playwright navigation error resilience, backup contract fast path, and fallback end-frame timing
- Browser pool reuse and capture concurrency configuration
- Frontend polling behavior, modal focus management, accessible progress semantics, live status text, and per-file accessible status summaries
- Validator model, check modules, orchestration, API, and frontend report behavior
- API v1 contract: 22 HTTP tests for health, upload, process, status, files, download, error shapes, legacy aliases
- Auth integration: 33 tests for adapter unit, production 401, own-job access, cross-user 404, tenant isolation, health bypass, legacy auth
- Job model + store: 48 tests for FileInfo, Job transitions/ownership/toJSON, InMemoryJobStore CRUD/lifecycle
- Storage isolation: 27 tests for path construction, directory lifecycle, cleanup cross-contamination, URL traversal rejection, result ZIP streaming, stale pruning
- Security hardening: 14 tests for security headers, CORS configuration, HTML escaping, ZIP magic-byte validation, rate limiting
- Observability: 16 tests for logger child/context/step methods, metrics increment/timing/percentile/reset, health endpoint metrics exposure

## Project Structure

```
rive-backup-generator/
├── input/              # Place ZIP files here (CLI)
├── output/             # Generated JPGs (CLI)
├── temp/               # Extracted ZIPs, uploads, results (auto-managed, gitignored)
├── docs/
│   └── creative-backup-contract.md # Fast backup-frame contract for creatives
├── test/               # Automated tests
├── src/
│   ├── auth/
│   │   ├── adapter.js  # Auth adapters (HeaderAuth, DevAuth)
│   │   └── middleware.js# Auth middleware factory
│   ├── jobs/
│   │   ├── Job.js      # Job + FileInfo model
│   │   └── JobStore.js # JobStore interface + InMemoryJobStore
│   ├── storage/
│   │   └── LocalStorage.js # Job-scoped filesystem storage
│   ├── index.js        # CLI entry point
│   ├── webServer.js    # Express web server
│   ├── captureBackup.js# Playwright screenshot + Sharp compression
│   ├── browserPool.js  # Reusable Playwright Chromium pool
│   ├── config.js       # Runtime config parsing (capture concurrency)
│   ├── extractZip.js   # Safe ZIP extraction
│   ├── findBannerEntry.js
│   ├── detectBannerSize.js
│   ├── localServer.js  # Static file server (factory pattern)
│   ├── riveTemplate.js # Rive HTML template generator
│   ├── logger.js       # Structured logger (JSON / pretty)
│   ├── metrics.js      # In-memory counters + timings
│   ├── utils.js
│   └── public/         # Web UI frontend
│       ├── index.html
│       ├── style.css
│       └── animation.gif
├── package.json
└── README.md
```

## Requirements

- Node.js 20+
- Chromium (installed via `npx playwright install chromium`)
