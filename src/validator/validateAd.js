import path from 'path';
import { checkZipPackage } from './checks/packageChecks.js';
import { checkRiveFile } from './checks/riveChecks.js';
import { checkVideoFile } from './checks/videoChecks.js';
import { buildFinding, summarizeFindings } from './findings.js';
import { getPreset } from './presets.js';

function presetMismatchFinding(fileReport, preset) {
  return buildFinding('warning', 'PRESET_FILE_TYPE_MISMATCH', {
    title: 'Preset may not apply',
    message: `${preset.label} is intended for ${preset.appliesTo.join(', ')} files, but ${fileReport.fileName} is ${fileReport.fileType}.`,
    suggestion: 'Choose a preset that matches the uploaded file type or confirm this mismatch is intentional.',
    path: fileReport.fileName
  });
}

function unsupportedFileTypeFinding(fileReport) {
  return buildFinding('error', 'UNSUPPORTED_FILE_TYPE', {
    title: 'Unsupported file type',
    message: `${fileReport.fileName} has unsupported validator file type ${fileReport.fileType}.`,
    suggestion: 'Upload a ZIP, Rive, or video file, or map the upload to a supported validator file type.',
    path: fileReport.fileName
  });
}

export async function validateAdFile(fileReport, options = {}) {
  const preset = getPreset(options.preset || 'generic');
  const metadata = {
    fileSize: fileReport.size,
    fileType: fileReport.fileType
  };
  const findings = [];

  if (!preset.appliesTo.includes(fileReport.fileType)) {
    findings.push(presetMismatchFinding(fileReport, preset));
  }

  let result;
  if (fileReport.fileType === 'zip') {
    const workRoot = options.workRoot || path.dirname(fileReport.path || process.cwd());
    result = await checkZipPackage({
      filePath: fileReport.path,
      fileName: fileReport.fileName,
      workDir: path.join(workRoot, fileReport.fileId),
      preset
    });
  } else if (fileReport.fileType === 'riv') {
    result = checkRiveFile({
      filePath: fileReport.path,
      fileName: fileReport.fileName,
      preset
    });
  } else if (fileReport.fileType === 'video') {
    result = await checkVideoFile({
      filePath: fileReport.path,
      fileName: fileReport.fileName,
      preset
    });
  } else {
    findings.push(unsupportedFileTypeFinding(fileReport));
    const summary = summarizeFindings(findings);
    return {
      status: summary.status,
      metadata,
      findings
    };
  }

  const mergedFindings = findings.concat(result.findings || []);
  const summary = summarizeFindings(mergedFindings);
  return {
    status: summary.status,
    metadata: {
      ...metadata,
      ...(result.metadata || {})
    },
    findings: mergedFindings
  };
}
