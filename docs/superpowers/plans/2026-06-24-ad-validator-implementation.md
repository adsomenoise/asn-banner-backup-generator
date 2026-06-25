# Preset-Driven Ad Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate preset-driven ad validator workflow for ZIP, Rive, and video uploads without changing the existing backup-image generation behavior.

**Architecture:** Add a dedicated validator subsystem under `src/validator/` with its own job model, store, preset definitions, validation checks, and orchestration. Expose it through `/api/v1/validator/*` routes and a separate `Validate Ads` frontend mode that follows the existing accessibility patterns.

**Tech Stack:** Node.js ESM, Express, multer, AdmZip, fs-extra, Playwright/Chromium for render smoke checks, ffprobe/ffmpeg for video metadata, node:test, Playwright frontend tests.

---

## Worktree Notes

Before implementation, run:

```bash
git status --short
```

Expected current unrelated modified files may include:

```text
 M README.md
 M docs/superpowers/specs/2026-06-24-ad-validator-design.md
 M src/public/index.html
 M test/frontendUi.test.js
```

Do not revert these files. If a task needs to edit one of them, inspect the current diff first and preserve the existing accessibility/README changes.

---

## File Structure

Create:

- `src/validator/presets.js`: data-first preset definitions and preset lookup.
- `src/validator/findings.js`: finding builders, severity ordering, overall status calculation.
- `src/validator/ValidatorJob.js`: validator job/file report model.
- `src/validator/ValidatorStore.js`: in-memory validator store following `src/jobs/JobStore.js`.
- `src/validator/checks/packageChecks.js`: filename, extension, package size, ZIP structure, HTML entry, dimensions, clickTag, external references.
- `src/validator/checks/renderChecks.js`: Playwright render smoke check and blank-frame detection.
- `src/validator/checks/riveChecks.js`: Rive filename dimension and wrapper viability checks.
- `src/validator/checks/videoChecks.js`: video metadata, bitrate, audio stream, loudness, and decode viability checks.
- `src/validator/validateAd.js`: per-file validation orchestration.
- `src/validator/validatorService.js`: validator job upload/validate/status service helpers for web routes.
- `test/validatorModel.test.js`: model, findings, presets tests.
- `test/validatorChecks.test.js`: unit tests for package/Rive/video checks.
- `test/validatorApi.test.js`: API contract tests for validator routes.
- `test/validatorFrontend.test.js`: Playwright tests for the validator UI mode.

Modify:

- `src/captureVideo.js`: export metadata helpers needed by validator (`getVideoMetadata`, `probeVideoLoudness`) while preserving existing exports.
- `src/webServer.js`: mount validator routes under `/api/v1/validator`.
- `src/public/index.html`: add `Generate Backups` / `Validate Ads` modes and validator UI.
- `src/public/style.css`: add compact styles for mode tabs, validator preset selector, and findings report.
- `README.md`: document validator workflow and API.

---

### Task 1: Validator Presets, Findings, and Models

**Files:**

- Create: `src/validator/presets.js`
- Create: `src/validator/findings.js`
- Create: `src/validator/ValidatorJob.js`
- Create: `src/validator/ValidatorStore.js`
- Test: `test/validatorModel.test.js`

- [ ] **Step 1: Write failing model/preset tests**

Create `test/validatorModel.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PRESETS, getPreset } from '../src/validator/presets.js';
import { buildFinding, summarizeFindings } from '../src/validator/findings.js';
import { ValidatorJob, ValidatorFileReport } from '../src/validator/ValidatorJob.js';
import { ValidatorStore } from '../src/validator/ValidatorStore.js';

describe('validator presets', () => {
  it('exposes the initial preset set', () => {
    assert.deepStrictEqual(Object.keys(PRESETS).sort(), [
      'amazon_ads',
      'cm360_dv360',
      'generic',
      'google_ads',
      'rive',
      'video'
    ]);
    assert.strictEqual(getPreset('generic').label, 'Generic QA');
    assert.strictEqual(getPreset('cm360_dv360').requiresClickTag, true);
  });

  it('rejects unknown preset ids', () => {
    assert.throws(() => getPreset('unknown'), /Unknown validator preset/);
  });
});

describe('validator findings', () => {
  it('builds structured findings and summarizes status', () => {
    const error = buildFinding('error', 'MISSING_HTML', {
      title: 'Missing HTML entry',
      message: 'The ZIP must contain at least one .html file.',
      suggestion: 'Add an HTML entry point.',
      path: 'creative.zip'
    });
    const warning = buildFinding('warning', 'EXTERNAL_REFERENCE', {
      title: 'External reference',
      message: 'External asset references may be rejected.',
      suggestion: 'Bundle assets in the ZIP.',
      path: 'index.html'
    });

    assert.strictEqual(error.severity, 'error');
    assert.strictEqual(error.code, 'MISSING_HTML');
    assert.deepStrictEqual(summarizeFindings([warning]), {
      status: 'warning',
      errors: 0,
      warnings: 1,
      info: 0
    });
    assert.deepStrictEqual(summarizeFindings([error, warning]), {
      status: 'fail',
      errors: 1,
      warnings: 1,
      info: 0
    });
  });
});

describe('validator job model', () => {
  it('serializes validator jobs with file reports and progress', () => {
    const report = new ValidatorFileReport({
      fileId: '001-creative',
      fileName: 'creative.zip',
      fileType: 'zip',
      status: 'pending'
    });
    const job = new ValidatorJob({
      id: 'v123',
      userId: 'alice',
      preset: 'generic',
      files: [report]
    });

    assert.deepStrictEqual(job.toJSON().progress, {
      total: 1,
      completed: 0,
      failed: 0,
      warnings: 0
    });
    assert.strictEqual(job.toJSON().files[0].fileName, 'creative.zip');
    assert.strictEqual(job.toJSON().files[0].findings.length, 0);
  });

  it('stores validator jobs independently', async () => {
    const store = new ValidatorStore();
    const job = new ValidatorJob({ id: 'v1', userId: 'alice' });
    await store.create(job);
    assert.strictEqual((await store.get('v1')).id, 'v1');
    await store.update('v1', { status: 'complete' });
    assert.strictEqual((await store.get('v1')).status, 'complete');
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test test/validatorModel.test.js
```

Expected: fail with module-not-found errors for `src/validator/*`.

- [ ] **Step 3: Implement presets**

Create `src/validator/presets.js`:

