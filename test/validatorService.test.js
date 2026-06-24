import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { ValidatorFileReport, ValidatorJob } from '../src/validator/ValidatorJob.js';
import { runValidationForJob } from '../src/validator/validatorService.js';

const TEST_TEMP = path.resolve('test-temp-validator-service');

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

describe('validator service', () => {
  it('runs validation for a job and records failing ZIP findings', async () => {
    const zipPath = await writeZip('bad.zip', [
      { name: 'asset.txt', content: 'not a banner' }
    ]);
    const stat = await fs.stat(zipPath);
    const job = new ValidatorJob({
      id: 'job-bad',
      preset: 'generic',
      files: [
        new ValidatorFileReport({
          fileId: '001-bad',
          fileName: 'bad.zip',
          fileType: 'zip',
          path: zipPath,
          size: stat.size
        })
      ]
    });

    await runValidationForJob(job, { workRoot: TEST_TEMP });

    assert.strictEqual(job.status, 'complete');
    assert.strictEqual(job.files[0].status, 'fail');
    assert.ok(codes(job.files[0].findings).includes('MISSING_HTML'));
    assert.strictEqual(job.overall.status, 'fail');
  });
});
