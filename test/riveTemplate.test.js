import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseRivDimensions, generateRiveHTML } from '../src/riveTemplate.js';

describe('parseRivDimensions', () => {
  it('parses WxH from filename', () => {
    assert.deepStrictEqual(parseRivDimensions('Banner_300x250.riv'), { width: 300, height: 250 });
    assert.deepStrictEqual(parseRivDimensions('728x90.riv'), { width: 728, height: 90 });
  });

  it('returns null when no match', () => {
    assert.strictEqual(parseRivDimensions('banner.riv'), null);
    assert.strictEqual(parseRivDimensions(''), null);
  });

  it('rejects unreasonably large values', () => {
    assert.strictEqual(parseRivDimensions('99999x99999.riv'), null);
  });
});

describe('generateRiveHTML', () => {
  it('includes correct ad.size meta tag', () => {
    const html = generateRiveHTML('Banner_300x250.js', 300, 250);
    assert.match(html, /<meta name="ad\.size" content="width=300,height=250">/);
  });

  it('includes the Rive CDN script', () => {
    const html = generateRiveHTML('test.js', 160, 600);
    assert.match(html, /rive\.js/);
    assert.match(html, /s0\.2mdn\.net/);
  });

  it('includes getBannerSize function with fallback dimensions', () => {
    const html = generateRiveHTML('test.js', 728, 90);
    assert.match(html, /function getBannerSize/);
    assert.match(html, /width = 728/);
    assert.match(html, /height = 90/);
  });

  it('references the JS file in riveInstance', () => {
    const html = generateRiveHTML('MyCreative_320x480.js', 320, 480);
    assert.match(html, /src: 'MyCreative_320x480\.js'/);
    assert.match(html, /rive\.Rive/);
  });

  it('contains clickTag infrastructure', () => {
    const html = generateRiveHTML('test.js', 300, 250);
    assert.match(html, /clickTag/);
    assert.match(html, /isInitClickTag/);
  });

  it('has border overlay element', () => {
    const html = generateRiveHTML('test.js', 300, 250);
    assert.match(html, /border-overlay/);
  });

  it('wraps setup in an IIFE', () => {
    const html = generateRiveHTML('test.js', 300, 250);
    assert.match(html, /\(function\s*\(\)/);
  });
});
