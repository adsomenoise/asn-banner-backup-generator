import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { sanitizeFileName } from '../utils.js';
import { parseRivDimensions, generateRiveHTML } from '../riveTemplate.js';
import { shouldIgnore } from '../extractZip.js';

/**
 * Package a .riv creative the way ad platforms expect it: the Rive file
 * renamed to <name>.js plus a generated <name>.html wrapper, zipped as
 * <name>.zip. <name> comes from the .riv filename. Used by capture and by
 * both downloads, so all three always agree on the layout.
 *
 * For a Rive package upload (a ZIP holding one .riv plus assets, see
 * findRivePackageEntry) `file.path` is that ZIP and `file.packageEntry` the
 * .riv inside it: the assets are kept, the .riv is swapped for <name>.js and
 * <name>.html is added next to it. A single wrapper folder around everything
 * is flattened so the HTML ends up at the ZIP root.
 *
 * @param {{ path: string, name: string, packageEntry?: string|null }} file
 * @returns {{ name: string, buffer: Buffer, htmlEntry: string } | null}  null
 *   when the .riv filename carries no WxH dimensions (no wrapper possible).
 */
export function buildRivePackage(file) {
  const name = sanitizeFileName(path.basename(file.name, '.riv'));
  const dims = parseRivDimensions(file.name);
  if (!dims) return null;

  const out = new AdmZip();
  let dir = '';

  if (file.packageEntry) {
    const source = new AdmZip(file.path);
    const entries = source.getEntries().filter(e => !e.isDirectory && !shouldIgnore(e.entryName));
    const rivEntry = entries.find(e => e.entryName === file.packageEntry);
    if (!rivEntry) throw new Error(`Rive file ${file.packageEntry} not found in package`);

    const rivDir = path.posix.dirname(rivEntry.entryName.replace(/\\/g, '/'));
    const wrapper = rivDir === '.' ? '' : `${rivDir.split('/')[0]}/`;
    const strip = wrapper && entries.every(e => e.entryName.startsWith(wrapper)) ? wrapper : '';
    dir = rivDir === '.' ? '' : `${rivDir}/`.slice(strip.length);

    for (const entry of entries) {
      if (entry === rivEntry) continue;
      out.addFile(entry.entryName.slice(strip.length), entry.getData());
    }
    out.addFile(`${dir}${name}.js`, rivEntry.getData());
  } else {
    out.addLocalFile(file.path, '', `${name}.js`);
  }

  const htmlEntry = `${dir}${name}.html`;
  out.addFile(htmlEntry, Buffer.from(generateRiveHTML(`${name}.js`, dims.width, dims.height), 'utf-8'));
  return { name, buffer: out.toBuffer(), htmlEntry };
}

/**
 * Pick a unique root-level entry name. Originals share the root with the
 * backup images (and a .riv's wrapper ZIP), and two uploads can share a
 * filename, so later clashes get a numeric suffix: banner.zip, banner (2).zip, ...
 */
function uniqueName(name, taken) {
  const base = path.basename(name) || 'file';
  if (!taken.has(base.toLowerCase())) {
    taken.add(base.toLowerCase());
    return base;
  }
  const { name: stem, ext } = path.parse(base);
  let n = 2;
  while (taken.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
  const candidate = `${stem} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Build a ZIP containing everything in the backup-images ZIP plus the
 * originally uploaded creatives, side by side at the root. ZIPs and videos
 * are added as uploaded; .riv files are added as their <name>.zip package
 * (see buildRivePackage). A .riv that processed successfully already has its
 * package in the backup ZIP, so it is not added twice.
 *
 * @param {string} backupZipPath  Existing backup-images ZIP (job.outputZip)
 * @param {{ files: Array<{id: string, name: string, path: string|null, type: string, packageEntry?: string|null}>,
 *           results?: Array<{fileId: string, type: string}> }} job
 * @param {string} destPath  Where to write the combined ZIP
 * @returns {Promise<{added: number, missing: string[]}>}
 */
export async function buildBundleWithOriginals(backupZipPath, { files, results = [] }, destPath) {
  const zip = new AdmZip(backupZipPath);
  const taken = new Set(zip.getEntries().map(e => e.entryName.toLowerCase()));
  const packagedRiv = new Set(results.filter(r => r.type === 'riv').map(r => r.fileId));
  const missing = [];
  let added = 0;

  for (const file of files) {
    if (file.type === 'riv' && packagedRiv.has(file.id)) continue;
    if (!file.path || !(await fs.pathExists(file.path))) {
      missing.push(file.name);
      continue;
    }
    if (file.type === 'riv') {
      const pkg = buildRivePackage(file);
      if (!pkg) {
        missing.push(file.name);
        continue;
      }
      zip.addFile(uniqueName(`${pkg.name}.zip`, taken), pkg.buffer);
    } else {
      zip.addLocalFile(file.path, '', uniqueName(file.name, taken));
    }
    added++;
  }

  await fs.ensureDir(path.dirname(destPath));
  zip.writeZip(destPath);
  return { added, missing };
}
