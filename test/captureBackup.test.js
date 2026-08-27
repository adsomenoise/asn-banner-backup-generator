import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import http from 'node:http';
import { captureBackup } from '../src/captureBackup.js';
import { encodeScreenshot } from '../src/capture/outputEncoder.js';
import { visualSamplesDiffer } from '../src/capture/endFrameStrategies.js';
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

describe('encodeScreenshot — configurable output', () => {
  it('produces a JPEG under MAX_FILE_SIZE', async () => {
    const img = await createTestImage(300, 250);
    const result = await encodeScreenshot(img);
    assert.strictEqual(result.format, 'jpeg');
    assert.ok(result.byteLength <= MAX_FILE_SIZE, `JPEG size ${result.byteLength} > ${MAX_FILE_SIZE}`);
    assert.strictEqual(result.withinSizeLimit, true);
  });

  it('uses preferredQuality as the highest priority tier', async () => {
    const img = await createTestImage(300, 250);
    const q95 = await encodeScreenshot(img, { quality: 95, maxBytes: null });
    const q50 = await encodeScreenshot(img, { quality: 50, maxBytes: null });
    assert.ok(q95.byteLength >= q50.byteLength, `q95 image (${q95.byteLength}) should be >= q50 (${q50.byteLength})`);
  });

  it('handles a large image without crashing', async () => {
    const img = await createTestImage(728, 90);
    const result = await encodeScreenshot(img);
    assert.ok(result.byteLength > 0);
  });

  it('supports PNG and caller-defined maximum bytes', async () => {
    const img = await createTestImage(300, 250);
    const result = await encodeScreenshot(img, { format: 'png', maxBytes: 200 * 1024, quality: 80 });
    assert.strictEqual(result.format, 'png');
    assert.ok(result.buffer.subarray(1, 4).equals(Buffer.from('PNG')));
    assert.strictEqual(result.maxBytes, 200 * 1024);
    assert.strictEqual(result.withinSizeLimit, true);
  });

  it('reports when an output cannot meet the caller-defined maximum', async () => {
    const img = await createTestImage(300, 250);
    const result = await encodeScreenshot(img, { format: 'jpeg', maxBytes: 1 });
    assert.strictEqual(result.maxBytes, 1);
    assert.strictEqual(result.withinSizeLimit, false);
    assert.ok(result.byteLength > result.maxBytes);
  });
});

describe('captureBackup — navigation errors', () => {
  it('rejects when the creative URL cannot be loaded', async () => {
    const outDir = path.resolve('test-temp-capute', 'navigation');
    await fs.remove(outDir);
    await fs.ensureDir(outDir);

    await assert.rejects(
      () => captureBackup('http://127.0.0.1:9/missing.html', { width: 300, height: 250 }, {
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
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 300, height: 250 }, {
        waitTimeout: 5000,
        strategy: 'auto'
      });

      assert.strictEqual(result.strategy, 'window.generateBackupFrame()');
      assert.ok(called >= 1);
      assert.ok(result.buffer.length > 0);
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
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 40, height: 20 }, {
        waitTimeout: 15000,
        strategy: 'auto',
        quality: 95
      });
      const duration = Date.now() - startedAt;

      assert.strictEqual(result.strategy, 'HTML video last frame');
      // Keep this comfortably below the 15s fallback while allowing Chromium
      // startup contention when the complete test suite runs in parallel.
      assert.ok(duration < 5000, `expected direct video capture, took ${duration}ms`);
      const { data } = await sharp(result.buffer)
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

describe('captureBackup — Rive runtime state', () => {
  it('recognizes Lachmed terminal states and preserves the creative callback', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html>
        <html>
          <body style="margin:0;background:#f00">
            <script>
              window.rive = {
                Rive: class Rive {
                  constructor(options) {
                    setTimeout(function () {
                      options.onStateChange({ data: ['  MAIN_ANIMATION_ROLLOUT  '] });
                    }, 25);
                  }
                }
              };
              new rive.Rive({
                onStateChange: function () {
                  document.body.style.background = '#00ff00';
                  window.creativeCallbackCalled = true;
                }
              });
            </script>
          </body>
        </html>`);
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address();
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 20, height: 20 }, {
        strategy: 'auto',
        quality: 95,
        policy: {
          explicitReadyTimeoutMs: 50,
          riveStateTimeoutMs: 200
        }
      });

      assert.strictEqual(result.strategy, 'Rive end state');
      assert.strictEqual(result.outcome, 'rive-state');
      const { data } = await sharp(result.buffer).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
      assert.ok(data[1] > data[0], `expected creative callback's green frame, got rgb(${data[0]}, ${data[1]}, ${data[2]})`);
    } finally {
      await new Promise(resolve => server.close(resolve));
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
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 20, height: 20 }, {
        waitTimeout: 1700,
        strategy: 'auto',
        quality: 95
      });

      assert.strictEqual(result.strategy, 'Fallback timeout');
      const { data } = await sharp(result.buffer)
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
      const result = await captureBackup(`http://127.0.0.1:${port}/creative.html`, { width: 40, height: 20 }, {
        waitTimeout: 8000,
        strategy: 'auto',
        quality: 95
      });
      const duration = Date.now() - startedAt;

      assert.strictEqual(result.strategy, 'Fallback timeout');
      assert.ok(duration < 6000, `expected early capture, took ${duration}ms`);
      const { data } = await sharp(result.buffer)
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