```js
export const PRESETS = {
  generic: {
    id: 'generic',
    label: 'Generic QA',
    appliesTo: ['zip', 'riv', 'video'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: false,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: 30
  },
  cm360_dv360: {
    id: 'cm360_dv360',
    label: 'CM360 / DV360',
    appliesTo: ['zip'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: true,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: null
  },
  google_ads: {
    id: 'google_ads',
    label: 'Google Ads',
    appliesTo: ['zip'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: true,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: null
  },
  amazon_ads: {
    id: 'amazon_ads',
    label: 'Amazon Ads',
    appliesTo: ['zip'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: true,
    requiresClickTag: true,
    allowExternalReferences: false,
    allowedExtensions: ['.html', '.htm', '.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.json', '.woff', '.woff2', '.ttf'],
    maxVideoDurationSeconds: null
  },
  rive: {
    id: 'rive',
    label: 'Rive',
    appliesTo: ['riv'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: false,
    requiresClickTag: false,
    allowExternalReferences: true,
    allowedExtensions: ['.riv'],
    maxVideoDurationSeconds: null
  },
  video: {
    id: 'video',
    label: 'Video',
    appliesTo: ['video'],
    maxUploadBytes: 200 * 1024 * 1024,
    requiresHtml: false,
    requiresClickTag: false,
    allowExternalReferences: true,
    allowedExtensions: ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv'],
    maxVideoDurationSeconds: 30
  }
};

export function getPreset(id = 'generic') {
  const preset = PRESETS[id];
  if (!preset) throw new Error(`Unknown validator preset: ${id}`);
  return preset;
}

export function listPresets() {
  return Object.values(PRESETS).map(({ id, label, appliesTo }) => ({ id, label, appliesTo }));
}
```

- [ ] **Step 4: Implement findings**

Create `src/validator/findings.js`:

```js
const SEVERITIES = ['info', 'warning', 'error'];

export function buildFinding(severity, code, props = {}) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`Invalid finding severity: ${severity}`);
  }
  return {
    severity,
    code,
    title: props.title || code,
    message: props.message || '',
    suggestion: props.suggestion || '',
    path: props.path || null
  };
}

export function summarizeFindings(findings = []) {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'info').length;
  return {
    status: errors > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
    errors,
    warnings,
    info
  };
}
```

- [ ] **Step 5: Implement validator models**

Create `src/validator/ValidatorJob.js`:

```js
import crypto from 'crypto';
import { summarizeFindings } from './findings.js';

export const VALIDATOR_JOB_STATUSES = ['uploaded', 'validating', 'complete', 'error'];
export const VALIDATOR_FILE_STATUSES = ['pending', 'validating', 'pass', 'warning', 'fail', 'error'];

export class ValidatorFileReport {
  constructor(props = {}) {
    this.fileId = props.fileId || props.id || '';
    this.fileName = props.fileName || props.name || '';
    this.fileType = props.fileType || props.type || 'zip';
    this.path = props.path || null;
    this.size = props.size || 0;
    this.status = props.status || 'pending';
    this.metadata = props.metadata || {};
    this.findings = props.findings || [];
  }

  setFindings(findings) {
    this.findings = findings;
    this.status = summarizeFindings(findings).status;
  }

  setStatus(status) {
    if (!VALIDATOR_FILE_STATUSES.includes(status)) {
      throw new Error(`Invalid validator file status: ${status}`);
    }
    this.status = status;
  }

  toJSON() {
    const summary = summarizeFindings(this.findings);
    return {
      fileId: this.fileId,
      fileName: this.fileName,
      fileType: this.fileType,
      size: this.size,
      status: this.status,
      metadata: this.metadata,
      findings: this.findings,
      summary
    };
  }
}

export class ValidatorJob {
  constructor(props = {}) {
    this.id = props.id || crypto.randomUUID().slice(0, 8);
    this.userId = props.userId || null;
    this.tenantId = props.tenantId || null;
    this.clientId = props.clientId || null;
    this.preset = props.preset || 'generic';
    this.status = props.status || 'uploaded';
    this.createdAt = props.createdAt || new Date().toISOString();
    this.updatedAt = props.updatedAt || this.createdAt;
    this.files = (props.files || []).map(f => f instanceof ValidatorFileReport ? f : new ValidatorFileReport(f));
    this.error = props.error || null;
  }

  setStatus(status) {
    if (!VALIDATOR_JOB_STATUSES.includes(status)) {
      throw new Error(`Invalid validator job status: ${status}`);
    }
    this.status = status;
    this.updatedAt = new Date().toISOString();
  }

  isOwnedBy(auth) {
    if (!auth) return false;
    if (this.userId && this.userId !== auth.userId) return false;
    if (this.tenantId && auth.tenantId && this.tenantId !== auth.tenantId) return false;
    if (this.clientId && auth.clientId && this.clientId !== auth.clientId) return false;
    return true;
  }

  get allFindings() {
    return this.files.flatMap(f => f.findings);
  }

  get overall() {
    return summarizeFindings(this.allFindings);
  }

  get progress() {
    const completedFiles = this.files.filter(f => ['pass', 'warning', 'fail', 'error'].includes(f.status));
    return {
      total: this.files.length,
      completed: completedFiles.length,
      failed: this.files.filter(f => ['fail', 'error'].includes(f.status)).length,
      warnings: this.files.filter(f => f.status === 'warning').length
    };
  }

  toJSON() {
    return {
      jobId: this.id,
      status: this.status,
      preset: this.preset,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      progress: this.progress,
      overall: this.overall,
      files: this.files.map(f => f.toJSON()),
      error: this.error
    };
  }
}
```

- [ ] **Step 6: Implement validator store**

Create `src/validator/ValidatorStore.js`:

```js
export class ValidatorStore {
  constructor() {
    this.jobs = new Map();
  }

  get size() {
    return this.jobs.size;
  }

  async create(job) {
    if (this.jobs.has(job.id)) {
      throw new Error(`Validator job already exists: ${job.id}`);
    }
    this.jobs.set(job.id, job);
    return job;
  }

  async get(id) {
    return this.jobs.get(id) || null;
  }

  async update(id, updates) {
    const job = await this.get(id);
    if (!job) return null;
    Object.assign(job, updates);
    return job;
  }

  async delete(id) {
    return this.jobs.delete(id);
  }

  async list() {
    return Array.from(this.jobs.values());
  }
}
```

- [ ] **Step 7: Run model tests**

Run:

```bash
node --test test/validatorModel.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add src/validator/presets.js src/validator/findings.js src/validator/ValidatorJob.js src/validator/ValidatorStore.js test/validatorModel.test.js
git commit -m "feat: add validator models and presets"
```

---

### Task 2: Package, Rive, and Video Check Modules

**Files:**

- Create: `src/validator/checks/packageChecks.js`
- Create: `src/validator/checks/renderChecks.js`
- Create: `src/validator/checks/riveChecks.js`
- Create: `src/validator/checks/videoChecks.js`
- Modify: `src/captureVideo.js`
- Test: `test/validatorChecks.test.js`

- [ ] **Step 1: Write failing check tests**

