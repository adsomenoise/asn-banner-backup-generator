# Lachmed comparison and replacement roadmap

This document explains how [Lachmed](https://github.com/adsomenoise/lachmed-api) and this repository generate banner backup images, where their behavior differs, and how this project can evolve into a safe replacement for Lachmed.

It is based on:

- Lachmed `master` at commit `a2b000dc5b558f944fcfad4411b410bb499a9ec8`.
- This repository `main` at commit `4347e40555911dde3ec03315e2cc763c7ec6cdde`.
- Code inspected on 2026-08-25. Re-check both implementations before relying on details after either repository changes.

## Executive summary

The two projects overlap at the Chromium screenshot stage, but currently solve different-sized problems:

- **Lachmed is a synchronous URL-to-image microservice.** It receives public banner URLs as JSON, detects or waits for an end frame, and returns base64 PNG/JPEG data in the same HTTP response.
- **This project is a complete upload-to-download workflow.** It accepts ZIP, Rive, and video files, validates and extracts them, serves creatives locally, processes them as asynchronous jobs, stores JPG results, and packages downloads. It also includes authentication, ownership, rate limiting, metrics, bounded concurrency, a web UI, a CLI, validation, and tests.

This project is therefore the stronger foundation for a replacement. It now has full-viewport visual-stability detection and configurable PNG/JPEG output with caller-defined size targets; the main remaining parity gaps are Lachmed's Rive end-state convention, support for remote URL input, and a transition-compatible API.

The recommended direction is **not to copy Lachmed wholesale**. Extract a shared capture engine inside this project, add deterministic end-frame signals first and Lachmed-compatible stability detection as a fallback, then expose an authenticated compatibility endpoint. Run both engines against the same production corpus before switching traffic.

## System boundaries

### Lachmed

```text
Bannerama / HTTP client
        |
        | POST / (JSON array of remote banner URLs)
        v
Express -> one Puppeteer browser per request
        -> one page per banner, all concurrently
        -> remote HTTP(S) banner
        -> end-frame detection
        -> Puppeteer screenshot
        -> pngquant or iterative JPEG quality reduction
        -> base64 images in the HTTP response
```

Relevant files in Lachmed:

- `server.js`: Express bootstrap and the two routes.
- `screenshotController.js`: browser lifecycle, animation detection, capture, compression, and response assembly.
- `inject.js`: CreateJS final-frame handling and in-page stability polling.
- `commonFunctions.js`: timestamp, load-average, and memory logging.
- `Dockerfile`, `docker-compose.yml`, `render.yaml`, `pm2.yaml`, `deploy.sh`: current and legacy runtime definitions.

### This project

```text
Web UI / API / CLI
        |
        | upload ZIP, .riv, or video
        v
Job + ownership -> bounded worker concurrency
        -> safe extraction / Rive HTML generation / video path
        -> entry and dimension detection
        -> local static server
        -> shared Playwright browser pool
        -> explicit backup strategy or timeout fallback
        -> screenshot or ffmpeg video frame
        -> Sharp JPEG compression
        -> result ZIP + timed cleanup
```

Relevant files here:

- `src/webServer.js`: API, authentication, uploads, jobs, processing, cleanup, downloads, and validator endpoints.
- `src/index.js`: sequential CLI batch workflow.
- `src/captureBackup.js`: transport-neutral Playwright capture orchestration.
- `src/capture/`: end-frame strategies, screenshot acquisition/debug artifacts, and configurable PNG/JPEG encoding.
- `src/browserPool.js`: bounded, reusable Chromium pool.
- `src/localServer.js`: serves extracted creatives over localhost HTTP.
- `src/extractZip.js`: bounded extraction and path-traversal protection.
- `src/findBannerEntry.js`, `src/detectBannerSize.js`, `src/checkAssetPaths.js`: creative discovery and preflight checks.
- `src/captureVideo.js`: video last-frame capture.
- `src/riveTemplate.js`: standalone `.riv` wrapper generation.
- `src/validator/`: platform-aware creative validation.
- `src/jobs/`, `src/storage/`: job models, ownership, and local artifact lifecycle.
- `src/logger.js`, `src/metrics.js`: structured diagnostics and in-memory metrics.
- `docs/creative-backup-contract.md`: deterministic creative-to-capture contract.

## Lachmed API and workflow

### Endpoints

`GET /health` returns plain text `OK`.

`POST /` expects a JSON array. There is no explicit schema validation; these fields are read from each item:

| Field | Purpose | Default |
|---|---|---:|
| `url` | Remote banner URL | required in practice |
| `foldername` | Identifier echoed in the result | none |
| `width` | viewport width | `300` |
| `height` | viewport height | `300` |
| `delay` | maximum end-frame wait, seconds | `30` |
| `format` | `png`, `jpg`, or `jpeg` | `png` |
| `maxfilesize` | desired maximum size, KiB | `150` |
| `legacymode` | omit `inject.js` manipulations | `false` |

Example request:

```json
[
  {
    "url": "https://example.invalid/banner/index.html",
    "foldername": "campaign/banner-300x250",
    "width": 300,
    "height": 250,
    "delay": 30,
    "format": "png",
    "maxfilesize": 150,
    "legacymode": false
  }
]
```

Example result item:

```json
{
  "foldername": "campaign/banner-300x250",
  "format": "png",
  "warnings": [],
  "data": "<base64 image>"
}
```

Results are pushed when pages finish, so their order can differ from request order.

### Browser lifecycle

Each `POST /` launches a new Puppeteer browser. Every array item opens a page concurrently. The browser closes only when the number of accumulated results equals the number of request items. The request socket timeout is set to five minutes.

Production uses system Chromium and container-oriented arguments including `--no-sandbox`, `--disable-dev-shm-usage`, `--single-process`, and `--disable-web-security`. Development hardcodes the macOS Google Chrome application path.

### End-frame detection

Before navigation, Lachmed installs a script with `evaluateOnNewDocument`. It:

1. Wraps `requestAnimationFrame` before creative code runs.
2. Samples all canvases at most every 100 ms, after animation callbacks render.
3. Downscales each canvas to `32 x 32` and builds a lightweight combined pixel hash.
4. Tracks the number of distinct sampled frames and the time of the last visual change.
5. Wraps `rive.Rive` and sets `window.bannerEnded` when a state named `end` or `main_animation_rollout` is entered. Matching is trimmed and case-insensitive.

A visual is considered settled after at least three distinct frames and eight seconds without a hash change. The configured `delay` is the hard deadline.

In normal mode, `inject.js` additionally:

- moves videos to `video.duration`;
- recursively sends CreateJS timelines to their last frame;
- gives CreateJS without TweenMax a one-second fast path;
- otherwise polls the sampler in-page and calls the exposed Node callback.

Legacy mode skips `inject.js` to avoid CreateJS and global manipulation, but Node still polls the sampler installed before navigation.

### Image output

- JPEG starts at quality 100 and is recaptured in five-point quality reductions until it meets the requested size or runs out of quality levels.
- PNG is captured first and passed through `imagemin-pngquant` at quality `0.6-0.8` when oversized.
- An oversized PNG is converted to JPEG and gets a warning.
- The result is base64-encoded and returned in JSON.

The file-size target is best-effort, not guaranteed.

## Current project workflow

### Web/API path

The current service uses a two-phase asynchronous job protocol:

1. `POST /api/v1/jobs` uploads up to 50 files, each up to 200 MB.
2. `POST /api/v1/jobs/{jobId}/process` starts work and returns immediately.
3. `GET /api/v1/jobs/{jobId}` reports job and per-file state.
4. `GET /api/v1/jobs/{jobId}/download` returns a ZIP of successful JPGs plus `errors.json` when applicable.

It supports ZIP creatives, standalone `.riv` files, and common video formats. Jobs and artifacts expire after 30 minutes. See `README.md` for the complete API, including append, retry, cancel, validator, and legacy routes.

### Per-file pipeline

ZIP input:

1. Extract with entry-count, per-entry size, total-size, and path-traversal limits.
2. Find the banner HTML entry.
3. Detect dimensions from metadata, canvas, filename, or fallback.
4. Check local asset references and report missing assets.
5. Serve the extracted directory on a loopback-only Express server.
6. Capture with Playwright.
7. Compress to JPG with Sharp and include it in the result ZIP.

Standalone Rive input is wrapped in generated HTML after dimensions are parsed from its filename. Video input bypasses Chromium and uses the dedicated video/ffmpeg path.

Generated standalone Rive wrappers implement the explicit backup contract automatically. They handle `?backup=1`, expose `window.generateBackupFrame()` and `window.riveInstance`, pause and scrub the Rive instance, wait for two browser paint frames, and then set `window.__backupReady = true`.

For uploaded ZIP creatives, the validator reports:

- `HAS_BACKUP_HOOK` when it detects a ready signal plus either `?backup=1` handling or `window.generateBackupFrame()`.
- `MISSING_BACKUP_HOOK` when the creative does not expose a complete explicit contract and would require visual-stability fallback.

Detection covers inline HTML and locally bundled JavaScript referenced by `<script src="...">`; validator metadata identifies the source files containing contract pieces. The contract guide includes copy-ready generic, GSAP, CreateJS, and Rive integration recipes for external creative authors.

Normal job processing also adds an actionable per-file warning whenever capture actually uses the fallback, directing the creative author to the explicit contract.

### Capture strategies

`captureBackup()` tries these strategies in order when `strategy: "auto"`:

1. Load with `?backup=1` and wait briefly for `window.__backupReady` or the legacy `window.__BACKUP_READY__`.
2. Call `window.generateBackupFrame()` when available, supporting synchronous and asynchronous implementations.
3. Observe Rive state changes and capture configured terminal states, defaulting to `end` and `main_animation_rollout`.
4. If the creative contains HTML `<video>` elements, pause and seek all of them directly to their final decodable frame.
5. Use `window.riveInstance.scrub(Number.MAX_SAFE_INTEGER)` when a compatible instance is exposed.
6. Sample low-resolution full-viewport screenshots every 250 ms, capture after two seconds of visual stability, or capture the final available frame at the configured hard deadline.

It waits for fonts before taking a clipped PNG screenshot, then converts the screenshot to an optimized JPG. The default target is 80 KiB, using quality tiers `95, 80, 65, 50, 35` plus the caller's preferred quality.

The strategy string for step 5 is currently `Fallback timeout` for both possible outcomes. This label does not mean every capture reached the deadline. The preceding `Visual stability` log records the actual outcome:

- `settled`: the screenshot was triggered early after two seconds without a meaningful visual change.
- `timeout`: the hard deadline was reached while the visual was still changing.

The browser pool reuses Playwright browser processes. A global semaphore bounds concurrent file work; `CAPTURE_CONCURRENCY` defaults to 3 and is capped at 8.

## Side-by-side comparison

| Concern | Lachmed | Current project | Replacement implication |
|---|---|---|---|
| Primary input | JSON array of remote URLs | uploaded ZIP, Rive, or video files | add a controlled remote-URL adapter only if Bannerama still requires it |
| Response model | synchronous base64 JSON | asynchronous jobs and ZIP download | offer a compatibility facade during migration; keep jobs internally |
| Browser library | Puppeteer 24 | Playwright 1.50 | keep Playwright unless a measured incompatibility appears |
| Browser lifecycle | new browser per request | bounded reusable browser pool | current project is more efficient and predictable |
| Concurrency | all request items concurrently | semaphore plus bounded pool | retain current limits and add queue/backpressure metrics |
| Creative hosting | caller-controlled remote URL | extracted content on loopback server | local serving reduces SSRF exposure and improves reproducibility |
| Explicit creative contract | Rive state names and CreateJS heuristics | `?backup=1`, ready globals, function hook, Rive instance | standardize one contract and retain adapters for old creatives |
| Generic motion detection | samples all canvases over real animation time | samples the full rendered viewport over real time and settles after 2 seconds | benchmark the stability window and pixel threshold against the production corpus |
| Rive completion | wraps `rive.Rive`; recognizes two state names | requires exposed `window.riveInstance.scrub()` or timeout | add state-event support; avoid relying only on scrub |
| CreateJS | recursively teleports timelines | no dedicated CreateJS adapter | add only if corpus tests show it is needed |
| Video elements in HTML | seeks to `video.duration` | pauses and seeks to the final decodable frame, then waits for paint | current project now bypasses the 15-second fallback for video creatives |
| Standalone video files | unsupported | supported through ffmpeg | current project is broader |
| Output | PNG or JPEG, per-item target | configurable PNG/JPEG, quality, and best-effort byte target with compliance metadata | validate exact encoding parity against Bannerama's requirements |
| Delivery | base64 in response | files in result ZIP | support both at the boundary, not in the capture core |
| Ordering | completion order | stable per-file job identity | compatibility response must restore request order |
| Validation | none | validator presets, missing-asset checks, and explicit-contract findings | keep contract guidance in the normal creative workflow |
| Authentication | none | development or gateway-backed auth and ownership | never expose a Lachmed-compatible route without auth |
| Rate limiting | none | per-IP mutation limiter | retain; consider a shared store when horizontally scaled |
| ZIP safety | not applicable | bounded, traversal-safe extraction | retain |
| Observability | console timing/load messages | structured logger, counters, timings, browser errors | add strategy/outcome/quality/SLO dashboards |
| Tests | none found | broad Node test suite and lint gate | add golden-image and dual-engine parity tests |
| Persistence | request-local only | in-memory jobs plus local files and TTL | externalize state/storage before multi-replica deployment |

## Important behavioral differences

### 1. “Final frame” means different things

Lachmed mostly observes an animation running in real time. It captures after an explicit Rive signal, eight seconds of visual stillness, a CreateJS teleport, or a hard timeout.

This project prefers an explicit creative contract, then tries a Rive scrub, then observes the complete viewport in real time. The fallback now sees CSS, DOM, canvas, WebGL, timer-driven, and media animation without replacing the creative's animation scheduler. It captures after two seconds without a meaningful pixel change, with the configured duration retained as a hard deadline.

The explicit contract remains the most deterministic option. For unmodified legacy banners, the current project's full-viewport sampler is broader than Lachmed's canvas-only sampler, but its shorter stability window should be validated against creatives containing deliberate pauses.

Unlike Lachmed, the current detector does not require a minimum number of observed visual changes before it may settle. A completely static page can therefore finish after two seconds, which is useful for static creatives but can capture too early when an animation has a delayed start.

### 2. The visual-stability tradeoff is now coverage versus sampling cost

This project captures the viewport, reduces it to `32 x 32`, and compares average pixel deltas. This covers DOM, CSS, canvas, WebGL, images, and video with one mechanism. Lachmed's browser-side canvas sampling is cheaper per sample, but cannot see DOM-only changes.

The current full-viewport method creates and decodes a PNG every 250 ms. Benchmark CPU cost under normal concurrency and consider CDP-native or raw-frame sampling only if profiling shows this is material. Correctness should be validated for subtle motion, compression noise, deliberate pauses longer than two seconds, and late animation starts.

### 3. The output contracts are incompatible

Bannerama can call Lachmed once with URLs and immediately receive base64 data and warnings. This project requires upload, process, polling, and download calls. Replacing the service without changing Bannerama therefore requires a compatibility endpoint or an orchestrated Bannerama migration.

### 4. The trust models differ

Lachmed navigates directly to caller-provided URLs with web security disabled and no visible authentication or URL policy. That allows SSRF and access to addresses reachable from the service container.

This project normally renders uploaded files through a loopback server, which is safer and reproducible, but uploaded creative code can still make network requests from Chromium. Disabling web security does not provide isolation. Production should apply browser egress restrictions and request interception regardless of which input route is used.

## Current project strengths to preserve

- Bounded concurrency and reusable browsers.
- Isolated browser contexts per capture.
- Safe ZIP extraction and upload limits.
- File-level states, partial success, retry, cancellation, and clear errors.
- Authentication, tenant/user ownership, security headers, and rate limiting.
- Local, reproducible creative serving.
- Structured logs, metrics, browser console/page error capture, and optional debug artifacts.
- Validator presets and missing-asset reporting.
- CLI and web workflows using the same capture code.
- Automated tests, linting, preflight checks, and a documented release process.
- Native support for standalone Rive and video files.
- Generated standalone Rive wrappers implement the explicit backup contract automatically; ZIP validation and processing surface actionable contract guidance.

## Gaps and risks to address

### Replacement blockers

1. **No Lachmed-compatible endpoint.** Bannerama cannot switch URLs without changing its request flow.
2. **No remote URL capture path.** The existing flow requires file upload.
3. **End-frame parity is unproven.** Rive state names, CreateJS, WebGL, GSAP, CSS, and timer-driven creatives need corpus testing.
4. **No parity result model.** Lachmed returns per-item warnings and base64 data. The capture core now returns the required buffer and metadata, but no compatibility transport exposes Lachmed's response shape yet.

### Current technical risks

1. The two-second stability window may capture during deliberate mid-animation pauses; tune it using the production corpus rather than assumptions.
2. Full-viewport PNG sampling every 250 ms adds CPU work; measure it at production concurrency.
3. A static or unchanged initial frame can settle after two seconds even if an animation is designed to start later. Consider a minimum observation period or creative metadata for known delayed starts.
4. PNG/JPEG and byte targets are configurable and the result reports `withinSizeLimit`, but exact conversion/fallback policy still needs agreement for Lachmed compatibility.
5. Browser processes are reused and disconnected browsers are discarded on release (and when found idle), then replaced within the configured pool capacity. Broader crash-rate metrics and process-supervision policy remain future work.
6. Jobs and rate-limit state are process-local; result files are local. Multiple replicas or restarts can lose job visibility.
7. A new local Express server is created per processing job. Ephemeral ports avoid most conflicts, but one shared hardened creative server would reduce lifecycle overhead.
8. Local creative pages may initiate arbitrary outbound requests. Request interception and network policy are needed for strong isolation.
9. The Docker image installs Playwright browser assets in both build and production stages and manually lists browser libraries; using a pinned official Playwright runtime or copying the browser cache once could simplify and shrink builds.

### Lachmed risks not to inherit

- Unauthenticated remote navigation and SSRF exposure.
- Unbounded per-request page concurrency.
- A fresh Chromium process for every request.
- Missing request validation and top-level error handling.
- Race-prone `pageerror` behavior that can capture alongside the normal completion callback.
- Completion-order responses instead of input-order responses.
- Best-effort size limits without explicit compliance metadata.
- Docker Compose health checking `GET /`, which is a 404 because `/` is POST-only; `/health` is the correct endpoint.
- No automated tests or API schema.

## Target architecture

Build one capture engine and keep transport, storage, and compatibility concerns outside it:

```text
                        +-----------------------------+
Upload/job API -------->|                             |
CLI ------------------->| normalized CaptureRequest   |
Lachmed compatibility ->| adapter                     |
                        +--------------+--------------+
                                       |
                                       v
                        +-----------------------------+
                        | Capture engine              |
                        | - browser/context lifecycle |
                        | - navigation policy         |
                        | - end-frame strategies      |
                        | - screenshot                |
                        +--------------+--------------+
                                       |
                                       v
                        +-----------------------------+
                        | Output policy               |
                        | PNG/JPEG, quality, max size |
                        | warnings and diagnostics    |
                        +--------------+--------------+
                                       |
                                       v
                         file, base64, or object store
```

A normalized internal request should contain at least:

```js
{
  source: { type: 'local-url' | 'remote-url', url },
  dimensions: { width, height },
  timeoutMs,
  endFrame: {
    strategy: 'auto',
    stableForMs,
    minimumChanges,
    recognizedRiveStates
  },
  output: {
    format: 'png' | 'jpeg',
    maxBytes,
    preferredQuality
  },
  diagnostics: { debugDir, retainArtifacts }
}
```

The capture result should be transport-neutral:

```js
{
  buffer,
  format,
  byteLength,
  withinSizeLimit,
  strategy,
  outcome,
  durationMs,
  warnings,
  browserErrors
}
```

The web job flow can save `buffer`; a Lachmed facade can base64-encode it; the CLI can write it directly.

## Recommended optimization and migration plan

Status legend:

- ✅ **Fixed / complete** — implemented and covered by the current project.
- 🟡 **In progress** — partially implemented or implemented but still awaiting corpus/production validation.
- ⬜ **Not started** — no verified implementation exists yet.

### Phase 0 — Establish evidence

Before changing capture behavior:

1. ⬜ **Not started:** Assemble a representative, versioned corpus of real banners: Rive state machines, CreateJS, GSAP/TweenMax, CSS/DOM animation, WebGL, HTML video, static banners, broken assets, infinite loops, delayed network assets, and each common size.
2. ⬜ **Not started:** Record Lachmed output, this project's output, duration, format, byte size, warnings, and failures for every creative.
3. ⬜ **Not started:** Define acceptance criteria, for example:
   - correct intended frame for at least 99% of the production corpus;
   - no blank/transparent output;
   - dimensions always exact;
   - requested size met or an explicit warning returned;
   - no response-order mismatch;
   - bounded memory and p95 processing time.
4. ⬜ **Not started:** Store expected images and use perceptual comparison rather than byte equality.

Without this corpus, “parity” is subjective and changes to animation handling are risky.

### Phase 1 — Refactor without changing behavior

1. ✅ **Fixed:** `captureBackup.js` now contains orchestration only. End-frame behavior lives in `src/capture/endFrameStrategies.js`, screenshot acquisition/debug artifacts in `src/capture/screenshot.js`, and encoding in `src/capture/outputEncoder.js`.
2. ✅ **Fixed:** The capture core accepts `format` (`jpeg`/`jpg`/`png`), `quality`, and `maxBytes`. The 80 KiB JPEG behavior remains the default, while callers can select PNG, change the byte target, or disable it. Results explicitly report whether the target was met.
3. ✅ **Fixed:** The capture core returns the encoded `buffer` plus format, byte length, quality, maximum-size compliance, strategy, outcome, duration, and browser errors. The CLI and web worker now choose paths and write the buffer themselves.
4. ✅ **Fixed:** Every file has a stable `inputIndex`; concurrent results are sorted by that index before packaging and persistence, giving future Lachmed-compatible adapters an explicit input-order invariant.
5. ✅ **Fixed:** Navigation, load-state waiting, explicit-contract checks, video seeking, Rive settling, visual stabilization, end-frame selection, and the overall capture budget are normalized in the exported immutable `DEFAULT_CAPTURE_POLICY`. Callers can override the policy as one object; legacy `waitTimeout` remains supported.
6. ✅ **Fixed:** The browser pool checks `browser.isConnected()` on release and before leasing idle browsers. Disconnected processes are closed, removed from the pool count, and replaced for queued work.

### Phase 2 — Improve end-frame correctness

Use this priority order:

1. 🟡 **In progress — explicit creative contract:** `?backup=1`, `generateBackupFrame()`, and a ready signal are implemented in generated Rive wrappers, documented in `docs/creative-backup-contract.md`, detected in inline and bundled ZIP JavaScript, and recommended by per-file fallback warnings. Adoption across externally authored creatives remains ongoing.
2. ✅ **Fixed — explicit runtime signals:** a pre-navigation hook recognizes configurable Rive state names (defaulting to Lachmed's case-insensitive, trimmed `end` and `main_animation_rollout` conventions), reports `outcome: "rive-state"`, and preserves the creative's own callback and arguments.
3. 🟡 **In progress — technology adapters:** standalone video last-frame extraction, HTML video seeking, and exposed Rive instance scrubbing are implemented and tested. CreateJS teleporting and broader corpus coverage remain outstanding.
4. ✅ **Fixed — generic visual stability:** low-resolution full-viewport samples run every 250 ms with a two-second stable window and a 15-second hard deadline. This covers DOM and WebGL as well as canvas without replacing the animation scheduler. Production tuning and delayed-start policy remain follow-up validation work.
5. ✅ **Fixed — hard timeout:** the final available frame is captured at the deadline, processing surfaces a fallback warning, and the transport-neutral capture result reports `outcome: "settled"` or `outcome: "timeout"` independently of the compatibility strategy label.

Synthetic rAF draining was removed from the generic fallback. Real-time viewport sampling now observes the creative without replacing its animation scheduler.

Useful outcome values are `explicit-ready`, `rive-state`, `video-seeked`, `createjs-final-frame`, `visually-settled`, and `timeout`. Expose them in logs, metrics, and results.

### Phase 3 — Add a safe compatibility facade

⬜ **Not started.** Add a versioned endpoint such as `POST /api/v1/lachmed/render`, protected by the existing authentication and rate limiter. It may accept the Lachmed request shape, but should:

- validate that the body is a non-empty bounded array;
- validate dimensions, delay, format, maximum size, and URL length;
- cap items per request and total wall time;
- preserve input order;
- use the global concurrency limiter and browser pool;
- return a result or structured error for every item;
- return Lachmed-compatible fields during the transition;
- optionally include additive diagnostic fields for migration analysis.

If remote URLs are necessary, apply all of the following:

- permit only `http:` and `https:`;
- resolve DNS and reject loopback, link-local, private, multicast, and metadata-service addresses, including redirect targets;
- re-check each redirect and defend against DNS rebinding;
- block `file:`, `data:`, `javascript:`, WebSocket, and other schemes;
- intercept subresource requests and apply an explicit egress policy;
- set navigation and total-byte limits;
- isolate Chromium at the container/network layer, not only in JavaScript;
- audit every remote target without logging credentials or sensitive query values.

A safer alternative is to change Bannerama to upload the creative artifact or place it in approved object storage and pass a short-lived signed reference. Prefer that over general remote URL rendering.

### Phase 4 — Shadow and compare

1. ⬜ **Not started:** Mirror eligible Bannerama requests to the new adapter without using its result.
2. ⬜ **Not started:** Compare outputs perceptually and collect strategy, duration, byte size, warning, timeout, crash, and memory metrics.
3. ⬜ **Not started:** Review mismatches by creative technology and fix categories rather than individual banners.
4. ⬜ **Not started:** Canary a small percentage of real responses from the new service.
5. ⬜ **Not started:** Keep an immediate per-request fallback to Lachmed during the canary.
6. ⬜ **Not started:** Increase traffic only after error rate, image parity, and latency meet the agreed thresholds.

### Phase 5 — Cut over and retire

1. ⬜ **Not started:** Freeze the Lachmed API contract and document the replacement endpoint/version.
2. ⬜ **Not started:** Move all Bannerama traffic to this service.
3. ⬜ **Not started:** Retain Lachmed as a monitored fallback for an agreed observation period.
4. ⬜ **Not started:** Remove fallback only after the long-tail corpus and production metrics are acceptable.
5. ⬜ **Not started:** Archive Lachmed's runtime configuration and final known-good image for rollback/audit purposes.

## Performance priorities

Highest-value optimizations, in recommended order:

1. 🟡 **In progress:** Continue adoption of the explicit backup contract in externally authored ZIP creatives. Generated standalone Rive wrappers, validator findings, bundled-JavaScript detection, documentation recipes, and runtime fallback warnings now support this effort.
2. 🟡 **In progress:** Early real visual-stability detection with a 15-second hard deadline is implemented and tested; production-corpus tuning remains outstanding.
3. 🟡 **In progress:** Browsers are pooled, contexts are isolated and closed, and disconnected processes are replaced. Queue-wait and lease-duration metrics remain outstanding.
4. ⬜ **Not started:** Tune `CAPTURE_CONCURRENCY` from measured CPU, memory, crash rate, and p95 latency—not CPU count alone.
5. ⬜ **Not started:** Separate capture concurrency from extraction/compression concurrency; Chromium and Sharp have different resource profiles.
6. ✅ **Fixed:** Internal capture and job flows use buffers/files rather than base64. Base64 is reserved for a future compatibility boundary if required.
7. ⬜ **Not started:** Make browser resource loading policy explicit. Block analytics, trackers, popups, downloads, and unnecessary third-party requests while allowing required creative assets.
8. ⬜ **Not started:** Cache immutable, approved runtime assets such as the Rive runtime where licensing and deployment permit.
9. ⬜ **Not started:** Use a shared creative-serving process rather than one local server per job after confirming ownership/path isolation.
10. 🟡 **In progress:** Sharp now provides configurable PNG/JPEG encoding behind one output policy, while ffmpeg supplies standalone video frames. Comparative encoding benchmarks remain outstanding.

## Reliability and observability requirements

🟡 **In progress.** Structured logging and in-memory metrics exist, including total capture duration, strategy, browser-error count, compression timing, and visual-stability outcome/duration. The following coverage is still partial:

- queue wait, browser acquisition, navigation, stabilization, screenshot, compression, and total duration;
- strategy attempted and strategy selected;
- end-frame outcome and timeout reason;
- input and output byte sizes, selected quality, format conversion, and limit compliance;
- browser disconnect/crash, context creation failure, page error, and blocked request counts;
- active jobs, active captures, waiting captures, browsers total/idle, and cleanup failures;
- parity mismatch score during shadowing.

🟡 **In progress:** Job and file IDs are present in processing logs, but request IDs and capture-attempt IDs are not consistently propagated. Production logs should continue to avoid full remote URLs, authentication tokens, and uploaded content.

🟡 **In progress:** The health endpoint exposes process health and metrics, but it does not yet fully distinguish:

- **liveness:** the Node process can answer;
- **readiness:** storage is writable, required binaries exist, and the browser pool can launch or has a healthy browser;
- **capacity:** useful as a metric, but a saturated queue should normally not make the process fail liveness.

## Testing required for replacement confidence

Add the following to the existing test suite:

1. ⬜ **Not started:** Contract tests for the Lachmed-compatible request and response, including order preservation and partial errors.
2. ⬜ **Not started:** Golden/perceptual image tests for every corpus category.
3. ⬜ **Not started:** Fixtures for the two recognized Rive end states and user-provided `onStateChange` callbacks.
4. 🟡 **In progress:** DOM animation, static/delayed changes, visual settling, and HTML-video last-frame behavior have capture tests. CreateJS, TweenMax/GSAP, CSS-only, WebGL, multi-canvas, real video media, infinite-loop, and broader delayed-start fixtures remain outstanding.
5. 🟡 **In progress:** JPEG and PNG encoding, caller-defined limits, impossible targets, and exact capture behavior have tests. Cross-format conversion policy and alpha-handling fixtures remain outstanding.
6. 🟡 **In progress:** Context closure uses `finally`, browser-pool waiting/reuse is tested, and job cancellation exists. Failure-path resource-release coverage is not yet exhaustive.
7. 🟡 **In progress:** Browser-pool tests prove disconnected processes are discarded on release and when discovered idle, and that queued work receives a replacement. An integration test that kills a real Chromium process mid-capture remains outstanding.
8. ⬜ **Not started:** SSRF tests covering IPv4/IPv6 loopback, private ranges, redirects, encoded addresses, DNS rebinding assumptions, cloud metadata, and prohibited schemes.
9. ⬜ **Not started:** Load tests with more items than `CAPTURE_CONCURRENCY`, large multi-file jobs, and simultaneous tenants.
10. ⬜ **Not started:** Shadow comparison reports showing perceptual mismatch and manual adjudication.

## Suggested next implementation slice

The next smallest high-value slice is:

1. ✅ **Fixed:** A transport-neutral capture result contains the encoded buffer and metadata; persistence is handled by callers.
2. ✅ **Fixed:** JPEG/PNG and `maxBytes` are parameterized while preserving JPEG and 80 KiB as defaults.
3. 🟡 **In progress:** Full-viewport visual stability is implemented; make `stableForMs`, polling interval, and pixel threshold configurable and evaluate a minimum observation period or minimum change count.
4. ⬜ **Not started:** Add Rive completion for `end` and `main_animation_rollout`.
5. 🟡 **In progress:** Visual-stability and HTML-video fixtures exist; add Rive-state fixtures and broader perceptual tests.
6. ⬜ **Not started:** Benchmark the same fixtures against Lachmed.

Only after that slice is reliable should the project expose remote URL rendering or a compatibility route. That ordering improves the existing upload workflow immediately and avoids publishing a second API before its capture semantics are trustworthy.

## Replacement readiness checklist

Lachmed can be retired when all of these are true:

- ⬜ **Not started:** Bannerama's required request/response contract is implemented or Bannerama has migrated to the job API.
- ⬜ **Not started:** Remote input, if retained, has reviewed SSRF and egress controls.
- ✅ **Fixed:** PNG/JPEG output, caller-defined best-effort size limits, and explicit `withinSizeLimit` metadata are implemented. Exact parity with future Bannerama requirements still belongs to compatibility acceptance testing.
- ✅ **Fixed:** Normal jobs preserve stable file identity and assigned input indexes; concurrent results are restored to input order before packaging and persistence. A future compatibility endpoint can consume this invariant directly.
- ⬜ **Not started:** The representative creative corpus meets the agreed visual correctness threshold.
- 🟡 **In progress:** DOM/canvas visual stability, explicit hooks, Rive scrub wrappers, standalone video, and HTML video have coverage; Rive states, CreateJS, GSAP, CSS-only, WebGL, and multi-canvas coverage remain incomplete.
- 🟡 **In progress:** Context cleanup and several failure paths are covered, but one-result-per-input compatibility behavior and exhaustive leak tests are not complete.
- ⬜ **Not started:** Concurrency, memory, throughput, and p95/p99 latency meet production targets.
- 🟡 **In progress:** Jobs and artifacts have local TTL cleanup; restart recovery and multi-replica persistence are not implemented.
- 🟡 **In progress:** Structured logs and in-memory metrics exist; production alerts, dashboards, detailed capture-stage metrics, and rollback procedures remain incomplete.
- ⬜ **Not started:** A canary and observation period complete without material regression.
- ⬜ **Not started:** Lachmed fallback and archival plans are documented and tested.

## Decision guidance

If Bannerama can change its integration, prefer this project's asynchronous artifact/job API. It scales operationally, avoids large base64 responses, provides progress and partial failure, and supports richer validation.

If Bannerama cannot change immediately, build a thin Lachmed-compatible adapter over the same internal capture engine. Treat that endpoint as a migration interface rather than a second independent implementation.

The strategic goal should be one capture engine, one creative backup contract, and multiple small adapters for CLI, web jobs, validation, and temporary Lachmed compatibility.
