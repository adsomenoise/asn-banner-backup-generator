import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  sanitizeFileName,
  parseDimensionsFromFileName,
  extractMetaAdSize,
  extractCanvasDimensions,
  extractDivDimensions,
  isValidDimension,
  DEFAULT_DIMENSIONS,
} from '../src/utils.js';

describe('sanitizeFileName', () => {
  it('replaces special chars with underscores', () => {
    assert.strictEqual(sanitizeFileName('hello world'), 'hello_world');
    assert.strictEqual(sanitizeFileName('a/b/c'), 'a_b_c');
    assert.strictEqual(sanitizeFileName('foo:bar'), 'foo_bar');
  });

  it('preserves alphanumerics, dots, hyphens, underscores', () => {
    assert.strictEqual(sanitizeFileName('Banner_300x250.v1'), 'Banner_300x250.v1');
    assert.strictEqual(sanitizeFileName('abc123'), 'abc123');
  });

  it('handles empty string', () => {
    assert.strictEqual(sanitizeFileName(''), '');
  });
});

describe('parseDimensionsFromFileName', () => {
  it('parses WxH pattern', () => {
    assert.deepStrictEqual(parseDimensionsFromFileName('Banner_300x250'), { width: 300, height: 250 });
    assert.deepStrictEqual(parseDimensionsFromFileName('160x600'), { width: 160, height: 600 });
  });

  it('returns null for no match', () => {
    assert.strictEqual(parseDimensionsFromFileName('banner'), null);
    assert.strictEqual(parseDimensionsFromFileName(''), null);
  });

  it('clamps unreasonably large values via validation', () => {
    const dim = parseDimensionsFromFileName('99999x99999');
    assert.ok(dim === null || (dim.width < 10000 && dim.height < 10000));
  });
});

describe('extractMetaAdSize', () => {
  it('parses standard ad.size meta tag', () => {
    const html = '<meta name="ad.size" content="width=300,height=250">';
    assert.deepStrictEqual(extractMetaAdSize(html), { width: 300, height: 250 });
  });

  it('parses WxH format in content', () => {
    const html = '<meta name="ad.size" content="728x90">';
    assert.deepStrictEqual(extractMetaAdSize(html), { width: 728, height: 90 });
  });

  it('handles single-quoted attributes', () => {
    const html = "<meta name='ad.size' content='width=160,height=600'>";
    assert.deepStrictEqual(extractMetaAdSize(html), { width: 160, height: 600 });
  });

  it('returns null when no meta tag', () => {
    assert.strictEqual(extractMetaAdSize('<html></html>'), null);
  });
});

describe('extractCanvasDimensions', () => {
  it('parses width/height attributes', () => {
    const html = '<canvas id="c" width="300" height="250"></canvas>';
    assert.deepStrictEqual(extractCanvasDimensions(html), { width: 300, height: 250 });
  });

  it('parses inline style dimensions', () => {
    const html = '<canvas style="width:300px;height:250px"></canvas>';
    assert.deepStrictEqual(extractCanvasDimensions(html), { width: 300, height: 250 });
  });

  it('returns null when no canvas', () => {
    assert.strictEqual(extractCanvasDimensions('<div></div>'), null);
  });
});

describe('extractDivDimensions', () => {
  it('parses style on #ad div', () => {
    const html = '<div id="ad" style="width:300px;height:250px"></div>';
    assert.deepStrictEqual(extractDivDimensions(html), { width: 300, height: 250 });
  });

  it('parses style on .ad div', () => {
    const html = '<div class="ad" style="width:728px;height:90px"></div>';
    assert.deepStrictEqual(extractDivDimensions(html), { width: 728, height: 90 });
  });

  it('returns null when no matching div', () => {
    assert.strictEqual(extractDivDimensions('<span></span>'), null);
  });
});

describe('isValidDimension', () => {
  it('accepts valid dimensions', () => {
    assert.strictEqual(isValidDimension({ width: 300, height: 250 }), true);
  });

  it('rejects null/undefined', () => {
    assert.ok(!isValidDimension(null));
    assert.ok(!isValidDimension(undefined));
  });

  it('rejects zero or negative', () => {
    assert.strictEqual(isValidDimension({ width: 0, height: 250 }), false);
    assert.strictEqual(isValidDimension({ width: -1, height: 250 }), false);
  });

  it('rejects oversized values', () => {
    assert.strictEqual(isValidDimension({ width: 99999, height: 250 }), false);
  });
});

describe('DEFAULT_DIMENSIONS', () => {
  it('is 300x250', () => {
    assert.deepStrictEqual(DEFAULT_DIMENSIONS, { width: 300, height: 250 });
  });
});