Create `test/validatorChecks.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { checkZipPackage, detectClickTag, detectExternalReferences } from '../src/validator/checks/packageChecks.js';
import { checkRenderability } from '../src/validator/checks/renderChecks.js';
import { checkRiveFile } from '../src/validator/checks/riveChecks.js';
import { classifyVideoMetadata } from '../src/validator/checks/videoChecks.js';
import { getPreset } from '../src/validator/presets.js';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-check-'));
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe('package checks', () => {
  it('reports missing HTML in ZIP uploads', async () => {
    await withTempDir(async dir => {
      const zipPath = path.join(dir, 'missing-html.zip');
      await fs.writeFile(zipPath, zipBuffer({ 'asset.txt': 'x' }));
      const result = await checkZipPackage({
        filePath: zipPath,
        fileName: 'missing-html.zip',
        workDir: dir,
        preset: getPreset('generic')
      });
      assert.ok(result.findings.some(f => f.code === 'MISSING_HTML' && f.severity === 'error'));
    });
  });

  it('detects clickTag and external references in HTML', () => {
    const html = '<a href="javascript:window.open(window.clickTag)"></a><script src="https://cdn.example.com/lib.js"></script>';
    assert.strictEqual(detectClickTag(html), true);
    assert.deepStrictEqual(detectExternalReferences(html), ['https://cdn.example.com/lib.js']);
  });
});

describe('render checks', () => {
  it('renders a nonblank HTML file without findings', async () => {
    await withTempDir(async dir => {
      const htmlPath = path.join(dir, 'creative.html');
      await fs.writeFile(htmlPath, '<html><body style="margin:0;background:#f00;width:300px;height:250px"></body></html>');
      const result = await checkRenderability({
        htmlPath,
        dimensions: { width: 300, height: 250 },
        displayPath: 'creative.html'
      });
      assert.strictEqual(result.metadata.rendered, true);
      assert.strictEqual(result.findings.some(f => f.code === 'BLANK_RENDER'), false);
    });
  });

  it('reports blank rendered output', async () => {
    await withTempDir(async dir => {
      const htmlPath = path.join(dir, 'blank.html');
      await fs.writeFile(htmlPath, '<html><body style="margin:0;background:#fff;width:300px;height:250px"></body></html>');
      const result = await checkRenderability({
        htmlPath,
        dimensions: { width: 300, height: 250 },
        displayPath: 'blank.html'
      });
      assert.ok(result.findings.some(f => f.code === 'BLANK_RENDER'));
    });
  });
});

describe('rive checks', () => {
  it('requires dimensions in Rive filenames', async () => {
    const result = await checkRiveFile({
      filePath: '/tmp/banner.riv',
      fileName: 'banner.riv',
      preset: getPreset('rive')
    });
    assert.ok(result.findings.some(f => f.code === 'RIVE_DIMENSIONS_MISSING'));
  });

  it('records dimensions from Rive filenames', async () => {
    const result = await checkRiveFile({
      filePath: '/tmp/banner_300x250.riv',
      fileName: 'banner_300x250.riv',
      preset: getPreset('rive')
    });
    assert.deepStrictEqual(result.metadata.dimensions, { width: 300, height: 250 });
  });
});

describe('video checks', () => {
  it('classifies metadata with bitrate, audio, and duration warnings', () => {
    const result = classifyVideoMetadata({
      dimensions: { width: 1920, height: 1080 },
      durationSeconds: 45,
      bitrate: 8000000,
      hasAudio: true,
      loudness: { integrated: -10 }
    }, getPreset('video'));

    assert.ok(result.findings.some(f => f.code === 'VIDEO_DURATION_LONG'));
    assert.ok(result.findings.some(f => f.code === 'VIDEO_BITRATE_HIGH'));
    assert.ok(result.findings.some(f => f.code === 'VIDEO_LOUDNESS_HIGH'));
    assert.strictEqual(result.metadata.hasAudio, true);
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test test/validatorChecks.test.js
```

Expected: fail with module-not-found errors for check modules.

- [ ] **Step 3: Implement package checks**

Create `src/validator/checks/packageChecks.js`:

```js
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import path from 'path';
import { extractZip } from '../../extractZip.js';
import { findBannerEntry } from '../../findBannerEntry.js';
import { detectBannerSize } from '../../detectBannerSize.js';
import { buildFinding } from '../findings.js';
import { checkRenderability } from './renderChecks.js';

const EXTERNAL_REF_PATTERN = /\b(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;

export function detectClickTag(html) {
  return /\bclickTag\b/i.test(html) || /\bclickTAG\b/.test(html);
}

export function detectExternalReferences(html) {
  const refs = [];
  let match;
  while ((match = EXTERNAL_REF_PATTERN.exec(html))) {
    refs.push(match[1]);
  }
  return refs;
}

export function inspectZipEntries(zipPath, preset) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(entry => !entry.isDirectory);
  const unsupported = [];
  let totalBytes = 0;

  for (const entry of entries) {
    const ext = path.extname(entry.entryName).toLowerCase();
    totalBytes += entry.header.size || 0;
    if (preset.allowedExtensions && !preset.allowedExtensions.includes(ext)) {
      unsupported.push(entry.entryName);
    }
  }

  return {
    entryCount: entries.length,
    totalBytes,
    unsupported
  };
}

export async function checkZipPackage({ filePath, fileName, workDir, preset }) {
  const findings = [];
  const metadata = {
    fileSize: (await fs.stat(filePath)).size,
    htmlEntry: null,
    dimensions: null,
    dimensionSource: null,
    entryCount: 0,
    unsupportedEntries: [],
    externalReferences: [],
    renderable: null
  };

  if (metadata.fileSize > preset.maxUploadBytes) {
    findings.push(buildFinding('error', 'PACKAGE_TOO_LARGE', {
      title: 'Package too large',
      message: `The upload is ${metadata.fileSize} bytes, above the ${preset.maxUploadBytes} byte limit.`,
      suggestion: 'Compress assets or remove unused files.',
      path: fileName
    }));
  }

  const entryInfo = inspectZipEntries(filePath, preset);
  metadata.entryCount = entryInfo.entryCount;
  metadata.unsupportedEntries = entryInfo.unsupported;
  for (const entryName of entryInfo.unsupported.slice(0, 10)) {
    findings.push(buildFinding('warning', 'UNSUPPORTED_FILE_TYPE', {
      title: 'Unsupported file type',
      message: `${entryName} is not in the allowed extension list for ${preset.label}.`,
      suggestion: 'Remove the file or confirm the selected platform accepts it.',
      path: entryName
    }));
  }

  let extracted;
  try {
    extracted = await extractZip(filePath, workDir, { extractName: 'validator-extracted' });
  } catch (err) {
    findings.push(buildFinding('error', 'ZIP_EXTRACTION_FAILED', {
      title: 'ZIP extraction failed',
      message: err.message,
      suggestion: 'Rebuild the ZIP and remove malformed or unsafe entries.',
      path: fileName
    }));
    return { metadata, findings };
  }

  let htmlEntry;
  try {
    htmlEntry = await findBannerEntry(extracted);
    metadata.htmlEntry = path.relative(extracted, htmlEntry);
  } catch {
    findings.push(buildFinding('error', 'MISSING_HTML', {
      title: 'Missing HTML entry',
      message: 'The ZIP must contain at least one .html file.',
      suggestion: 'Add a root or shallow HTML entry point and re-upload the ZIP.',
      path: fileName
    }));
    return { metadata, findings };
  }

  const html = await fs.readFile(htmlEntry, 'utf-8');
  const dimensions = await detectBannerSize(htmlEntry, fileName);
  metadata.dimensions = dimensions;
  metadata.dimensionSource = dimensions.width === 300 && dimensions.height === 250 ? 'detected-or-default' : 'detected';

  const renderResult = await checkRenderability({
    htmlPath: htmlEntry,
    dimensions,
    displayPath: metadata.htmlEntry
  });
  metadata.renderable = renderResult.metadata.rendered;
  findings.push(...renderResult.findings);

  if (preset.requiresClickTag && !detectClickTag(html)) {
    findings.push(buildFinding('error', 'MISSING_CLICKTAG', {
      title: 'Missing clickTag',
      message: 'The HTML does not reference clickTag.',
      suggestion: 'Add clickTag handling expected by the selected platform.',
      path: metadata.htmlEntry
    }));
  }

  const refs = detectExternalReferences(html);
  metadata.externalReferences = refs;
  if (!preset.allowExternalReferences) {
    for (const ref of refs) {
      findings.push(buildFinding('warning', 'EXTERNAL_REFERENCE', {
        title: 'External asset reference',
        message: `${ref} is loaded from outside the ZIP.`,
        suggestion: 'Bundle assets locally unless the platform explicitly allows this host.',
        path: metadata.htmlEntry
      }));
    }
  }

  return { metadata, findings };
}
```

