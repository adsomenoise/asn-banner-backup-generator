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
