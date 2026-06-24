import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  checkZipPackage,
  detectClickTag,
  detectExternalReferences
} from '../src/validator/checks/packageChecks.js';
import { checkRenderability } from '../src/validator/checks/renderChecks.js';
import { checkRiveFile } from '../src/validator/checks/riveChecks.js';
import { classifyVideoMetadata } from '../src/validator/checks/videoChecks.js';
import { getPreset } from '../src/validator/presets.js';

const TEST_TEMP = path.resolve('test-temp-validator-checks');

before(async () => {
  await fs.ensureDir(TEST_TEMP);
});

after(async () => {
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

  it('detects clickTag references and external src/href URLs', () => {
    const html = '<a href="javascript:window.open(window.clickTag)"></a><script src="https://cdn.example.com/lib.js"></script>';

    assert.strictEqual(detectClickTag(html), true);
    assert.deepStrictEqual(detectExternalReferences(html), ['https://cdn.example.com/lib.js']);
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

  it('reports blank white HTML renders', async () => {
    const htmlPath = path.join(TEST_TEMP, 'blank.html');
    await fs.writeFile(htmlPath, '<!doctype html><style>body{margin:0;background:#fff}</style>');

    const result = await checkRenderability({
      htmlPath,
      dimensions: { width: 120, height: 80 },
      displayPath: 'blank.html'
    });

    assert.strictEqual(result.metadata.rendered, true);
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
});
