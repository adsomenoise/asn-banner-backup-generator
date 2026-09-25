import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { buildBundleWithOriginals, buildRivePackage } from '../src/jobs/bundleOriginals.js';

describe('buildBundleWithOriginals', () => {
  let dir;
  let backupZip;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bundle-test-'));
    const zip = new AdmZip();
    zip.addFile('banner.jpg', Buffer.from('jpg'));
    zip.addFile('errors.json', Buffer.from('[]'));
    backupZip = path.join(dir, 'backup.zip');
    zip.writeZip(backupZip);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('puts ZIP and video originals at the root next to the backup images', async () => {
    const zipPath = path.join(dir, 'upload-a');
    const videoPath = path.join(dir, 'upload-b');
    await writeFile(zipPath, 'zip-bytes');
    await writeFile(videoPath, 'video-bytes');

    const dest = path.join(dir, 'out', 'bundle.zip');
    const { added, missing } = await buildBundleWithOriginals(backupZip, { files: [
      { id: 'a', name: 'banner.zip', path: zipPath, type: 'zip' },
      { id: 'b', name: 'spot_1920x1080.mp4', path: videoPath, type: 'video' }
    ] }, dest);

    assert.strictEqual(added, 2);
    assert.deepStrictEqual(missing, []);
    const entries = new AdmZip(dest).getEntries().map(e => e.entryName).sort();
    assert.deepStrictEqual(entries, ['banner.jpg', 'banner.zip', 'errors.json', 'spot_1920x1080.mp4']);
    assert.strictEqual(new AdmZip(dest).readAsText('spot_1920x1080.mp4'), 'video-bytes');
  });

  it('adds a .riv as <name>.zip with <name>.js + <name>.html, never the raw .riv', async () => {
    const rivPath = path.join(dir, 'upload-riv');
    await writeFile(rivPath, 'RIVE-bytes');
    const dest = path.join(dir, 'riv.zip');
    const { added } = await buildBundleWithOriginals(backupZip, { files: [
      { id: 'r', name: 'hero_300x250.riv', path: rivPath, type: 'riv' }
    ] }, dest);

    assert.strictEqual(added, 1);
    const out = new AdmZip(dest);
    const names = out.getEntries().map(e => e.entryName);
    assert.ok(names.includes('hero_300x250.zip'));
    assert.ok(names.every(n => !n.endsWith('.riv')));

    const inner = new AdmZip(out.readFile('hero_300x250.zip'));
    assert.deepStrictEqual(inner.getEntries().map(e => e.entryName).sort(), ['hero_300x250.html', 'hero_300x250.js']);
    assert.strictEqual(inner.readAsText('hero_300x250.js'), 'RIVE-bytes');
    assert.match(inner.readAsText('hero_300x250.html'), /hero_300x250\.js/);
  });

  it('skips a .riv whose package is already in the backup ZIP', async () => {
    const rivPath = path.join(dir, 'upload-riv-done');
    await writeFile(rivPath, 'RIVE-bytes');
    const dest = path.join(dir, 'riv-done.zip');
    const { added } = await buildBundleWithOriginals(backupZip, {
      files: [{ id: 'r', name: 'hero_300x250.riv', path: rivPath, type: 'riv' }],
      results: [{ fileId: 'r', type: 'riv' }]
    }, dest);
    assert.strictEqual(added, 0);
    assert.deepStrictEqual(new AdmZip(dest).getEntries().map(e => e.entryName).sort(), ['banner.jpg', 'errors.json']);
  });

  it('reports a .riv without dimensions in its name as missing', async () => {
    const rivPath = path.join(dir, 'upload-riv-nodims');
    await writeFile(rivPath, 'RIVE-bytes');
    const dest = path.join(dir, 'riv-nodims.zip');
    const { added, missing } = await buildBundleWithOriginals(backupZip, { files: [
      { id: 'r', name: 'hero.riv', path: rivPath, type: 'riv' }
    ] }, dest);
    assert.strictEqual(added, 0);
    assert.deepStrictEqual(missing, ['hero.riv']);
  });

  it('suffixes duplicate filenames instead of overwriting', async () => {
    const a = path.join(dir, 'dup-a');
    const b = path.join(dir, 'dup-b');
    await writeFile(a, 'first');
    await writeFile(b, 'second');

    const dest = path.join(dir, 'dup.zip');
    await buildBundleWithOriginals(backupZip, { files: [
      { name: '300x250.zip', path: a },
      { name: '300x250.zip', path: b }
    ] }, dest);

    const out = new AdmZip(dest);
    assert.strictEqual(out.readAsText('300x250.zip'), 'first');
    assert.strictEqual(out.readAsText('300x250 (2).zip'), 'second');
  });

  it('does not overwrite a backup entry with the same name', async () => {
    const p = path.join(dir, 'clash');
    await writeFile(p, 'original');
    const dest = path.join(dir, 'clash.zip');
    await buildBundleWithOriginals(backupZip, { files: [{ name: 'banner.jpg', path: p }] }, dest);
    const out = new AdmZip(dest);
    assert.strictEqual(out.readAsText('banner.jpg'), 'jpg');
    assert.strictEqual(out.readAsText('banner (2).jpg'), 'original');
  });

  it('strips directory components from original names', async () => {
    const p = path.join(dir, 'trav');
    await writeFile(p, 'x');
    const dest = path.join(dir, 'trav.zip');
    await buildBundleWithOriginals(backupZip, { files: [{ name: '../../evil.zip', path: p }] }, dest);
    const names = new AdmZip(dest).getEntries().map(e => e.entryName);
    assert.ok(names.includes('evil.zip'));
    assert.ok(names.every(n => !n.includes('..')));
  });

  it('reports files whose upload is gone without failing', async () => {
    const dest = path.join(dir, 'missing.zip');
    const { added, missing } = await buildBundleWithOriginals(backupZip, { files: [
      { name: 'gone.zip', path: path.join(dir, 'does-not-exist') },
      { name: 'nopath.zip', path: null }
    ] }, dest);
    assert.strictEqual(added, 0);
    assert.deepStrictEqual(missing, ['gone.zip', 'nopath.zip']);
  });
});