- [ ] **Step 4: Implement render checks**

Create `src/validator/checks/renderChecks.js`:

```js
import { pathToFileURL } from 'url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { buildFinding } from '../findings.js';

async function isBlankScreenshot(buffer) {
  const stats = await sharp(buffer).stats();
  const channels = stats.channels.slice(0, 3);
  const averageStddev = channels.reduce((sum, channel) => sum + channel.stdev, 0) / channels.length;
  return averageStddev < 1;
}

export async function checkRenderability({ htmlPath, dimensions, displayPath }) {
  const findings = [];
  const metadata = { rendered: false, blank: false };
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: {
        width: dimensions.width,
        height: dimensions.height
      }
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 5000 });
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height
      }
    });
    metadata.rendered = true;
    metadata.blank = await isBlankScreenshot(screenshot);
    if (metadata.blank) {
      findings.push(buildFinding('warning', 'BLANK_RENDER', {
        title: 'Blank rendered output',
        message: 'The creative rendered as a visually blank frame during validation.',
        suggestion: 'Check that the ad initializes without platform-only runtime dependencies.',
        path: displayPath
      }));
    }
  } catch (err) {
    findings.push(buildFinding('error', 'RENDER_FAILED', {
      title: 'Render smoke check failed',
      message: err.message,
      suggestion: 'Open the HTML entry locally and fix JavaScript, asset, or loading errors.',
      path: displayPath
    }));
  } finally {
    if (browser) await browser.close();
  }

  return { metadata, findings };
}
```

- [ ] **Step 5: Implement Rive checks**

Create `src/validator/checks/riveChecks.js`:

```js
import { parseRivDimensions, generateRiveHTML } from '../../riveTemplate.js';
import { buildFinding } from '../findings.js';

export async function checkRiveFile({ fileName }) {
  const findings = [];
  const metadata = {
    dimensions: null,
    wrapperGenerated: false
  };

  const dimensions = parseRivDimensions(fileName);
  if (!dimensions) {
    findings.push(buildFinding('error', 'RIVE_DIMENSIONS_MISSING', {
      title: 'Rive dimensions missing',
      message: 'The .riv filename must include dimensions such as Banner_300x250.riv.',
      suggestion: 'Rename the Rive file with WIDTHxHEIGHT before validating.',
      path: fileName
    }));
    return { metadata, findings };
  }

  metadata.dimensions = dimensions;
  const html = generateRiveHTML('creative.js', dimensions.width, dimensions.height);
  metadata.wrapperGenerated = html.includes('rive.js') && html.includes(`${dimensions.width},${dimensions.height}`);
  if (!metadata.wrapperGenerated) {
    findings.push(buildFinding('error', 'RIVE_WRAPPER_FAILED', {
      title: 'Rive wrapper failed',
      message: 'The validator could not generate a usable HTML wrapper for this Rive file.',
      suggestion: 'Check that the Rive template supports this creative.',
      path: fileName
    }));
  }

  return { metadata, findings };
}
```

- [ ] **Step 6: Export richer video metadata**

Modify `src/captureVideo.js` by adding these functions before the final export:

```js
async function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate',
      '-show_entries', 'stream=codec_type,width,height,bit_rate',
      '-of', 'json',
      videoPath
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      const data = JSON.parse(stdout);
      const video = (data.streams || []).find(stream => stream.codec_type === 'video') || {};
      const audio = (data.streams || []).find(stream => stream.codec_type === 'audio') || null;
      resolve({
        dimensions: video.width && video.height ? { width: Number(video.width), height: Number(video.height) } : null,
        durationSeconds: data.format?.duration ? Number(data.format.duration) : null,
        bitrate: data.format?.bit_rate ? Number(data.format.bit_rate) : video.bit_rate ? Number(video.bit_rate) : null,
        hasAudio: Boolean(audio)
      });
    });

    proc.on('error', reject);
  });
}

async function probeVideoLoudness(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-filter:a', 'ebur128=peak=true',
      '-f', 'null',
      '-'
    ]);

    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('close', () => {
      const matches = Array.from(stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g));
      const last = matches.at(-1);
      resolve({ integrated: last ? Number(last[1]) : null });
    });
    proc.on('error', reject);
  });
}
```

Update the export line to:

```js
export { captureVideoFrame, isVideoFile, getVideoDimensions, getVideoMetadata, probeVideoLoudness, VIDEO_EXTENSIONS };
```

- [ ] **Step 7: Implement video checks**

Create `src/validator/checks/videoChecks.js`:

```js
import { getVideoMetadata, probeVideoLoudness } from '../../captureVideo.js';
import { buildFinding } from '../findings.js';

const HIGH_BITRATE = 5_000_000;
const HIGH_LOUDNESS_LUFS = -14;

export function classifyVideoMetadata(metadata, preset) {
  const findings = [];
  const output = { ...metadata };

  if (!metadata.dimensions) {
    findings.push(buildFinding('error', 'VIDEO_DIMENSIONS_MISSING', {
      title: 'Video dimensions missing',
      message: 'ffprobe did not report video dimensions.',
      suggestion: 'Re-encode the video with a valid video stream.',
      path: null
    }));
  }

  if (preset.maxVideoDurationSeconds && metadata.durationSeconds > preset.maxVideoDurationSeconds) {
    findings.push(buildFinding('warning', 'VIDEO_DURATION_LONG', {
      title: 'Video duration exceeds preset',
      message: `Video duration is ${metadata.durationSeconds.toFixed(2)} seconds.`,
      suggestion: `Keep duration at or below ${preset.maxVideoDurationSeconds} seconds for this preset.`,
      path: null
    }));
  }

  if (metadata.bitrate && metadata.bitrate > HIGH_BITRATE) {
    findings.push(buildFinding('warning', 'VIDEO_BITRATE_HIGH', {
      title: 'High video bitrate',
      message: `Video bitrate is ${metadata.bitrate} bps.`,
      suggestion: 'Consider compressing the video to reduce delivery weight.',
      path: null
    }));
  }

  if (metadata.hasAudio) {
    findings.push(buildFinding('info', 'VIDEO_HAS_AUDIO', {
      title: 'Audio stream present',
      message: 'The video includes an audio stream.',
      suggestion: 'Confirm the selected platform and placement allow audio.',
      path: null
    }));
  }

  if (metadata.loudness?.integrated !== null && metadata.loudness.integrated > HIGH_LOUDNESS_LUFS) {
    findings.push(buildFinding('warning', 'VIDEO_LOUDNESS_HIGH', {
      title: 'Audio loudness is high',
      message: `Integrated loudness is ${metadata.loudness.integrated} LUFS.`,
      suggestion: `Normalize audio to ${HIGH_LOUDNESS_LUFS} LUFS or lower unless the placement specifies otherwise.`,
      path: null
    }));
  }

  return { metadata: output, findings };
}

export async function checkVideoFile({ filePath, fileName, preset }) {
  try {
    const metadata = await getVideoMetadata(filePath);
    if (metadata.hasAudio) {
      metadata.loudness = await probeVideoLoudness(filePath);
    }
    const result = classifyVideoMetadata(metadata, preset);
    result.metadata.fileName = fileName;
    return result;
  } catch (err) {
    return {
      metadata: {},
      findings: [buildFinding('error', 'VIDEO_PROBE_FAILED', {
        title: 'Video probe failed',
        message: err.message,
        suggestion: 'Confirm the file is a valid supported video and ffprobe is installed.',
        path: fileName
      })]
    };
  }
}
```

