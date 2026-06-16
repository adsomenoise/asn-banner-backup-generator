import { describe, it } from 'node:test';
import assert from 'node:assert';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import { captureBackup, processAndSaveImage } from '../src/captureBackup.js';

const MAX_FILE_SIZE = 80 * 1024;

function createTestImage(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  }).png().toBuffer();
}

describe('captureBackup — processAndSaveImage (quality tiers)', () => {
  it('produces a JPEG under MAX_FILE_SIZE', async () => {
    const img = await createTestImage(300, 250);
    const out = path.join('test-temp-capute', 'test.jpg');
    await fs.ensureDir(path.dirname(out));
    await processAndSaveImage(img, out);
    const stat = await fs.stat(out);
    assert.ok(stat.size <= MAX_FILE_SIZE, `JPEG size ${stat.size} > ${MAX_FILE_SIZE}`);
    await fs.remove(out);
  });

  it('uses preferredQuality as the highest priority tier', async () => {
    const img = await createTestImage(300, 250);
    const out95 = path.join('test-temp-capute', 'q95.jpg');
    const out50 = path.join('test-temp-capute', 'q50.jpg');
    await fs.ensureDir(path.dirname(out95));
    await processAndSaveImage(img, out95, 95);
    await processAndSaveImage(img, out50, 50);
    const s95 = (await fs.stat(out95)).size;
    const s50 = (await fs.stat(out50)).size;
    assert.ok(s95 >= s50, `q95 image (${s95}) should be >= q50 (${s50})`);
    await fs.remove(out95);
    await fs.remove(out50);
  });

  it('handles a large image without crashing', async () => {
    const img = await createTestImage(728, 90);
    const out = path.join('test-temp-capute', 'large.jpg');
    await fs.ensureDir(path.dirname(out));
    await processAndSaveImage(img, out);
    const stat = await fs.stat(out);
    assert.ok(stat.size > 0);
    await fs.remove(out);
  });
});

describe('captureBackup — navigation errors', () => {
  it('rejects when the creative URL cannot be loaded', async () => {
    const outDir = path.resolve('test-temp-capute', 'navigation');
    await fs.remove(outDir);
    await fs.ensureDir(outDir);

    await assert.rejects(
      () => captureBackup('http://127.0.0.1:9/missing.html', { width: 300, height: 250 }, outDir, 'missing', {
        waitTimeout: 100,
        strategy: 'auto'
      }),
      /failed to load creative/i
    );

    assert.ok(!(await fs.pathExists(path.join(outDir, 'missing.jpg'))));
    await fs.remove(outDir);
  });
});
