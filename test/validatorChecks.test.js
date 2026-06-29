import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  checkZipPackage,
  detectClickTag,
  detectExternalReferences,
  inspectZipEntries
} from '../src/validator/checks/packageChecks.js';
import { checkRenderability } from '../src/validator/checks/renderChecks.js';
import { checkRiveFile } from '../src/validator/checks/riveChecks.js';
import { checkVideoFile, classifyVideoMetadata } from '../src/validator/checks/videoChecks.js';
import { getPreset } from '../src/validator/presets.js';
import { getVideoMetadata, probeVideoLoudness } from '../src/captureVideo.js';
import { closeBrowserPool } from '../src/browserPool.js';

const TEST_TEMP = path.resolve('test-temp-validator-checks');

before(async () => {
  await fs.ensureDir(TEST_TEMP);
});

after(async () => {
  await closeBrowserPool();
  await fs.remove(TEST_TEMP);
});

async function writeZip(name, entries) {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.name, Buffer.from(entry.content || ''));
  }
  const zipPath = path.join(TEST_TEMP, name);
  await fs.writeFile(zipPath, zip.toBuffer());
  return zipPath;
}

function codes(findings) {
  return findings.map(finding => finding.code);
}

describe('validator package checks', () => {
  it('reports missing HTML for a ZIP with only an asset file', async () => {
    const zipPath = await writeZip('asset-only.zip', [
      { name: 'asset.txt', content: 'not a banner' }
    ]);

    const result = await checkZipPackage({
      filePath: zipPath,
      fileName: 'asset-only.zip',
      workDir: TEST_TEMP,
      preset: getPreset('generic')
    });

    assert.ok(codes(result.findings).includes('MISSING_HTML'));
    assert.strictEqual(result.metadata.htmlEntry, null);
    assert.strictEqual(result.metadata.renderable, false);
  });

  it('returns a ZIP extraction finding for corrupt ZIP files instead of throwing', async () => {
    const zipPath = path.join(TEST_TEMP, 'corrupt.zip');
    await fs.writeFile(zipPath, 'this is not a zip');

    const result = await checkZipPackage({
      filePath: zipPath,
      fileName: 'corrupt.zip',
      workDir: TEST_TEMP,
      preset: getPreset('generic')
    });

    assert.ok(codes(result.findings).includes('ZIP_EXTRACTION_FAILED'));
    assert.strictEqual(result.metadata.entryCount, 0);
    assert.strictEqual(result.metadata.renderable, false);
  });

  it('detects clickTag references and external src/href URLs', () => {
    const html = '<a href="javascript:window.open(window.clickTag)"></a><script src="https://cdn.example.com/lib.js"></script>';

    assert.strictEqual(detectClickTag(html), true);
    assert.deepStrictEqual(detectExternalReferences(html), ['https://cdn.example.com/lib.js']);
  });

  it('inspects ZIP entry shape and unsupported entries', async () => {
    const zipPath = await writeZip('mixed-assets.zip', [
      { name: 'index.html', content: '<!doctype html>' },
      { name: 'asset.txt', content: 'unsupported' }
    ]);

    const result = inspectZipEntries(zipPath, getPreset('generic'));

    assert.strictEqual(result.entryCount, 2);
    assert.ok(result.totalBytes > 0);
    assert.deepStrictEqual(result.unsupportedEntries, ['asset.txt']);
  });

  it('reports packages over the preset size limit', async () => {
    const zipPath = await writeZip('too-large.zip', [
      { name: 'index.html', content: '<!doctype html><style>body{margin:0;background:#f00}</style>' }
    ]);
    const preset = { ...getPreset('generic'), maxUploadBytes: 1 };

    const result = await checkZipPackage({
      filePath: zipPath,
      fileName: 'too-large.zip',
      workDir: TEST_TEMP,
      preset
    });

    assert.ok(codes(result.findings).includes('PACKAGE_TOO_LARGE'));
  });

  it('reports missing clickTag and external references for minimal HTML packages', async () => {
    const zipPath = await writeZip('missing-clicktag-external.zip', [
      {
        name: 'index.html',
        content: '<!doctype html><meta name="ad.size" content="width=120,height=80"><style>body{margin:0;background:#f00}</style><script src="https://cdn.example.com/lib.js"></script>'
      }
    ]);
    const preset = {
      ...getPreset('generic'),
      requiresClickTag: true,
      allowExternalReferences: false
    };

    const result = await checkZipPackage({
      filePath: zipPath,
      fileName: 'missing-clicktag-external.zip',
      workDir: TEST_TEMP,
      preset
    });

    assert.ok(codes(result.findings).includes('MISSING_CLICKTAG'));
    assert.ok(codes(result.findings).includes('EXTERNAL_REFERENCE'));
    assert.deepStrictEqual(result.metadata.externalReferences, ['https://cdn.example.com/lib.js']);
  });

  it('does not use the legacy shared extraction directory', async () => {
    const zipPath = await writeZip('isolated-extract.zip', [
      { name: 'asset.txt', content: 'not a banner' }
    ]);
    const legacyExtractPath = path.join(TEST_TEMP, 'validator-extracted');
    await fs.remove(legacyExtractPath);

    const result = await checkZipPackage({
      filePath: zipPath,
      fileName: 'isolated-extract.zip',
      workDir: TEST_TEMP,
      preset: getPreset('generic')
    });

    assert.ok(codes(result.findings).includes('MISSING_HTML'));
    assert.strictEqual(await fs.pathExists(legacyExtractPath), false);
  });
});

