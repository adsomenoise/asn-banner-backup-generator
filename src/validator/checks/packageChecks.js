import AdmZip from 'adm-zip';
import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { detectBannerSize } from '../../detectBannerSize.js';
import { extractZip } from '../../extractZip.js';
import { findBannerEntry } from '../../findBannerEntry.js';
import {
  extractCanvasDimensions,
  extractDivDimensions,
  extractMetaAdSize,
  isValidDimension,
  parseDimensionsFromFileName
} from '../../utils.js';
import { buildFinding } from '../findings.js';
import { checkRenderability } from './renderChecks.js';

const MAX_UNSUPPORTED_FINDINGS = 10;

export function detectClickTag(html) {
  return /clicktag/i.test(html);
}

export function detectExternalReferences(html) {
  const urls = [];
  const attributePattern = /\b(?:src|href)\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;
  let match = attributePattern.exec(html);
  while (match) {
    urls.push(match[2]);
    match = attributePattern.exec(html);
  }
  return urls;
}

export function inspectZipEntries(zipPath, preset) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(entry => !entry.isDirectory);
  const allowedExtensions = new Set((preset.allowedExtensions || []).map(ext => ext.toLowerCase()));
  const unsupportedEntries = [];
  let totalBytes = 0;

  for (const entry of entries) {
    totalBytes += entry.header.size || 0;
    const extension = path.extname(entry.entryName).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      unsupportedEntries.push(entry.entryName);
    }
  }

  return {
    entryCount: entries.length,
    totalBytes,
    unsupportedEntries
  };
}

function inferDimensionSource(html, fileName, dimensions) {
  const checks = [
    { source: 'meta ad.size tag', value: extractMetaAdSize(html) },
    { source: 'canvas element', value: extractCanvasDimensions(html) },
    { source: 'ad container div', value: extractDivDimensions(html) },
    { source: 'filename', value: parseDimensionsFromFileName(fileName) }
  ];

  for (const check of checks) {
    if (
      isValidDimension(check.value) &&
      check.value.width === dimensions.width &&
      check.value.height === dimensions.height
    ) {
      return check.source;
    }
  }

  return 'default (300x250)';
}

function packageTooLarge(fileSize, preset) {
  return preset.maxUploadBytes && fileSize > preset.maxUploadBytes;
}

export async function checkZipPackage({ filePath, fileName, workDir, preset }) {
  const findings = [];
  const stat = await fs.stat(filePath);
  const extractName = `validator-extracted-${process.pid}-${Date.now()}-${randomUUID()}`;
  const metadata = {
    fileSize: stat.size,
    htmlEntry: null,
    dimensions: null,
    dimensionSource: null,
    entryCount: 0,
    unsupportedEntries: [],
    externalReferences: [],
    renderable: false
  };

  if (packageTooLarge(stat.size, preset)) {
    findings.push(buildFinding('error', 'PACKAGE_TOO_LARGE', {
      title: 'Package is too large',
      message: `Package size is ${stat.size} bytes; the preset allows ${preset.maxUploadBytes} bytes.`,
      suggestion: 'Remove unused assets or compress the package before upload.',
      path: fileName
    }));
  }

  let extractedPath;
  try {
    const entryInspection = inspectZipEntries(filePath, preset);
    metadata.entryCount = entryInspection.entryCount;
    metadata.unsupportedEntries = entryInspection.unsupportedEntries;

    for (const entryName of entryInspection.unsupportedEntries.slice(0, MAX_UNSUPPORTED_FINDINGS)) {
      findings.push(buildFinding('warning', 'UNSUPPORTED_FILE_TYPE', {
        title: 'Unsupported file type',
        message: `${entryName} is not in the preset allowed extension list.`,
        suggestion: 'Remove unsupported files or choose a preset that allows this asset type.',
        path: entryName
      }));
    }

    await fs.remove(path.join(workDir, extractName));
    extractedPath = await extractZip(filePath, workDir, { extractName });
  } catch (error) {
    findings.push(buildFinding('error', 'ZIP_EXTRACTION_FAILED', {
      title: 'ZIP could not be extracted',
      message: `The ZIP package could not be extracted: ${error.message}`,
      suggestion: 'Rebuild the ZIP with flat, safe paths and valid compressed files.',
      path: fileName
    }));
    return { metadata, findings };
  }

  try {
    let htmlEntry;
    try {
      htmlEntry = await findBannerEntry(extractedPath);
    } catch {
      findings.push(buildFinding('error', 'MISSING_HTML', {
        title: 'Missing HTML entry',
        message: 'This ZIP does not contain an HTML entry file.',
        suggestion: 'Add an index.html file at the root of the ZIP or include a valid HTML banner entry.',
        path: fileName
      }));
      return { metadata, findings };
    }

    metadata.htmlEntry = path.relative(extractedPath, htmlEntry);
    const html = await fs.readFile(htmlEntry, 'utf8');
    const dimensions = await detectBannerSize(htmlEntry, fileName);
    metadata.dimensions = dimensions;
    metadata.dimensionSource = inferDimensionSource(html, fileName, dimensions);
    metadata.externalReferences = detectExternalReferences(html);

    const renderResult = await checkRenderability({
      htmlPath: htmlEntry,
      dimensions,
      displayPath: metadata.htmlEntry
    });
    metadata.renderable = renderResult.metadata.rendered && !renderResult.findings.some(finding => finding.code === 'RENDER_FAILED');
    findings.push(...renderResult.findings);

    if (preset.requiresClickTag && !detectClickTag(html)) {
      findings.push(buildFinding('error', 'MISSING_CLICKTAG', {
        title: 'Missing clickTag',
        message: 'The HTML does not reference clickTag.',
        suggestion: 'Add clickTag handling required by the selected ad destination.',
        path: metadata.htmlEntry
      }));
    }

    if (!preset.allowExternalReferences) {
      for (const url of metadata.externalReferences) {
        findings.push(buildFinding('warning', 'EXTERNAL_REFERENCE', {
          title: 'External reference detected',
          message: `The HTML references ${url}.`,
          suggestion: 'Package required assets inside the ZIP unless the destination explicitly allows external references.',
          path: metadata.htmlEntry
        }));
      }
    }

    return { metadata, findings };
  } finally {
    if (extractedPath) {
      await fs.remove(extractedPath).catch(() => {});
    }
  }
}
