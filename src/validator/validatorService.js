import fs from 'fs-extra';
import path from 'path';
import { buildFinding } from './findings.js';
import { validateAdFile } from './validateAd.js';

function validationErrorFinding(file, error) {
  return buildFinding('error', 'VALIDATION_ERROR', {
    title: 'Validation failed',
    message: `Validation failed unexpectedly: ${error.message}`,
    suggestion: 'Retry validation. If the error persists, inspect the file and validator logs.',
    path: file.fileName
  });
}

export async function runValidationForJob(job, options = {}) {
  if (!options.workRoot) {
    throw new Error('runValidationForJob requires workRoot');
  }

  job.setStatus('validating');
  const workRoot = options.workRoot;
  await fs.ensureDir(workRoot);

  for (const file of job.files) {
    file.setStatus('validating');

    try {
      const result = await validateAdFile(file, {
        preset: job.preset,
        workRoot: path.join(workRoot, job.id)
      });
      file.metadata = result.metadata;
      file.setFindings(result.findings);
    } catch (error) {
      file.metadata = {};
      file.setFindings([validationErrorFinding(file, error)]);
      file.setStatus('error');
    }
  }

  job.setStatus('complete');
  return job;
}