- [ ] **Step 8: Run check tests**

Run:

```bash
node --test test/validatorChecks.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/captureVideo.js src/validator/checks/packageChecks.js src/validator/checks/renderChecks.js src/validator/checks/riveChecks.js src/validator/checks/videoChecks.js test/validatorChecks.test.js
git commit -m "feat: add validator check modules"
```

---

### Task 3: Validator Orchestration Service

**Files:**

- Create: `src/validator/validateAd.js`
- Create: `src/validator/validatorService.js`
- Test: `test/validatorService.test.js`

- [ ] **Step 1: Write failing service tests**

Create `test/validatorService.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ValidatorJob, ValidatorFileReport } from '../src/validator/ValidatorJob.js';
import { runValidationForJob } from '../src/validator/validatorService.js';

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe('validator service', () => {
  it('validates ZIP files and records findings per file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-service-'));
    try {
      const zipPath = path.join(root, 'bad.zip');
      await fs.writeFile(zipPath, zipBuffer({ 'asset.txt': 'x' }));
      const job = new ValidatorJob({
        id: 'v1',
        preset: 'generic',
        files: [new ValidatorFileReport({
          fileId: '001-bad',
          fileName: 'bad.zip',
          fileType: 'zip',
          path: zipPath,
          size: (await fs.stat(zipPath)).size
        })]
      });

      await runValidationForJob(job, { workRoot: root });
      assert.strictEqual(job.status, 'complete');
      assert.strictEqual(job.files[0].status, 'fail');
      assert.ok(job.files[0].findings.some(f => f.code === 'MISSING_HTML'));
      assert.strictEqual(job.overall.status, 'fail');
    } finally {
      await fs.remove(root);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test test/validatorService.test.js
```

Expected: fail because `validatorService.js` does not exist.

- [ ] **Step 3: Implement per-file validator**

Create `src/validator/validateAd.js`:

```js
import path from 'path';
import { getPreset } from './presets.js';
import { summarizeFindings, buildFinding } from './findings.js';
import { checkZipPackage } from './checks/packageChecks.js';
import { checkRiveFile } from './checks/riveChecks.js';
import { checkVideoFile } from './checks/videoChecks.js';

export async function validateAdFile(fileReport, options = {}) {
  const preset = getPreset(options.preset || 'generic');
  const findings = [];
  const metadata = {
    fileSize: fileReport.size,
    fileType: fileReport.fileType
  };

  if (!preset.appliesTo.includes(fileReport.fileType)) {
    findings.push(buildFinding('warning', 'PRESET_FILE_TYPE_MISMATCH', {
      title: 'Preset may not apply',
      message: `${preset.label} is not intended for ${fileReport.fileType} files.`,
      suggestion: 'Choose a preset that matches the uploaded file type.',
      path: fileReport.fileName
    }));
  }

  let result;
  if (fileReport.fileType === 'zip') {
    result = await checkZipPackage({
      filePath: fileReport.path,
      fileName: fileReport.fileName,
      workDir: path.join(options.workRoot, fileReport.fileId),
      preset
    });
  } else if (fileReport.fileType === 'riv') {
    result = await checkRiveFile({
      filePath: fileReport.path,
      fileName: fileReport.fileName,
      preset
    });
  } else if (fileReport.fileType === 'video') {
    result = await checkVideoFile({
      filePath: fileReport.path,
      fileName: fileReport.fileName,
      preset
    });
  } else {
    result = {
      metadata: {},
      findings: [buildFinding('error', 'UNSUPPORTED_FILE_TYPE', {
        title: 'Unsupported file type',
        message: `The validator does not support ${fileReport.fileType} files.`,
        suggestion: 'Upload a ZIP, Rive, or supported video file.',
        path: fileReport.fileName
      })]
    };
  }

  Object.assign(metadata, result.metadata);
  findings.push(...result.findings);
  const summary = summarizeFindings(findings);
  return {
    status: summary.status,
    metadata,
    findings
  };
}
```

- [ ] **Step 4: Implement validator service**

Create `src/validator/validatorService.js`:

```js
import fs from 'fs-extra';
import path from 'path';
import { validateAdFile } from './validateAd.js';
import { buildFinding } from './findings.js';

export async function runValidationForJob(job, options = {}) {
  const workRoot = options.workRoot;
  if (!workRoot) throw new Error('runValidationForJob requires workRoot');

  job.setStatus('validating');
  await fs.ensureDir(workRoot);

  for (const file of job.files) {
    file.setStatus('validating');
    try {
      const result = await validateAdFile(file, {
        preset: job.preset,
        workRoot: path.join(workRoot, job.id)
      });
      file.metadata = result.metadata;
      file.setFindings(result.findings);
    } catch (err) {
      file.metadata = {};
      file.setFindings([buildFinding('error', 'VALIDATION_ERROR', {
        title: 'Validation failed',
        message: err.message,
        suggestion: 'Retry validation or inspect the uploaded file.',
        path: file.fileName
      })]);
      file.setStatus('error');
    }
  }

  job.setStatus('complete');
  return job;
}
```

- [ ] **Step 5: Run service tests**

Run:

```bash
node --test test/validatorService.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/validator/validateAd.js src/validator/validatorService.js test/validatorService.test.js
git commit -m "feat: add validator orchestration"
```

---

### Task 4: Validator API Routes

**Files:**

- Modify: `src/webServer.js`
- Test: `test/validatorApi.test.js`

- [ ] **Step 1: Write failing API contract tests**

