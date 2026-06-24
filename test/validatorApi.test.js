import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import AdmZip from 'adm-zip';
import { startWebServer } from '../src/webServer.js';

let server;
let base;

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.name, Buffer.from(entry.content || ''));
  }
  return zip.toBuffer();
}

async function json(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function uploadValidatorFile(fileName, content) {
  const body = new FormData();
  body.append('files', new Blob([content], { type: 'application/zip' }), fileName);

  const response = await fetch(`${base}/validator/jobs`, {
    method: 'POST',
    body
  });

  return {
    status: response.status,
    body: await json(response)
  };
}

async function pollValidatorJob(jobId) {
  const deadline = Date.now() + 5000;
  let lastBody = null;

  while (Date.now() < deadline) {
    const response = await fetch(`${base}/validator/jobs/${jobId}`);
    assert.strictEqual(response.status, 200);
    lastBody = await json(response);

    if (lastBody.status === 'complete' || lastBody.status === 'error') {
      return lastBody;
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  assert.fail(`Validator job did not complete. Last status: ${lastBody?.status}`);
}

function findingCodes(file) {
  return file.findings.map(finding => finding.code);
}

describe('Validator API', () => {
  before(async () => {
    server = await startWebServer(0);
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('uploads validator files and returns the uploaded job shape', async () => {
    const badZip = zipBuffer([
      { name: 'asset.txt', content: 'not a banner' }
    ]);

    const { status, body } = await uploadValidatorFile('bad.zip', badZip);

    assert.strictEqual(status, 201);
    assert.ok(body.jobId);
    assert.strictEqual(body.status, 'uploaded');
    assert.strictEqual(body.preset, 'generic');
    assert.strictEqual(body.files[0].fileName, 'bad.zip');
    assert.strictEqual(body.files[0].status, 'pending');
  });

  it('validates a job and stores failing findings', async () => {
    const badZip = zipBuffer([
      { name: 'asset.txt', content: 'not a banner' }
    ]);
    const { body: upload } = await uploadValidatorFile('bad.zip', badZip);

    const startResponse = await fetch(`${base}/validator/jobs/${upload.jobId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'generic' })
    });
    assert.strictEqual(startResponse.status, 200);

    const job = await pollValidatorJob(upload.jobId);
    assert.strictEqual(job.status, 'complete');
    assert.strictEqual(job.overall.status, 'fail');
    assert.ok(findingCodes(job.files[0]).includes('MISSING_HTML'));
  });

  it('rejects unknown validator presets', async () => {
    const okZip = zipBuffer([
      { name: 'index.html', content: '<!doctype html><title>Ad</title>' }
    ]);
    const { body: upload } = await uploadValidatorFile('ok.zip', okZip);

    const response = await fetch(`${base}/validator/jobs/${upload.jobId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'missing' })
    });

    assert.strictEqual(response.status, 400);
    const body = await json(response);
    assert.strictEqual(body.code, 'INVALID_PRESET');
  });
});
