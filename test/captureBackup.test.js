import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import http from 'node:http';
import { captureBackup, processAndSaveImage } from '../src/captureBackup.js';
import { closeBrowserPool } from '../src/browserPool.js';

const MAX_FILE_SIZE = 80 * 1024;

after(async () => {
  await closeBrowserPool();
});

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

describe('captureBackup — creative backup contract', () => {
  it('calls window.generateBackupFrame and uses the fast backup strategy', async () => {
    const outDir = path.resolve('test-temp-capute', 'contract');
    await fs.remove(outDir);
    await fs.ensureDir(outDir);

    const server = http.createServer((req, res) => {
      if (req.url === '/called') {
        res.writeHead(204).end();
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html>
        <html>
          <body style="margin:0">
            <canvas id="creative" width="300" height="250"></canvas>
            <script>
              window.generateBackupFrame = function () {
                fetch('/called').catch(function () {});
                var c = document.getElementById('creative');
                var ctx = c.getContext('2d');
                ctx.fillStyle = '#0f766e';
                ctx.fillRect(0, 0, c.width, c.height);
                window.__backupReady = true;
              };
            </script>
          </body>
        </html>`);
    });

    let called = 0;
    server.on('request', req => {
      if (req.url === '/called') called++;
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 300, height: 250 }, outDir, 'contract', {
        waitTimeout: 5000,
        strategy: 'auto'
      });

      assert.strictEqual(result.strategy, 'window.generateBackupFrame()');
      assert.ok(called >= 1);
      assert.ok(await fs.pathExists(path.join(outDir, 'contract.jpg')));
    } finally {
      await new Promise(resolve => server.close(resolve));
      await fs.remove(outDir);
    }
  });
});

describe('captureBackup — fallback timing', () => {
  it('waits for the configured creative duration before screenshotting without a backup hook', async () => {
    const outDir = path.resolve('test-temp-capute', 'fallback-timing');
    await fs.remove(outDir);
    await fs.ensureDir(outDir);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html>
        <html>
          <body style="margin:0">
            <canvas id="creative" width="20" height="20"></canvas>
            <script>
              var c = document.getElementById('creative');
              var ctx = c.getContext('2d');
              ctx.fillStyle = '#ff0000';
              ctx.fillRect(0, 0, c.width, c.height);
              setTimeout(function () {
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(0, 0, c.width, c.height);
              }, 1500);
            </script>
          </body>
        </html>`);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 20, height: 20 }, outDir, 'fallback', {
        waitTimeout: 1700,
        strategy: 'auto',
        quality: 95
      });

      assert.strictEqual(result.strategy, 'Fallback timeout');
      const { data } = await sharp(path.join(outDir, 'fallback.jpg'))
        .resize(1, 1)
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.ok(data[1] > data[0], `expected green end frame, got rgb(${data[0]}, ${data[1]}, ${data[2]})`);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await fs.remove(outDir);
    }
  });
});