Create `test/validatorApi.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import AdmZip from 'adm-zip';
import { startWebServer } from '../src/webServer.js';

let server;
let base;

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

async function json(res) {
  return res.json();
}

describe('Validator API', () => {
  before(async () => {
    server = await startWebServer(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('uploads validator files and returns validator job shape', async () => {
    const body = new FormData();
    body.append('files', new Blob([zipBuffer({ 'asset.txt': 'x' })]), 'bad.zip');
    const res = await fetch(`${base}/validator/jobs`, { method: 'POST', body });
    assert.strictEqual(res.status, 201);
    const data = await json(res);
    assert.ok(data.jobId);
    assert.strictEqual(data.status, 'uploaded');
    assert.strictEqual(data.preset, 'generic');
    assert.strictEqual(data.files[0].fileName, 'bad.zip');
    assert.strictEqual(data.files[0].status, 'pending');
  });

  it('validates a job with selected preset and returns findings', async () => {
    const body = new FormData();
    body.append('files', new Blob([zipBuffer({ 'asset.txt': 'x' })]), 'bad.zip');
    const uploadRes = await fetch(`${base}/validator/jobs`, { method: 'POST', body });
    const upload = await json(uploadRes);

    const startRes = await fetch(`${base}/validator/jobs/${upload.jobId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'generic' })
    });
    assert.strictEqual(startRes.status, 200);

    let status;
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${base}/validator/jobs/${upload.jobId}`);
      status = await json(res);
      if (status.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.strictEqual(status.status, 'complete');
    assert.strictEqual(status.overall.status, 'fail');
    assert.ok(status.files[0].findings.some(f => f.code === 'MISSING_HTML'));
  });

  it('rejects unknown presets', async () => {
    const body = new FormData();
    body.append('files', new Blob([zipBuffer({ 'index.html': '<html></html>' })]), 'ok.zip');
    const uploadRes = await fetch(`${base}/validator/jobs`, { method: 'POST', body });
    const upload = await json(uploadRes);

    const res = await fetch(`${base}/validator/jobs/${upload.jobId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'missing' })
    });
    assert.strictEqual(res.status, 400);
    const data = await json(res);
    assert.strictEqual(data.code, 'INVALID_PRESET');
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test test/validatorApi.test.js
```

Expected: fail with 404 responses for `/api/v1/validator/jobs`.

- [ ] **Step 3: Modify `src/webServer.js` imports**

Add imports near the existing job imports:

```js
import { ValidatorJob, ValidatorFileReport } from './validator/ValidatorJob.js';
import { ValidatorStore } from './validator/ValidatorStore.js';
import { getPreset, listPresets } from './validator/presets.js';
import { runValidationForJob } from './validator/validatorService.js';
```

Add a store near `const jobStore = new InMemoryJobStore();`:

```js
const validatorStore = new ValidatorStore();
```

- [ ] **Step 4: Add validator helpers in `src/webServer.js`**

Insert after `createFileId`:

```js
function createValidatorFileId(fileName, index) {
  return createFileId(fileName, index);
}

function validatorWorkRoot(jobId) {
  return path.join(storage.root, 'validator', jobId);
}

function validatorFileType(fileName) {
  return /\.riv$/i.test(fileName) ? 'riv' : isVideoFile(fileName) ? 'video' : 'zip';
}

function assertValidatorOwnership(job, auth, res) {
  if (!job || !job.isOwnedBy(auth)) {
    res.status(404).json(errorBody('Validator job not found', 'NOT_FOUND'));
    return false;
  }
  return true;
}
```

- [ ] **Step 5: Add validator route handlers in `src/webServer.js`**

Insert before `handleLogin`:

```js
async function handleValidatorUpload(req, res) {
  const files = req.files || [];
  const auth = req.auth || {};
  if (files.length === 0) {
    return res.status(400).json(errorBody('No files uploaded', 'NO_FILES'));
  }

  const reports = files.map((file, index) => new ValidatorFileReport({
    fileId: createValidatorFileId(file.originalname, index),
    fileName: file.originalname,
    fileType: validatorFileType(file.originalname),
    path: file.path,
    size: file.size,
    status: 'pending'
  }));

  const job = new ValidatorJob({
    id: req.sessionId,
    userId: auth.userId || null,
    tenantId: auth.tenantId || null,
    clientId: auth.clientId || null,
    preset: 'generic',
    files: reports
  });

  await validatorStore.create(job);
  res.status(201).json(job.toJSON());
}

async function handleValidatorStart(req, res) {
  const job = await validatorStore.get(req.params.jobId);
  const auth = req.auth || {};
  if (!assertValidatorOwnership(job, auth, res)) return;

  const presetId = req.body?.preset || 'generic';
  try {
    getPreset(presetId);
  } catch (err) {
    return res.status(400).json(errorBody(err.message, 'INVALID_PRESET'));
  }

  if (job.status === 'validating') {
    return res.status(409).json(errorBody('Validator job is already running', 'ALREADY_VALIDATING'));
  }

  job.preset = presetId;
  job.setStatus('validating');
  await validatorStore.update(job.id, { preset: job.preset, status: job.status, updatedAt: job.updatedAt, files: job.files });
  res.json(job.toJSON());

  runValidationForJob(job, { workRoot: validatorWorkRoot(job.id) })
    .then(() => validatorStore.update(job.id, { status: job.status, updatedAt: job.updatedAt, files: job.files }))
    .catch(async err => {
      job.setStatus('error');
      job.error = err.message;
      await validatorStore.update(job.id, { status: job.status, error: job.error, updatedAt: job.updatedAt });
    });
}

async function handleValidatorGet(req, res) {
  const job = await validatorStore.get(req.params.jobId);
  if (!assertValidatorOwnership(job, req.auth, res)) return;
  res.json(job.toJSON());
}

function handleValidatorPresets(req, res) {
  res.json({ presets: listPresets() });
}
```

- [ ] **Step 6: Mount validator routes in `src/webServer.js`**

Inside the v1 router section, before `v1.use(handleMulterError);`, add:

```js
v1.get('/validator/presets', handleValidatorPresets);

v1.post('/validator/jobs', rateLimiter, (req, res, next) => {
  req.sessionId = newId();
  next();
}, upload.array('files'), handleValidatorUpload);

v1.post('/validator/jobs/:jobId/validate', rateLimiter, handleValidatorStart);

v1.get('/validator/jobs/:jobId', handleValidatorGet);
```

- [ ] **Step 7: Run validator API tests**

Run:

```bash
node --test test/validatorApi.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Run auth/security focused regression tests**

Run:

```bash
node --test test/auth.test.js test/security.test.js test/apiContract.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add src/webServer.js test/validatorApi.test.js
git commit -m "feat: expose validator API"
```

---

### Task 5: Validator Frontend Mode

**Files:**

- Modify: `src/public/index.html`
- Modify: `src/public/style.css`
- Test: `test/validatorFrontend.test.js`

- [ ] **Step 1: Write failing frontend test**

Create `test/validatorFrontend.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import AdmZip from 'adm-zip';
import { startWebServer } from '../src/webServer.js';

function zipWithoutHtml() {
  const zip = new AdmZip();
  zip.addFile('asset.txt', Buffer.from('not an html creative'));
  return zip.toBuffer();
}

describe('Validator frontend UI', () => {
  let server;
  let baseUrl;
  let browser;

  before(async () => {
    server = await startWebServer(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('validates ads in a separate mode and renders accessible findings', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await page.click('#validatorModeBtn');
    await page.selectOption('#validatorPreset', 'generic');
    await page.setInputFiles('#validatorFileInput', {
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: zipWithoutHtml()
    });

    await page.waitForSelector('.validator-file-item');
    assert.strictEqual(await page.locator('#validatorProgressBar').getAttribute('role'), 'progressbar');
    assert.strictEqual(await page.locator('.validator-file-item').getAttribute('aria-label'), 'broken.zip, ZIP file, pending');

    await page.click('#validateBtn');
    await page.waitForFunction(
      () => document.querySelector('#validatorReport')?.textContent?.includes('Missing HTML entry'),
      { timeout: 10_000 }
    );

    assert.match(await page.locator('#validatorStatusText').textContent(), /Validation complete/);
    assert.strictEqual(await page.locator('#validatorProgressBar').getAttribute('aria-valuenow'), '100');
    assert.match(await page.locator('#validatorReport').textContent(), /The ZIP must contain at least one \.html file/);
    assert.match(await page.locator('#validatorReport').textContent(), /Add a root or shallow HTML entry point/);

    await page.close();
  });
});
```