describe('buildRivePackage', () => {
  let dir;
  const RIV = Buffer.concat([Buffer.from('RIVE'), Buffer.from('payload')]);

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rive-pkg-test-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function packageZip(fileName, entries) {
    const zip = new AdmZip();
    for (const [name, data] of Object.entries(entries)) zip.addFile(name, Buffer.from(data));
    const p = path.join(dir, fileName);
    zip.writeZip(p);
    return p;
  }

  it('returns null when the filename has no dimensions', () => {
    assert.strictEqual(buildRivePackage({ path: '/nonexistent', name: 'hero.riv' }), null);
  });

  it('packages a plain .riv as <name>.js + <name>.html', async () => {
    const rivPath = path.join(dir, 'plain');
    await writeFile(rivPath, RIV);
    const pkg = buildRivePackage({ path: rivPath, name: 'hero_300x250.riv' });
    assert.strictEqual(pkg.name, 'hero_300x250');
    assert.strictEqual(pkg.htmlEntry, 'hero_300x250.html');
    const inner = new AdmZip(pkg.buffer);
    assert.deepStrictEqual(inner.getEntries().map(e => e.entryName).sort(), ['hero_300x250.html', 'hero_300x250.js']);
  });

  it('keeps the assets of a Rive package, swapping the .riv for <name>.js', async () => {
    const zipPath = await packageZip('pkg.zip', {
      'hero_300x250.riv': RIV,
      'fonts/brand.ttf': 'font',
      'logo.png': 'png'
    });
    const pkg = buildRivePackage({ path: zipPath, name: 'hero_300x250.riv', packageEntry: 'hero_300x250.riv' });
    const inner = new AdmZip(pkg.buffer);
    assert.deepStrictEqual(inner.getEntries().map(e => e.entryName).sort(), [
      'fonts/brand.ttf', 'hero_300x250.html', 'hero_300x250.js', 'logo.png'
    ]);
    assert.deepStrictEqual(inner.readFile('hero_300x250.js'), RIV);
    assert.strictEqual(inner.readAsText('logo.png'), 'png');
  });

  it('flattens a single wrapper folder so the HTML sits at the root', async () => {
    const zipPath = await packageZip('wrapped.zip', {
      'campaign/hero_300x250.riv': RIV,
      'campaign/logo.png': 'png'
    });
    const pkg = buildRivePackage({ path: zipPath, name: 'hero_300x250.riv', packageEntry: 'campaign/hero_300x250.riv' });
    assert.strictEqual(pkg.htmlEntry, 'hero_300x250.html');
    assert.deepStrictEqual(new AdmZip(pkg.buffer).getEntries().map(e => e.entryName).sort(), [
      'hero_300x250.html', 'hero_300x250.js', 'logo.png'
    ]);
  });

  it('puts <name>.js and <name>.html next to the .riv when there is no single wrapper', async () => {
    const zipPath = await packageZip('nested.zip', {
      'rive/hero_300x250.riv': RIV,
      'readme.txt': 'hi'
    });
    const pkg = buildRivePackage({ path: zipPath, name: 'hero_300x250.riv', packageEntry: 'rive/hero_300x250.riv' });
    assert.strictEqual(pkg.htmlEntry, 'rive/hero_300x250.html');
    assert.deepStrictEqual(new AdmZip(pkg.buffer).getEntries().map(e => e.entryName).sort(), [
      'readme.txt', 'rive/hero_300x250.html', 'rive/hero_300x250.js'
    ]);
  });

  it('is used by the originals bundle for a Rive package that failed processing', async () => {
    const zipPath = await packageZip('failed-pkg.zip', { 'hero_300x250.riv': RIV, 'logo.png': 'png' });
    const backup = new AdmZip();
    backup.addFile('errors.json', Buffer.from('[]'));
    const backupZip = path.join(dir, 'backup-failed.zip');
    backup.writeZip(backupZip);

    const dest = path.join(dir, 'bundle-failed.zip');
    await buildBundleWithOriginals(backupZip, { files: [
      { id: 'r', name: 'hero_300x250.riv', path: zipPath, type: 'riv', packageEntry: 'hero_300x250.riv' }
    ] }, dest);

    const out = new AdmZip(dest);
    assert.deepStrictEqual(out.getEntries().map(e => e.entryName).sort(), ['errors.json', 'hero_300x250.zip']);
    assert.deepStrictEqual(new AdmZip(out.readFile('hero_300x250.zip')).getEntries().map(e => e.entryName).sort(), [
      'hero_300x250.html', 'hero_300x250.js', 'logo.png'
    ]);
  });
});
