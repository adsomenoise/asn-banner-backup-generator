# Rive Backup Image Generator

Batch-process HTML5 banner ZIP files and generate static JPG backup images for ad platforms (CM360, DV360, Amazon Ads, etc.).

## Installation

```bash
npm install
npx playwright install chromium
```

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
| `--wait, -w` | `15000` | Fallback timeout in ms |
| `--quality, -q` | `95` | Preferred JPEG quality (10–100); falls back through lower tiers to stay under 80 KB |
| `--port, -p` | `3000` | Local server port |
| `--strategy, -s` | `auto` | Backup strategy: `auto`, `query`, `generate`, `scrub` |

## Usage — Web Interface

```bash
npm run serve
```

Open `http://localhost:3001` in your browser.

### Workflow

1. **Drop files** onto the drop zone (`.zip` or `.riv`, multiple allowed).
2. Each file appears in the list with a state badge: `uploaded` → `queued` → `processing` (with spinner) → `done` or `failed`.
3. Click **Generate backups** to start processing. An overlay with an animation GIF and cycling messages appears.
4. On completion:
   - **Success**: files show a green checkmark.
   - **Failure**: files show a red cross with an inline explanation (e.g. missing dimensions, no HTML found).
   - **Partial success**: download button still appears for successful files; a **Retry failed** button lets you re-process only the failed ones.
   - **Start over** resets everything.
5. Click **Download ZIP** to get a single archive containing: JPGs for successful files, nested per-creative ZIPs (`.html` + `.js`) for `.riv` files, and `errors.json` if any file failed.

## How It Works

1. Scans `input/` for `.zip` files (CLI) or accepts uploads (web)
2. Extracts each ZIP to `temp/{zip-name}/`
3. Locates the only `.html` file automatically (any filename)
4. Detects banner dimensions (meta tag > canvas > filename > default 300x250)
5. Serves the banner via a local HTTP server (no `file://` URLs)
6. Opens the banner in headless Chromium via Playwright
7. Applies backup strategies to reach the final visual state
8. Fast-forwards animations by draining queued `requestAnimationFrame` callbacks
9. Captures a PNG screenshot and compresses to JPEG (multi-tier quality, targets ≤80 KB)
10. Saves to `output/` with optional dedup suffix

## Backup Strategies

### Strategy 1 — Query Parameter (Recommended)

Loads the HTML with `?backup=1` appended. Rive creatives should check for this parameter and self-render to their final state.

### Strategy 2 — `window.generateBackupFrame()`

If the page exposes this async function, the generator calls it and waits for `window.__BACKUP_READY__ = true`.

### Strategy 3 — Rive Instance Scrub

If `window.riveInstance` is exposed with a `scrub` method, attempts to scrub to the final frame.

### Strategy 4 — Fallback Timeout

Drains animation frames, detects canvas stability, then captures whatever is on screen.

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

### Concurrency

- A global semaphore limits concurrent Playwright browser instances to 3 (`MAX_CONCURRENT`).
- Each session's files are processed in parallel within that limit.
- The local file server in CLI mode uses a factory pattern (no shared mutable state).

### Quality Settings

The `--quality` flag sets the *preferred* JPEG quality. The encoder tries the requested quality first, then falls back through `[95, 80, 65, 50, 35]` until the output fits in 80 KB. This ensures small output files even if the preferred quality would exceed the limit.

### Error Handling

- Background processing in the web server is wrapped in a try/catch — if any part of the job fails, the session transitions to `error` status (never stuck in `processing`).
- Temporary files (uploaded ZIPs, extracted directories, result JPGs) are cleaned up on success and failure.
- Playwright browser contexts are closed reliably via `try/finally` in `captureBackup.js`.
- **Per-file error tracking**: each file has an independent `state` (`uploaded` → `queued` → `processing` → `complete`/`failed`). Failed files include a user-friendly error message explaining the issue (e.g. missing `.html` in ZIP, missing dimensions in `.riv` filename, file too large).
- **Friendly error mapping**: common cryptic errors are mapped to actionable messages. Unknown errors pass through as-is.
- **`errors.json`**: when any file in a session fails, the download ZIP includes an `errors.json` with `{file, error, friendly}` entries for every failure.

### Known Tradeoffs

- Playwright requires Chromium installed (`npx playwright install chromium`); on Linux, system dependencies are needed (`npx playwright install-deps chromium`).
- The local file server serves all extracted content without authentication — it is intended only for local use.
- Sessions are stored in memory; restarting the web server loses all active and completed sessions.

## Tests

```bash
npm test            # Run all tests
npm run test:watch  # Re-run on file changes
```

Test files: `test/utils.test.js`, `test/riveTemplate.test.js`, `test/extractZip.test.js`, `test/findBannerEntry.test.js`, `test/captureBackup.test.js`.

Tests cover:
- ZIP path-traversal safety (`isPathSafe`)
- ZIP extraction limits (max entries, max entry size, max total size) and filtration (`__MACOSX`, dotfiles)
- HTML banner discovery (single file, subdirectories, shallowest preference, ignored dirs)
- Dimension parsing from HTML meta/canvas/div tags and filenames
- Rive HTML template generation
- JPEG quality tier fallback (size cap, preferred-quality priority)
- Output file deduplication
- Playwright navigation error resilience

## Project Structure

```
rive-backup-generator/
├── input/              # Place ZIP files here (CLI)
├── output/             # Generated JPGs (CLI)
├── temp/               # Extracted ZIPs, uploads, results (auto-managed, gitignored)
├── test/               # Automated tests
├── src/
│   ├── index.js        # CLI entry point
│   ├── webServer.js    # Express web server
│   ├── captureBackup.js# Playwright screenshot + Sharp compression
│   ├── extractZip.js   # Safe ZIP extraction
│   ├── findBannerEntry.js
│   ├── detectBannerSize.js
│   ├── localServer.js  # Static file server (factory pattern)
│   ├── riveTemplate.js # Rive HTML template generator
│   ├── logger.js
│   ├── utils.js
│   └── public/         # Web UI frontend
│       ├── index.html
│       └── animation.gif
├── package.json
└── README.md
```

## Requirements

- Node.js 20+
- Chromium (installed via `npx playwright install chromium`)
