import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { extractZip, isPathSafe, isContainerZip, expandContainerZip } from '../src/extractZip.js';

const TEST_TEMP = path.resolve('test-temp-extract');

before(async () => {
  await fs.ensureDir(TEST_TEMP);
});

after(async () => {
  await fs.remove(TEST_TEMP);
});

function createZipBuffer(entries) {
  const zip = new AdmZip();
  for (const { name, content } of entries) {
    zip.addFile(name, Buffer.from(content || 'file content'));
  }
  return zip.toBuffer();
}

describe('isPathSafe', () => {
  const root = path.resolve('/tmp/extract') + path.sep;

  it('accepts paths within extract root', () => {
    assert.ok(isPathSafe(path.resolve('/tmp/extract/index.html'), root));
    assert.ok(isPathSafe(path.resolve('/tmp/extract/sub/file.js'), root));
  });

  it('rejects paths outside extract root', () => {
    assert.ok(!isPathSafe(path.resolve('/etc/passwd'), root));
    assert.ok(!isPathSafe(path.resolve('/tmp/other/file.txt'), root));
  });

  it('rejects paths with .. traversal outside root', () => {
    assert.ok(!isPathSafe(path.resolve('/tmp/extract/../../etc/passwd'), root));
  });

  it('rejects paths that resolve to the root itself (not inside it)', () => {
    assert.ok(!isPathSafe(path.resolve('/tmp/extract'), root));
  });
});

