# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added
- Asset path validation (`src/checkAssetPaths.js`): scans HTML direct refs, linked CSS (`url()`, `@import`), and linked JS string literals (including cache-busting query strings) for missing files; reports non-fatal warnings in `FileInfo.warnings[]` without failing the job
- Container ZIP expansion in the validator upload flow — batch ZIPs are now expanded into individual files before validation, consistent with the backup generator flow
- `FileInfo.warnings[]` field on `FileInfo` model; warnings are surfaced in the frontend per-file list

### Changed
- Download cleanup now deferred to TTL (30 min) on transfer interruption — results are preserved for retry if a download is aborted mid-transfer (was: cleaned up on any `res.download` callback, including disconnects)
- `renderChecks.js` now routes Chromium launch through the browser pool (was: calling `chromium.launch()` directly, risking unbounded process spawning under concurrent validator jobs)
- Login comparison uses `crypto.timingSafeEqual` (was: `===`)
- Rive `.riv` files are validated against the Rive binary signature before being served to Playwright (was: copied directly as `.js` without magic-byte check)
- Frontend `<script>` block moved to `src/public/app.js`; `'unsafe-inline'` removed from `script-src` CSP directive
- ZIP container expansion added: a ZIP-of-ZIPs is auto-expanded into individual files before processing (both backup generator and validator flows)
- Video files (`.mp4`, `.mov`, `.webm`, `.avi`) now supported in batch ZIP uploads

## [1.0.0] — Initial release

### Added
- CLI mode: batch-process HTML5 banner ZIPs and `.riv` files from `input/` to `output/`
- Web UI: drag-and-drop upload, per-file progress, retry failed, download ZIP
- 4-strategy Playwright screenshot pipeline: query param → `generateBackupFrame()` → Rive scrub → fallback timeout
- Sharp JPEG compression with multi-tier quality fallback to stay under 80 KB
- Reusable Playwright browser pool with fresh context per capture
- ZIP path-traversal protection and entry/size limits
- HTML5 banner dimension detection (meta tag → canvas → div → filename → 300×250)
- Rive `.riv` file support with auto-generated wrapper HTML
- Video file support via ffmpeg frame extraction
- Auth subsystem: `DevAuthAdapter` (development) and `HeaderAuthAdapter` (production)
- Job lifecycle state machine (`Job`, `FileInfo`, `InMemoryJobStore`)
- Job-scoped static file server for Playwright (port 3002+)
- Structured logging (`src/logger.js`) and in-memory metrics (`src/metrics.js`)
- Security headers, CORS, per-IP rate limiting, ZIP magic-byte validation
- Ad Validator subsystem: preset-based checks, per-file findings with severity levels, summary status (`pass` / `warning` / `fail`)
- Validator presets: Generic QA, CM360/DV360, Google Ads, Amazon Ads, Xandr, Rive, Video
- Docker multi-stage build; Coolify deployment configuration
- CI via GitHub Actions