describe('validator render checks', () => {
  it('marks nonblank HTML as rendered without a blank finding', async () => {
    const htmlPath = path.join(TEST_TEMP, 'nonblank.html');
    await fs.writeFile(htmlPath, '<!doctype html><style>body{margin:0;background:#f00}</style>');

    const result = await checkRenderability({
      htmlPath,
      dimensions: { width: 120, height: 80 },
      displayPath: 'nonblank.html'
    });

    assert.strictEqual(result.metadata.rendered, true);
    assert.ok(!codes(result.findings).includes('BLANK_RENDER'));
  });

  it('waits before deciding an initially blank render is blank', async () => {
    const htmlPath = path.join(TEST_TEMP, 'delayed-render.html');
    await fs.writeFile(htmlPath, `
      <!doctype html>
      <body style="margin:0;background:#fff">
        <script>
          setTimeout(() => { document.body.style.background = '#f00'; }, 100);
        </script>
      </body>
    `);

    const result = await checkRenderability({
      htmlPath,
      dimensions: { width: 120, height: 80 },
      displayPath: 'delayed-render.html',
      sampleDelayMs: 250
    });

    assert.strictEqual(result.metadata.rendered, true);
    assert.strictEqual(result.metadata.sampleDelayMs, 250);
    assert.ok(!codes(result.findings).includes('BLANK_RENDER'));
  });

  it('reports blank white HTML renders', async () => {
    const htmlPath = path.join(TEST_TEMP, 'blank.html');
    await fs.writeFile(htmlPath, '<!doctype html><style>body{margin:0;background:#fff}</style>');

    const result = await checkRenderability({
      htmlPath,
      dimensions: { width: 120, height: 80 },
      displayPath: 'blank.html'
    });

    assert.strictEqual(result.metadata.rendered, true);
    assert.strictEqual(result.metadata.sampleDelayMs, 2000);
    assert.strictEqual(result.metadata.blank, true);
    assert.ok(codes(result.findings).includes('BLANK_RENDER'));
  });
});

describe('validator Rive checks', () => {
  it('reports missing dimensions for Rive filenames without dimensions', () => {
    const result = checkRiveFile({ fileName: 'banner.riv' });

    assert.ok(codes(result.findings).includes('RIVE_DIMENSIONS_MISSING'));
    assert.strictEqual(result.metadata.dimensions, null);
  });

  it('records dimensions parsed from Rive filenames', () => {
    const result = checkRiveFile({ fileName: 'banner_300x250.riv' });

    assert.deepStrictEqual(result.metadata.dimensions, { width: 300, height: 250 });
  });
});

