import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import { checkAssetPaths } from '../src/checkAssetPaths.js';

const TEST_TEMP = path.join(process.cwd(), `test-temp-checkassets-${Date.now()}`);

before(async () => { await fs.ensureDir(TEST_TEMP); });
after(async () => { await fs.remove(TEST_TEMP); });

async function makeExtracted(files) {
  const dir = path.join(TEST_TEMP, `ext-${Math.random().toString(36).slice(2)}`);
  await fs.ensureDir(dir);
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content || '');
  }
  return dir;
}

describe('checkAssetPaths', () => {
  it('returns empty missing for a self-contained banner', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="main.js"></script><link rel="stylesheet" href="style.css">',
      'main.js': '',
      'style.css': ''
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 2);
  });

  it('reports a missing script', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="missing.js"></script>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['missing.js']);
    assert.strictEqual(result.checked, 1);
  });

  it('reports multiple missing assets', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="a.js"></script><link href="b.css"><img src="c.png">'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.strictEqual(result.missing.length, 3);
    assert.ok(result.missing.includes('a.js'));
    assert.ok(result.missing.includes('b.css'));
    assert.ok(result.missing.includes('c.png'));
  });

  it('ignores http/https external URLs', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="https://cdn.example.com/lib.js"></script><img src="http://cdn.example.com/img.png">'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 0);
  });

  it('ignores protocol-relative URLs', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="//cdn.example.com/lib.js"></script>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 0);
  });

  it('ignores data: URIs', async () => {
    const dir = await makeExtracted({
      'index.html': '<img src="data:image/png;base64,abc123">'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 0);
  });

  it('strips query strings and fragments before checking', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="main.js?v=123"></script><img src="img.png#section">',
      'main.js': '',
      'img.png': ''
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
  });

  it('checks CSS url() references in inline styles', async () => {
    const dir = await makeExtracted({
      'index.html': '<style>body { background: url("bg.png"); }</style>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['bg.png']);
  });

  it('checks CSS url() references in style attributes', async () => {
    const dir = await makeExtracted({
      'index.html': '<div style="background: url(\'sprite.png\')"></div>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['sprite.png']);
  });

  it('checks srcset entries', async () => {
    const dir = await makeExtracted({
      'index.html': '<img srcset="img@2x.png 2x, img.png 1x">',
      'img.png': ''
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['img@2x.png']);
  });

  it('handles assets in subdirectories', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="js/lib.js"></script><img src="img/logo.png">',
      'js/lib.js': '',
      'img/logo.png': ''
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
  });

  it('silently ignores path traversal refs that escape extractRoot', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="../escape.js"></script>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 0);
  });

  it('returns checked=0 and missing=[] for an HTML with no asset refs', async () => {
    const dir = await makeExtracted({
      'index.html': '<html><body><h1>Hello</h1></body></html>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 0);
  });

  it('does not check <a href> as an asset reference', async () => {
    const dir = await makeExtracted({
      'index.html': '<a href="missing-page.html">link</a>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
    assert.strictEqual(result.checked, 0);
  });

  it('handles unquoted src attribute (valid HTML5)', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src=main.js></script>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['main.js']);
    assert.strictEqual(result.checked, 1);
  });

  it('finds missing image referenced in a linked CSS file', async () => {
    const dir = await makeExtracted({
      'index.html': '<link rel="stylesheet" href="style.css">',
      'style.css': '.bg { background-image: url("images/bg.jpg"); }'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.ok(result.missing.includes('images/bg.jpg'), 'should report missing CSS background image');
  });

  it('does not report present image referenced in a linked CSS file', async () => {
    const dir = await makeExtracted({
      'index.html': '<link rel="stylesheet" href="style.css">',
      'style.css': '.bg { background-image: url("images/bg.jpg"); }',
      'images/bg.jpg': ''
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
  });

  it('checks @import references inside a linked CSS file', async () => {
    const dir = await makeExtracted({
      'index.html': '<link rel="stylesheet" href="style.css">',
      'style.css': '@import "fonts.css";'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.ok(result.missing.includes('fonts.css'));
  });

  it('does not open a CSS file that is itself missing', async () => {
    const dir = await makeExtracted({
      'index.html': '<link rel="stylesheet" href="missing.css">'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['missing.css']);
  });

  it('finds missing image referenced as a string literal in a linked JS file', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="banner.js"></script>',
      'banner.js': 'var manifest = [{src:"images/bg.jpg"},{src:"images/logo.png"}];'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.ok(result.missing.includes('images/bg.jpg'));
    assert.ok(result.missing.includes('images/logo.png'));
  });

  it('does not report present image referenced in a linked JS file', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="banner.js"></script>',
      'banner.js': 'var manifest = [{src:"images/bg.jpg"}];',
      'images/bg.jpg': ''
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, []);
  });

  it('does not flag external URLs found as JS string literals', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="banner.js"></script>',
      'banner.js': 'var cdnImg = "https://cdn.example.com/bg.jpg"; var local = "logo.png";'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.ok(result.missing.includes('logo.png'));
    assert.ok(!result.missing.some(m => m.includes('cdn.example.com')));
  });

  it('detects missing asset when JS string has a cache-busting query string', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="banner.js"></script>',
      'banner.js': '{src:"images/iPhone.png?1726579219119", id:"iPhone"}'
      // images/iPhone.png is absent — only iPhone2.png exists
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.ok(result.missing.some(m => m.includes('iPhone.png')), 'should detect missing image despite cache-busting query string');
  });

  it('does not open a JS file that is itself missing', async () => {
    const dir = await makeExtracted({
      'index.html': '<script src="missing.js"></script>'
    });
    const result = await checkAssetPaths(path.join(dir, 'index.html'), dir);
    assert.deepEqual(result.missing, ['missing.js']);
  });
});
