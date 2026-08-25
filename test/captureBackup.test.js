import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import http from 'node:http';
import { captureBackup, processAndSaveImage, visualSamplesDiffer } from '../src/captureBackup.js';
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

describe('captureBackup — HTML video', () => {
  it('seeks directly to the final video frame without waiting for visual stability', async () => {
    const outDir = path.resolve('test-temp-capute', 'html-video');
    await fs.remove(outDir);
    await fs.ensureDir(outDir);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html>
        <html>
          <body style="margin:0;background:#f00">
            <video id="creative"></video>
            <script>
              var video = document.getElementById('creative');
              Object.defineProperty(video, 'readyState', { value: 4 });
              Object.defineProperty(video, 'duration', { value: 20 });
              Object.defineProperty(video, 'currentTime', {
                set: function (value) {
                  window.__seekTarget = value;
                  document.body.style.background = '#00ff00';
                  setTimeout(function () { video.dispatchEvent(new Event('seeked')); }, 0);
                }
              });
              video.pause = function () {};
            </script>
          </body>
        </html>`);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const startedAt = Date.now();
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 40, height: 20 }, outDir, 'video', {
        waitTimeout: 15000,
        strategy: 'auto',
        quality: 95
      });
      const duration = Date.now() - startedAt;

      assert.strictEqual(result.strategy, 'HTML video last frame');
      assert.ok(duration < 3000, `expected direct video capture, took ${duration}ms`);
      const { data } = await sharp(path.join(outDir, 'video.jpg'))
        .resize(1, 1)
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.ok(data[1] > data[0], `expected green last frame, got rgb(${data[0]}, ${data[1]}, ${data[2]})`);
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

  it('captures early after a real animation becomes visually stable', async () => {
    const outDir = path.resolve('test-temp-capute', 'fallback-stability');
    await fs.remove(outDir);
    await fs.ensureDir(outDir);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html>
        <html>
          <body style="margin:0;background:#fff">
            <div id="creative" style="width:20px;height:20px;background:#f00"></div>
            <script>
              var el = document.getElementById('creative');
              var started = performance.now();
              function animate(now) {
                var elapsed = now - started;
                el.style.transform = 'translateX(' + Math.min(10, elapsed / 50) + 'px)';
                if (elapsed < 500) requestAnimationFrame(animate);
                else el.style.background = '#00ff00';
              }
              requestAnimationFrame(animate);
            </script>
          </body>
        </html>`);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const startedAt = Date.now();
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 40, height: 20 }, outDir, 'stable', {
        waitTimeout: 8000,
        strategy: 'auto',
        quality: 95
      });
      const duration = Date.now() - startedAt;

      assert.strictEqual(result.strategy, 'Fallback timeout');
      assert.ok(duration < 6000, `expected early capture, took ${duration}ms`);
      const { data } = await sharp(path.join(outDir, 'stable.jpg'))
        .extract({ left: 10, top: 0, width: 20, height: 20 })
        .resize(1, 1)
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.ok(data[1] > data[0], `expected green settled frame, got rgb(${data[0]}, ${data[1]}, ${data[2]})`);
    } finally {
      await new Promise(resolve => server.close(resolve));
      await fs.remove(outDir);
    }
  });
});

describe('visualSamplesDiffer', () => {
  it('ignores tiny average pixel noise and detects meaningful changes', () => {
    assert.strictEqual(visualSamplesDiffer(Buffer.from([10, 10, 10]), Buffer.from([11, 11, 11])), false);
    assert.strictEqual(visualSamplesDiffer(Buffer.from([10, 10, 10]), Buffer.from([20, 20, 20])), true);
  });
});
