import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import AdmZip from 'adm-zip';
import { extractZip, isPathSafe } from '../src/extractZip.js';

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
