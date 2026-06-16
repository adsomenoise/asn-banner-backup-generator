# Rive Backup Image Generator

Batch-process HTML5 banner ZIP files and generate static JPG backup images for ad platforms (CM360, DV360, Amazon Ads, etc.).

## Installation

```bash
npm install
npx playwright install chromium
```

## Usage

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
  --quality 90 \
  --port 3000 \
  --strategy auto
```

| Option | Default | Description |
|--------|---------|-------------|
| `--input, -i` | `./input` | Input folder with ZIP files |
| `--output, -o` | `./output` | Output folder for JPGs |
| `--wait, -w` | `15000` | Fallback timeout in ms |
| `--quality, -q` | `90` | JPEG quality (1-100) |
| `--port, -p` | `3000` | Local server port |
| `--strategy, -s` | `auto` | Backup strategy selection |

## Usage — Web Interface

Drag-and-drop interface for batch processing:

```bash
npm run serve
```

Open `http://localhost:3001` in your browser. Drop ZIP files onto the drop zone, click **Process**, then download all JPGs as a ZIP.

## How It Works

1. Scans `input/` for `.zip` files (CLI) or accepts uploads (web)
2. Extracts each ZIP to `temp/{zip-name}/`
3. Locates the only `.html` file automatically (any filename, e.g. `banner.html`, `index.html`, `ad.html`)
4. Detects banner dimensions (meta tag > canvas > filename > default 300x250)
5. Serves the banner via a local HTTP server (no `file://` URLs)
6. Opens the banner in headless Chromium via Playwright
7. Applies backup strategies to reach the final visual state
8. Fast-forwards animations via Playwright's clock API to skip waiting
9. Captures a JPG screenshot
10. Saves to `output/` with optional dedup suffix

## Backup Strategies (Priority Order)

### Strategy 1 — Query Parameter (Recommended)

The generator loads the HTML file with `?backup=1` appended (e.g. `banner.html?backup=1`). Rive creatives should check for this parameter and self-render to their final state.

### Strategy 2 — `window.generateBackupFrame()`

If the page exposes this async function, the generator calls it and waits for `window.__BACKUP_READY__ = true`.

### Strategy 3 — Rive Instance Scrub

If `window.riveInstance` is exposed and has a `scrub` method, the generator attempts to scrub to the final frame. Works for linear animations; unreliable for state machines.

### Strategy 4 — Fallback Timeout

Waits a configurable duration (default 15s) then captures whatever is on screen.

## Creative Implementation

For reliable backups, add this to your Rive banner:

```javascript
const isBackup = new URLSearchParams(location.search).get("backup") === "1";

if (isBackup) {
  // Disable click handling
  // Skip intro animations
  // Set Rive to final visual state
  window.__BACKUP_READY__ = true;
}
```

Optional helper for Strategy 2:

```javascript
window.generateBackupFrame = async function () {
  // Set Rive to final state
  // Disable all interactivity
  window.__BACKUP_READY__ = true;
};
```

## Output

- JPG files in `output/` named after the ZIP file
- `errors.json` in `output/` if any banners fail
- Duplicate names get a `_2`, `_3`, etc. suffix

## Project Structure

```
rive-backup-generator/
├── input/          # Place ZIP files here
├── output/         # Generated JPGs
├── temp/           # Extracted ZIPs (auto-managed)
├── src/            # Source modules
│   ├── index.js
│   ├── extractZip.js
│   ├── findBannerEntry.js
│   ├── detectBannerSize.js
│   ├── captureBackup.js
│   ├── localServer.js
│   ├── logger.js
│   └── utils.js
├── package.json
└── README.md
```

## Requirements

- Node.js 20+
- Chromium (installed via `npx playwright install chromium`)