- [ ] **Step 2: Run frontend test to verify red**

Run:

```bash
node --test test/validatorFrontend.test.js
```

Expected: fail because `#validatorModeBtn` does not exist.

- [ ] **Step 3: Add validator markup to `src/public/index.html`**

Add mode controls inside `.container` after the logo:

```html
<div class="mode-switch" role="tablist" aria-label="Tool mode">
  <button class="mode-tab active" id="backupModeBtn" role="tab" aria-selected="true" aria-controls="backupPanel">Generate Backups</button>
  <button class="mode-tab" id="validatorModeBtn" role="tab" aria-selected="false" aria-controls="validatorPanel">Validate Ads</button>
</div>
```

Wrap the existing backup upload/action/progress content in:

```html
<div id="backupPanel" role="tabpanel" aria-labelledby="backupModeBtn">
  <!-- existing backup drop zone, file list, error summary, actions, progress -->
</div>
```

Add validator panel after the backup panel:

```html
<div id="validatorPanel" role="tabpanel" aria-labelledby="validatorModeBtn" class="hidden">
  <div class="validator-toolbar">
    <label for="validatorPreset">Validation preset</label>
    <select id="validatorPreset">
      <option value="generic">Generic QA</option>
      <option value="cm360_dv360">CM360 / DV360</option>
      <option value="google_ads">Google Ads</option>
      <option value="amazon_ads">Amazon Ads</option>
      <option value="rive">Rive</option>
      <option value="video">Video</option>
    </select>
  </div>

  <div class="drop-zone" id="validatorDropZone" role="button" tabindex="0" aria-label="Upload files to validate">
    <div class="drop-zone-text"><strong>Choose files</strong> to validate</div>
    <div class="drop-zone-hint">ZIP, .riv, or video &middot; multiple allowed</div>
  </div>
  <input type="file" id="validatorFileInput" multiple accept=".zip,.riv,.mp4,.webm,.mov,.avi,.mkv,.flv,.wmv" hidden aria-hidden="true">

  <div class="file-list" id="validatorFileList" role="list" aria-label="Files to validate"></div>

  <div class="actions">
    <button class="btn btn-primary" id="validateBtn" disabled>Validate ads</button>
    <button class="btn btn-secondary hidden" id="validatorResetBtn">Start over</button>
  </div>

  <div class="progress-wrap" id="validatorProgressWrap" role="status" aria-live="polite" aria-atomic="true">
    <div class="progress-bar" id="validatorProgressBar" role="progressbar" aria-label="Validation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill" id="validatorProgressFill"></div></div>
    <div class="progress-text" id="validatorStatusText"></div>
  </div>

  <div class="validator-report" id="validatorReport" aria-live="polite"></div>
</div>
```

- [ ] **Step 4: Add validator styles to `src/public/style.css`**

Append:

```css
.mode-switch {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.mode-tab {
  flex: 1;
  padding: 0.625rem 1rem;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  border-radius: 8px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.mode-tab.active {
  border-color: var(--accent);
  color: var(--text-heading);
}
.validator-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 1rem;
}
.validator-toolbar label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-soft);
}
.validator-toolbar select {
  min-height: 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text);
  font: inherit;
  padding: 0 0.75rem;
}
.validator-report {
  margin-top: 1rem;
}
.validator-file-item {
  display: block;
}
.finding-group {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
}
.finding-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text-heading);
}
.finding-message,
.finding-suggestion {
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  line-height: 1.45;
}
```

- [ ] **Step 5: Add validator frontend JavaScript**

In `src/public/index.html`, add these constants near existing DOM constants:

```js
const backupModeBtn = document.getElementById('backupModeBtn');
const validatorModeBtn = document.getElementById('validatorModeBtn');
const backupPanel = document.getElementById('backupPanel');
const validatorPanel = document.getElementById('validatorPanel');
const validatorPreset = document.getElementById('validatorPreset');
const validatorDropZone = document.getElementById('validatorDropZone');
const validatorFileInput = document.getElementById('validatorFileInput');
const validatorFileList = document.getElementById('validatorFileList');
const validateBtn = document.getElementById('validateBtn');
const validatorResetBtn = document.getElementById('validatorResetBtn');
const validatorProgressWrap = document.getElementById('validatorProgressWrap');
const validatorProgressBar = document.getElementById('validatorProgressBar');
const validatorProgressFill = document.getElementById('validatorProgressFill');
const validatorStatusText = document.getElementById('validatorStatusText');
const validatorReport = document.getElementById('validatorReport');
let validatorJobId = null;
let validatorFiles = [];
let validatorPolling = false;
```

Add these functions before backup file handling:

```js
function setMode(mode) {
  const validator = mode === 'validator';
  backupPanel.classList.toggle('hidden', validator);
  validatorPanel.classList.toggle('hidden', !validator);
  backupModeBtn.classList.toggle('active', !validator);
  validatorModeBtn.classList.toggle('active', validator);
  backupModeBtn.setAttribute('aria-selected', String(!validator));
  validatorModeBtn.setAttribute('aria-selected', String(validator));
}

function setValidatorProgress(percent) {
  const clamped = Math.max(0, Math.min(Math.round(percent), 100));
  validatorProgressFill.style.width = `${clamped}%`;
  validatorProgressBar.setAttribute('aria-valuenow', String(clamped));
}

function validatorFileSummary(file) {
  return `${file.fileName}, ${readableFileType(file.fileType)}, ${file.status}`;
}

function renderValidatorFiles() {
  validatorFileList.classList.add('visible');
  validatorFileList.innerHTML = validatorFiles.map(file => `
    <div class="file-item validator-file-item" role="listitem" aria-label="${escapeHtml(validatorFileSummary(file))}">
      <div class="file-item-col">
        <div class="file-item-row">
          <span class="file-type-badge ${escapeHtml(file.fileType)}">${escapeHtml(file.fileType)}</span>
          <span class="file-name">${escapeHtml(file.fileName)}</span>
        </div>
      </div>
      <span class="state-badge ${escapeHtml(file.status)}">${escapeHtml(file.status)}</span>
    </div>
  `).join('');
}

function renderValidatorReport(job) {
  const findingsHtml = job.files.map(file => {
    const findings = file.findings || [];
    const findingItems = findings.map(f => `
      <div class="finding-group">
        <div class="finding-title">${escapeHtml(f.severity.toUpperCase())}: ${escapeHtml(f.title)}</div>
        <div class="finding-message">${escapeHtml(f.message)}</div>
        <div class="finding-suggestion">${escapeHtml(f.suggestion)}</div>
      </div>
    `).join('');
    return `
      <section class="validator-file-report">
        <h3>${escapeHtml(file.fileName)} · ${escapeHtml(file.status)}</h3>
        ${findingItems || '<p class="progress-text">No findings.</p>'}
      </section>
    `;
  }).join('');

  validatorReport.innerHTML = `
    <h2>Validation ${escapeHtml(job.overall.status)}</h2>
    <p class="progress-text">Preset: ${escapeHtml(job.preset)}</p>
    ${findingsHtml}
  `;
}
```

