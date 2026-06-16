import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';
import { findBannerEntry } from '../src/findBannerEntry.js';

const TEST_TEMP = path.resolve('test-temp-find');

before(async () => {
  await fs.ensureDir(TEST_TEMP);
});

after(async () => {
  await fs.remove(TEST_TEMP);
});

describe('findBannerEntry', () => {
  it('finds a single HTML file at root', async () => {
    await fs.writeFile(path.join(TEST_TEMP, 'index.html'), '<html></html>');
    const result = await findBannerEntry(TEST_TEMP);
    assert.strictEqual(result, path.join(TEST_TEMP, 'index.html'));
    await fs.remove(path.join(TEST_TEMP, 'index.html'));
  });

  it('finds HTML in subdirectory', async () => {
    const sub = path.join(TEST_TEMP, 'sub');
    await fs.ensureDir(sub);
    await fs.writeFile(path.join(sub, 'banner.html'), '<html></html>');
    const result = await findBannerEntry(TEST_TEMP);
    assert.strictEqual(result, path.join(sub, 'banner.html'));
    await fs.remove(sub);
  });

  it('prefers shallowest HTML over deeper ones', async () => {
    await fs.writeFile(path.join(TEST_TEMP, 'root.html'), '<html></html>');
    const sub = path.join(TEST_TEMP, 'sub');
    await fs.ensureDir(sub);
    await fs.writeFile(path.join(sub, 'deep.html'), '<html></html>');
    const result = await findBannerEntry(TEST_TEMP);
    assert.strictEqual(result, path.join(TEST_TEMP, 'root.html'));
    await fs.remove(path.join(TEST_TEMP, 'root.html'));
    await fs.remove(sub);
  });

  it('ignores __MACOSX and node_modules directories', async () => {
    const mac = path.join(TEST_TEMP, '__MACOSX');
    const nm = path.join(TEST_TEMP, 'node_modules');
    await fs.ensureDir(mac);
    await fs.ensureDir(nm);
    await fs.writeFile(path.join(mac, 'index.html'), '<html></html>');
    await fs.writeFile(path.join(nm, 'index.html'), '<html></html>');
    await fs.writeFile(path.join(TEST_TEMP, 'banner.html'), '<html></html>');
    const result = await findBannerEntry(TEST_TEMP);
    assert.strictEqual(result, path.join(TEST_TEMP, 'banner.html'));
    await fs.remove(mac);
    await fs.remove(nm);
    await fs.remove(path.join(TEST_TEMP, 'banner.html'));
  });

  it('throws when no HTML files found', async () => {
    const empty = path.join(TEST_TEMP, 'empty');
    await fs.ensureDir(empty);
    await assert.rejects(() => findBannerEntry(empty), /No \.html file found/i);
    await fs.remove(empty);
  });
});
