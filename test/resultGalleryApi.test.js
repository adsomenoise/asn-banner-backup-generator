import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import AdmZip from 'adm-zip';
import { closeBrowserPool } from '../src/browserPool.js';
import { startWebServer } from '../src/webServer.js';

function creativeZip(delay = 0) {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from(`<!doctype html>
    <html><head><meta name="ad.size" content="width=120,height=80"></head>
    <body style="margin:0;background:#166534"><script>
      window.generateBackupFrame = async function () {
        await new Promise(resolve => setTimeout(resolve, ${delay}));
        document.body.style.background = '#16a34a';
        window.__backupReady = true;
        return true;
      };
    </script></body></html>`));
  return zip.toBuffer();
}

async function waitForComplete(base, jobId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/jobs/${jobId}`);
    const job = await response.json();
    if (job.status === 'complete') return job;
    if (job.status === 'error') throw new Error(job.error || 'Job failed');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for job');
}

describe('result previews and per-file regeneration', () => {
  let server;
  let base;

  before(async () => {
    server = await startWebServer(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    await closeBrowserPool();
    await new Promise(resolve => server.close(resolve));
  });

  it('exposes preview metadata and regenerates one retained source file', async () => {
    const form = new FormData();
    form.append('files', new Blob([creativeZip()], { type: 'application/zip' }), 'campaign_120x80.zip');
    const uploadResponse = await fetch(`${base}/jobs`, { method: 'POST', body: form });
    assert.strictEqual(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json();
    const fileId = uploaded.files[0].fileId;

    const processResponse = await fetch(`${base}/jobs/${uploaded.jobId}/process`, { method: 'POST' });
    assert.strictEqual(processResponse.status, 200);
    const first = await waitForComplete(base, uploaded.jobId);
    assert.strictEqual(first.results.length, 1);
    assert.strictEqual(first.results[0].fileId, fileId);
    assert.deepStrictEqual(first.results[0].dimensions, { width: 120, height: 80 });
    assert.match(first.results[0].preview, /\/preview$/);

    const preview = await fetch(`http://127.0.0.1:${server.address().port}${first.results[0].preview}`);
    assert.strictEqual(preview.status, 200);
    assert.match(preview.headers.get('content-type'), /^image\/jpeg/);
    assert.ok((await preview.arrayBuffer()).byteLength > 0);

    const regenerate = await fetch(`${base}/jobs/${uploaded.jobId}/files/${fileId}/regenerate`, { method: 'POST' });
    assert.strictEqual(regenerate.status, 200);
    const second = await waitForComplete(base, uploaded.jobId);
    assert.strictEqual(second.results.length, 1);
    assert.strictEqual(second.results[0].fileId, fileId);
    assert.strictEqual(second.files[0].state, 'complete');
  });

  it('publishes each preview as soon as its file completes', async () => {
    const form = new FormData();
    form.append('files', new Blob([creativeZip()], { type: 'application/zip' }), 'fast_120x80.zip');
    form.append('files', new Blob([creativeZip(2500)], { type: 'application/zip' }), 'slow_120x80.zip');
    const uploaded = await (await fetch(`${base}/jobs`, { method: 'POST', body: form })).json();
    await fetch(`${base}/jobs/${uploaded.jobId}/process`, { method: 'POST' });

    let partial = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const job = await (await fetch(`${base}/jobs/${uploaded.jobId}`)).json();
      if (job.status === 'processing' && job.progress.completed === 1) {
        partial = job;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    assert.ok(partial, 'expected to observe one completed file while the batch was still processing');
    assert.strictEqual(partial.progress.results, 1);
    assert.strictEqual(partial.results.length, 1);
    assert.match(partial.results[0].preview, /\/preview$/);
    await waitForComplete(base, uploaded.jobId);
  });
});