describe('extractZip — extraction', () => {
  it('extracts a normal ZIP successfully', async () => {
    const buf = createZipBuffer([
      { name: 'index.html', content: '<html></html>' },
      { name: 'style.css', content: 'body {}' },
    ]);
    const zipPath = path.join(TEST_TEMP, 'normal.zip');
    await fs.writeFile(zipPath, buf);

    const out = await extractZip(zipPath, TEST_TEMP);
    assert.ok(await fs.pathExists(path.join(out, 'index.html')));
    assert.ok(await fs.pathExists(path.join(out, 'style.css')));

    await fs.remove(out);
    await fs.remove(zipPath);
  });

  it('can extract same-named ZIPs into caller-provided unique directories', async () => {
    const buf = createZipBuffer([
      { name: 'index.html', content: '<html></html>' },
    ]);
    const uploadA = path.join(TEST_TEMP, 'uploads', 'a');
    const uploadB = path.join(TEST_TEMP, 'uploads', 'b');
    await fs.ensureDir(uploadA);
    await fs.ensureDir(uploadB);

    const zipA = path.join(uploadA, 'creative.zip');
    const zipB = path.join(uploadB, 'creative.zip');
    await fs.writeFile(zipA, buf);
    await fs.writeFile(zipB, buf);

    const outA = await extractZip(zipA, TEST_TEMP, { extractName: 'work/session-a/file-a' });
    const outB = await extractZip(zipB, TEST_TEMP, { extractName: 'work/session-b/file-b' });

    assert.notStrictEqual(outA, outB);
    assert.ok(outA.endsWith(path.join('work', 'session-a', 'file-a')));
    assert.ok(outB.endsWith(path.join('work', 'session-b', 'file-b')));
    assert.ok(await fs.pathExists(path.join(outA, 'index.html')));
    assert.ok(await fs.pathExists(path.join(outB, 'index.html')));
  });

  it('ignores __MACOSX and dotfiles', async () => {
    const buf = createZipBuffer([
      { name: '__MACOSX/foo', content: 'x' },
      { name: '.hidden', content: 'x' },
      { name: 'index.html', content: '<html></html>' },
    ]);
    const zipPath = path.join(TEST_TEMP, 'macosx.zip');
    await fs.writeFile(zipPath, buf);

    const out = await extractZip(zipPath, TEST_TEMP);
    assert.ok(await fs.pathExists(path.join(out, 'index.html')));
    assert.ok(!(await fs.pathExists(path.join(out, '__MACOSX'))));
    assert.ok(!(await fs.pathExists(path.join(out, '.hidden'))));

    await fs.remove(out);
    await fs.remove(zipPath);
  });

  it('rejects ZIP with too many entries', async () => {
    const zip = new AdmZip();
    for (let i = 0; i < 1001; i++) {
      zip.addFile(`file${i}.txt`, Buffer.from('x'));
    }
    const zipPath = path.join(TEST_TEMP, 'many.zip');
    await fs.writeFile(zipPath, zip.toBuffer());

    await assert.rejects(
      () => extractZip(zipPath, TEST_TEMP),
      /max 1000/i
    );

    await fs.remove(zipPath);
  });

  it('rejects a single oversized entry', async () => {
    const zip = new AdmZip();
    zip.addFile('big.bin', Buffer.alloc(51 * 1024 * 1024));
    const zipPath = path.join(TEST_TEMP, 'big-entry.zip');
    await fs.writeFile(zipPath, zip.toBuffer());

    await assert.rejects(
      () => extractZip(zipPath, TEST_TEMP),
      /max/i
    );

    await fs.remove(zipPath);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function makeInnerZip(htmlContent = '<html></html>') {
  const inner = new AdmZip();
  inner.addFile('index.html', Buffer.from(htmlContent));
  return inner.toBuffer();
}

// A valid inner ZIP buffer (has ZIP magic bytes)
function validInnerZipBuffer(name = 'index.html') {
  const inner = new AdmZip();
  inner.addFile(name, Buffer.from('content'));
  return inner.toBuffer();
}

// ---------------------------------------------------------------------------
// isContainerZip
// ---------------------------------------------------------------------------

describe('isContainerZip', () => {
  it('returns true for a ZIP containing only inner ZIPs', async () => {
    const outer = new AdmZip();
    outer.addFile('300x250.zip', validInnerZipBuffer());
    outer.addFile('728x90.zip', validInnerZipBuffer());
    const outerPath = path.join(TEST_TEMP, 'container.zip');
    await fs.writeFile(outerPath, outer.toBuffer());

    assert.strictEqual(isContainerZip(outerPath), true);
    await fs.remove(outerPath);
  });

  it('returns false for a regular banner ZIP (has HTML)', async () => {
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<html></html>'));
    zip.addFile('style.css', Buffer.from('body{}'));
    const zipPath = path.join(TEST_TEMP, 'banner.zip');
    await fs.writeFile(zipPath, zip.toBuffer());

    assert.strictEqual(isContainerZip(zipPath), false);
    await fs.remove(zipPath);
  });

  it('returns false for a ZIP with both HTML and inner ZIPs', async () => {
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<html></html>'));
    zip.addFile('asset.zip', validInnerZipBuffer());
    const zipPath = path.join(TEST_TEMP, 'mixed.zip');
    await fs.writeFile(zipPath, zip.toBuffer());

    assert.strictEqual(isContainerZip(zipPath), false);
    await fs.remove(zipPath);
  });

  it('returns false for a ZIP with no inner ZIPs', async () => {
    const zip = new AdmZip();
    zip.addFile('style.css', Buffer.from('body{}'));
    zip.addFile('script.js', Buffer.from('var x=1;'));
    const zipPath = path.join(TEST_TEMP, 'assets-only.zip');
    await fs.writeFile(zipPath, zip.toBuffer());

    assert.strictEqual(isContainerZip(zipPath), false);
    await fs.remove(zipPath);
  });

  it('returns false for a non-ZIP path', async () => {
    const txtPath = path.join(TEST_TEMP, 'notazip.zip');
    await fs.writeFile(txtPath, Buffer.from('not a zip'));

    assert.strictEqual(isContainerZip(txtPath), false);
    await fs.remove(txtPath);
  });
});

// ---------------------------------------------------------------------------
// expandContainerZip
// ---------------------------------------------------------------------------

describe('expandContainerZip', () => {
  it('extracts inner ZIPs into the upload directory', async () => {
    const outer = new AdmZip();
    outer.addFile('300x250.zip', validInnerZipBuffer());
    outer.addFile('728x90.zip', validInnerZipBuffer());
    const outerPath = path.join(TEST_TEMP, 'batch.zip');
    await fs.writeFile(outerPath, outer.toBuffer());

    const results = await expandContainerZip(outerPath, TEST_TEMP);

    assert.strictEqual(results.length, 2);
    assert.ok(results.some(r => r.name === '300x250.zip'));
    assert.ok(results.some(r => r.name === '728x90.zip'));
    for (const r of results) {
      assert.ok(await fs.pathExists(r.path));
      assert.ok(r.size > 0);
      const magic = Buffer.alloc(4);
      const fd = fs.openSync(r.path, 'r');
      fs.readSync(fd, magic, 0, 4, 0);
      fs.closeSync(fd);
      assert.ok(magic.equals(ZIP_MAGIC), 'extracted inner ZIP has valid magic bytes');
    }

    await fs.remove(outerPath);
    for (const r of results) await fs.remove(r.path).catch(() => {});
  });

  it('skips inner entries whose magic bytes are invalid', async () => {
    const outer = new AdmZip();
    outer.addFile('good.zip', validInnerZipBuffer());
    outer.addFile('evil.zip', Buffer.from('not a zip file'));
    const outerPath = path.join(TEST_TEMP, 'mixed-magic.zip');
    await fs.writeFile(outerPath, outer.toBuffer());

    const results = await expandContainerZip(outerPath, TEST_TEMP);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'good.zip');

    await fs.remove(outerPath);
    for (const r of results) await fs.remove(r.path).catch(() => {});
  });

  it('deduplicates entries with the same basename', async () => {
    const outer = new AdmZip();
    outer.addFile('sub-a/banner.zip', validInnerZipBuffer());
    outer.addFile('sub-b/banner.zip', validInnerZipBuffer());
    const outerPath = path.join(TEST_TEMP, 'dupe-names.zip');
    await fs.writeFile(outerPath, outer.toBuffer());

    const results = await expandContainerZip(outerPath, TEST_TEMP);

    assert.strictEqual(results.length, 2);
    const names = results.map(r => r.name);
    assert.ok(names.includes('banner.zip'));
    assert.ok(names.includes('banner_2.zip'));

    await fs.remove(outerPath);
    for (const r of results) await fs.remove(r.path).catch(() => {});
  });

  it('respects the maxInner limit', async () => {
    const outer = new AdmZip();
    for (let i = 0; i < 5; i++) {
      outer.addFile(`banner_${i}.zip`, validInnerZipBuffer());
    }
    const outerPath = path.join(TEST_TEMP, 'many-inner.zip');
    await fs.writeFile(outerPath, outer.toBuffer());

    const results = await expandContainerZip(outerPath, TEST_TEMP, { maxInner: 3 });

    assert.strictEqual(results.length, 3);

    await fs.remove(outerPath);
    for (const r of results) await fs.remove(r.path).catch(() => {});
  });
});