Add event handlers:

```js
backupModeBtn.addEventListener('click', () => setMode('backup'));
validatorModeBtn.addEventListener('click', () => setMode('validator'));
validatorDropZone.addEventListener('click', () => validatorFileInput.click());
validatorDropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    validatorFileInput.click();
  }
});
validatorDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  validatorDropZone.classList.add('dragover');
});
validatorDropZone.addEventListener('dragleave', () => validatorDropZone.classList.remove('dragover'));
validatorDropZone.addEventListener('drop', e => {
  e.preventDefault();
  validatorDropZone.classList.remove('dragover');
  handleValidatorFiles(e.dataTransfer.files);
});
validatorFileInput.addEventListener('change', () => handleValidatorFiles(validatorFileInput.files));
validateBtn.addEventListener('click', startValidation);
validatorResetBtn.addEventListener('click', resetValidatorUI);
```

Add validator API functions:

```js
function handleValidatorFiles(files) {
  const accepted = Array.from(files).filter(f => /\.(zip|riv|mp4|webm|mov|avi|mkv|flv|wmv)$/i.test(f.name));
  if (accepted.length === 0) {
    showToast('Only .zip, .riv, and video files are supported.', 'warn');
    return;
  }

  const form = new FormData();
  accepted.forEach(f => form.append('files', f));
  validateBtn.disabled = true;
  validatorReport.innerHTML = '';

  fetch('/api/v1/validator/jobs', { method: 'POST', body: form })
    .then(r => {
      if (!r.ok) return r.json().then(err => { throw new Error(err.error || 'Upload failed'); });
      return r.json();
    })
    .then(job => {
      validatorJobId = job.jobId;
      validatorFiles = job.files;
      renderValidatorFiles();
      validatorProgressWrap.classList.add('visible');
      setValidatorProgress(0);
      validatorStatusText.textContent = `${job.files.length} ${plural(job.files.length, 'file')} ready to validate.`;
      validateBtn.disabled = false;
    })
    .catch(err => showToast(err.message, 'error'));
}

function startValidation() {
  if (!validatorJobId) return;
  validateBtn.disabled = true;
  validatorResetBtn.classList.add('hidden');
  setValidatorProgress(0);
  validatorStatusText.textContent = 'Starting validation.';

  fetch(`/api/v1/validator/jobs/${validatorJobId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: validatorPreset.value })
  })
    .then(r => {
      if (!r.ok) return r.json().then(err => { throw new Error(err.error || 'Validation failed'); });
      return r.json();
    })
    .then(() => {
      validatorPolling = true;
      pollValidationStatus();
    })
    .catch(err => {
      validateBtn.disabled = false;
      showToast(err.message, 'error');
    });
}

async function pollValidationStatus() {
  while (validatorPolling) {
    const res = await fetch(`/api/v1/validator/jobs/${validatorJobId}?_=${Date.now()}`);
    const job = await res.json();
    validatorFiles = job.files;
    renderValidatorFiles();
    const pct = job.progress.total > 0 ? job.progress.completed / job.progress.total * 100 : 0;
    setValidatorProgress(pct);
    validatorStatusText.textContent = job.status === 'complete'
      ? `Validation complete. ${job.overall.errors} errors and ${job.overall.warnings} warnings.`
      : `Validating ${job.progress.completed} of ${job.progress.total} files.`;

    if (job.status === 'complete' || job.status === 'error') {
      validatorPolling = false;
      setValidatorProgress(100);
      renderValidatorReport(job);
      validatorResetBtn.classList.remove('hidden');
      validatorResetBtn.focus();
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

function resetValidatorUI() {
  validatorJobId = null;
  validatorFiles = [];
  validatorPolling = false;
  validatorFileList.innerHTML = '';
  validatorFileList.classList.remove('visible');
  validatorReport.innerHTML = '';
  validatorProgressWrap.classList.remove('visible');
  setValidatorProgress(0);
  validateBtn.disabled = true;
  validatorResetBtn.classList.add('hidden');
}
```

- [ ] **Step 6: Run validator frontend test**

Run:

```bash
node --test test/validatorFrontend.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Run existing frontend tests**

Run:

```bash
node --test test/frontendUi.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/public/index.html src/public/style.css test/validatorFrontend.test.js
git commit -m "feat: add validator frontend mode"
```

---

### Task 6: Documentation and Final Verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update README workflow and API docs**

In `README.md`, add a validator section after the backup workflow:

```md
### Ad Validator

The web UI includes a separate **Validate Ads** mode. It accepts `.zip`, `.riv`, and supported video files, runs a selected validation preset, and renders a report without generating backup JPGs.

Initial presets:

- Generic QA
- CM360 / DV360
- Google Ads
- Amazon Ads
- Rive
- Video

Validator reports include an overall `pass`, `warning`, or `fail` result, per-file findings grouped by severity, detected metadata, and suggested fixes.
```

Add validator API endpoints to the API table:

```md
| `GET` | `/api/v1/validator/presets` | List validator presets |
| `POST` | `/api/v1/validator/jobs` | Create a validator job and upload files |
| `POST` | `/api/v1/validator/jobs/{jobId}/validate` | Start validation for a selected preset |
| `GET` | `/api/v1/validator/jobs/{jobId}` | Get validator status and report |
```

Add a tests bullet:

```md
- Validator model, checks, API, and frontend report behavior
```

- [ ] **Step 2: Run all targeted validator tests**

Run:

```bash
node --test test/validatorModel.test.js test/validatorChecks.test.js test/validatorService.test.js test/validatorApi.test.js test/validatorFrontend.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: exit code 0.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass. If sandboxed local server or Chromium permissions fail, rerun with elevated permissions and record that reason.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add README.md
git commit -m "docs: document ad validator"
```

---

## Final Acceptance Checklist

- [ ] Backup generation still works and existing frontend tests pass.
- [ ] Validator routes are separate under `/api/v1/validator`.
- [ ] Validator jobs use validator-specific models, not backup `Job`.
- [ ] Generic, CM360/DV360, Google Ads, Amazon Ads, Rive, and Video presets exist.
- [ ] ZIP validation reports missing HTML, clickTag, external references, unsafe packages, and unsupported entries.
- [ ] Rive validation reports missing filename dimensions.
- [ ] Video validation reports metadata, duration, bitrate, audio presence, loudness, and probe failures.
- [ ] Frontend exposes separate `Generate Backups` and `Validate Ads` modes.
- [ ] Validator UI has accessible progress semantics and per-file accessible summaries.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
