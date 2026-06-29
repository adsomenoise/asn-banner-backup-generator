import fs from 'fs-extra';
import path from 'path';

const EXTERNAL_RE = /^(https?:|\/\/|data:|javascript:|mailto:|about:|#)/i;

function isExternal(ref) {
  return !ref || EXTERNAL_RE.test(ref) || path.isAbsolute(ref);
}

function stripQueryAndFragment(ref) {
  return ref.split(/[?#]/)[0];
}

function extractHtmlRefs(html) {
  const refs = new Set();

  // src="..." or src=... (unquoted, valid HTML5) — script, img, video, audio, source, embed, iframe
  for (const m of html.matchAll(/\bsrc=["']?([^"'\s>]+)/gi)) {
    refs.add(m[1]);
  }

  // <link ... href="..."> — stylesheets, preload, prefetch (not <a href>)
  for (const m of html.matchAll(/<link\b[^>]*?\bhref=["']?([^"'\s>]+)/gi)) {
    refs.add(m[1]);
  }

  // srcset="url 2x, url2 1x"
  for (const m of html.matchAll(/\bsrcset=["']([^"']+)/gi)) {
    for (const entry of m[1].split(',')) {
      const url = entry.trim().split(/\s+/)[0];
      if (url) refs.add(url);
    }
  }

  // url(...) in inline <style> blocks and style="" attributes
  for (const m of html.matchAll(/url\(["']?([^"')\s]+)["']?\)/gi)) {
    refs.add(m[1]);
  }

  return refs;
}

function extractCssRefs(css) {
  const refs = new Set();

  // url(...) — background-image, font-face src, cursor, etc.
  for (const m of css.matchAll(/url\(["']?([^"')\s]+)["']?\)/gi)) {
    refs.add(m[1]);
  }

  // @import "..." or @import '...' (without url())
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/gi)) {
    refs.add(m[1]);
  }

  return refs;
}

// Asset extensions commonly referenced as string literals in banner JS files
// (GWD, Animate CC, GSAP preloaders, etc.)
// Allow optional query string / cache-buster after the extension (e.g. "img.png?1726579219")
const JS_ASSET_RE = /["']([^"'\s*{}()[\]]+\.(?:jpe?g|png|gif|svg|webp|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|ogg)[^"']*)["']/gi;

function extractJsRefs(js) {
  const refs = new Set();
  for (const m of js.matchAll(JS_ASSET_RE)) {
    refs.add(m[1]);
  }
  return refs;
}

/**
 * Parses an HTML banner file for static local asset references and checks
 * that each referenced file exists within extractRoot.  Also opens any
 * locally-resolved CSS files and checks their url() and @import references
 * (one level deep).
 *
 * Returns { missing: string[], checked: number }.
 * External URLs (http/https/data://) and absolute paths are skipped.
 * Path traversal refs that escape extractRoot are silently ignored.
 */
export async function checkAssetPaths(htmlFile, extractRoot) {
  const html = await fs.readFile(htmlFile, 'utf8');
  const htmlDir = path.dirname(htmlFile);
  const root = path.resolve(extractRoot);

  const missing = [];
  let checked = 0;

  async function checkRef(raw, baseDir) {
    const ref = stripQueryAndFragment(raw);
    if (!ref || isExternal(ref)) return null;

    const resolved = path.resolve(baseDir, ref);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;

    checked++;
    if (!(await fs.pathExists(resolved))) {
      missing.push(raw);
      return null;
    }
    return resolved;
  }

  // --- HTML-level refs ---
  const cssQueue = [];
  const jsQueue = [];
  for (const raw of extractHtmlRefs(html)) {
    const resolved = await checkRef(raw, htmlDir);
    if (!resolved) continue;
    const clean = stripQueryAndFragment(raw);
    if (/\.css$/i.test(clean)) cssQueue.push({ filePath: resolved, dir: path.dirname(resolved) });
    if (/\.js$/i.test(clean))  jsQueue.push({ filePath: resolved, dir: path.dirname(resolved) });
  }

  // --- CSS refs (one level deep) ---
  for (const { filePath, dir } of cssQueue) {
    let css;
    try { css = await fs.readFile(filePath, 'utf8'); } catch { continue; }
    for (const raw of extractCssRefs(css)) {
      await checkRef(raw, dir);
    }
  }

  // --- JS string-literal asset refs (banner JS files: GWD, Animate CC, GSAP preloaders) ---
  for (const { filePath, dir } of jsQueue) {
    let js;
    try { js = await fs.readFile(filePath, 'utf8'); } catch { continue; }
    for (const raw of extractJsRefs(js)) {
      await checkRef(raw, dir);
    }
  }

  return { missing, checked };
}