describe('validator video checks', () => {
  it('classifies duration, bitrate, audio, and loudness metadata', () => {
    const result = classifyVideoMetadata({
      dimensions: { width: 1920, height: 1080 },
      durationSeconds: 45,
      bitrate: 8000000,
      hasAudio: true,
      loudness: { integrated: -10 }
    }, getPreset('video'));

    assert.deepStrictEqual(codes(result.findings), [
      'VIDEO_DURATION_LONG',
      'VIDEO_BITRATE_HIGH',
      'VIDEO_HAS_AUDIO',
      'VIDEO_LOUDNESS_HIGH'
    ]);
    assert.strictEqual(result.metadata.hasAudio, true);
  });

  it('rejects loudness probing when ffmpeg fails without parseable loudness', async () => {
    const binDir = path.join(TEST_TEMP, 'fake-bin');
    const ffmpegPath = path.join(binDir, 'ffmpeg');
    const originalPath = process.env.PATH;
    await fs.ensureDir(binDir);
    await fs.writeFile(ffmpegPath, '#!/bin/sh\necho "ffmpeg failed" >&2\nexit 1\n');
    await fs.chmod(ffmpegPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

    try {
      await assert.rejects(
        () => probeVideoLoudness(path.join(TEST_TEMP, 'video.mp4')),
        /ffmpeg exited with code 1/
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('rejects loudness probing when ffmpeg exits cleanly without parseable loudness', async () => {
    const binDir = path.join(TEST_TEMP, 'fake-bin-clean');
    const ffmpegPath = path.join(binDir, 'ffmpeg');
    const originalPath = process.env.PATH;
    await fs.ensureDir(binDir);
    await fs.writeFile(ffmpegPath, '#!/bin/sh\necho "analysis completed without summary" >&2\nexit 0\n');
    await fs.chmod(ffmpegPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

    try {
      await assert.rejects(
        () => probeVideoLoudness(path.join(TEST_TEMP, 'video.mp4')),
        /ffmpeg did not report integrated loudness/
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('times out hanging video metadata probes', async () => {
    const binDir = path.join(TEST_TEMP, 'fake-bin-hanging-ffprobe');
    const ffprobePath = path.join(binDir, 'ffprobe');
    const originalPath = process.env.PATH;
    await fs.ensureDir(binDir);
    await fs.writeFile(ffprobePath, '#!/bin/sh\nsleep 5\n');
    await fs.chmod(ffprobePath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

    try {
      await assert.rejects(
        () => getVideoMetadata(path.join(TEST_TEMP, 'video.mp4'), { timeoutMs: 50 }),
        /ffprobe timed out after 50ms/
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('times out hanging loudness probes', async () => {
    const binDir = path.join(TEST_TEMP, 'fake-bin-hanging-ffmpeg');
    const ffmpegPath = path.join(binDir, 'ffmpeg');
    const originalPath = process.env.PATH;
    await fs.ensureDir(binDir);
    await fs.writeFile(ffmpegPath, '#!/bin/sh\nsleep 5\n');
    await fs.chmod(ffmpegPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

    try {
      await assert.rejects(
        () => probeVideoLoudness(path.join(TEST_TEMP, 'video.mp4'), { timeoutMs: 50 }),
        /ffmpeg timed out after 50ms/
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns VIDEO_PROBE_FAILED for an invalid video file', async () => {
    const videoPath = path.join(TEST_TEMP, 'invalid.mp4');
    await fs.writeFile(videoPath, 'not a video');

    const result = await checkVideoFile({
      filePath: videoPath,
      fileName: 'invalid.mp4',
      preset: getPreset('video')
    });

    assert.deepStrictEqual(codes(result.findings), ['VIDEO_PROBE_FAILED']);
  });
});
