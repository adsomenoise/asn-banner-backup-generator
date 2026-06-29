import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import AdmZip from 'adm-zip';
import { startWebServer } from '../src/webServer.js';

function zipWithoutHtml() {
  const zip = new AdmZip();
  zip.addFile('asset.txt', Buffer.from('not an html creative'));
  return zip.toBuffer();
}

describe('Frontend processing UI', () => {
  let server;
  let baseUrl;
  let browser;

  before(async () => {
    server = await startWebServer(0);
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('updates polling state for digit-prefixed file IDs instead of staying on Starting', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await page.setInputFiles('#fileInput', {
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: zipWithoutHtml()
    });

    await page.waitForSelector('.file-item');
    await page.click('#processBtn');

    await page.waitForFunction(
      () => document.querySelector('#progressText')?.textContent?.includes('Complete. 0 files succeeded, 1 failed.'),
      { timeout: 10_000 }
    );

    const progressText = await page.locator('#progressText').textContent();
    const overlayClass = await page.locator('#overlay').getAttribute('class');
    const badgeText = await page.locator('.state-badge').textContent();
    const focusedElementId = await page.evaluate(() => document.activeElement.id);

    assert.strictEqual(progressText, 'Complete. 0 files succeeded, 1 failed.');
    assert.strictEqual(overlayClass, 'overlay');
    assert.match(badgeText, /failed/);
    assert.match(focusedElementId, /^(retryBtn|resetBtn)$/);

    await page.close();
  });

  it('exposes progress and per-file status updates to assistive technology', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await page.setInputFiles('#fileInput', {
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: zipWithoutHtml()
    });

    await page.waitForSelector('.file-item');

    const overallProgress = page.locator('#progressBar');
    const overlayProgress = page.locator('#overlayProgressBar');
    assert.strictEqual(await overallProgress.getAttribute('role'), 'progressbar');
    assert.strictEqual(await overallProgress.getAttribute('aria-label'), 'Overall processing progress');
    assert.strictEqual(await overallProgress.getAttribute('aria-valuemin'), '0');
    assert.strictEqual(await overallProgress.getAttribute('aria-valuemax'), '100');
    assert.strictEqual(await overallProgress.getAttribute('aria-valuenow'), '0');
    assert.strictEqual(await overlayProgress.getAttribute('role'), 'progressbar');
    assert.strictEqual(await overlayProgress.getAttribute('aria-label'), 'Processing dialog progress');

    assert.match(
      await page.locator('.file-item').getAttribute('aria-label'),
      /^broken\.zip, ZIP file, \d+ B, uploaded$/
    );
    assert.strictEqual(
      await page.locator('#progressText').textContent(),
      '1 file ready. Review file status, then generate backups.'
    );

    await page.click('#processBtn');
    await page.waitForFunction(
      () => document.querySelector('#progressText')?.textContent?.includes('Complete. 0 files succeeded, 1 failed.'),
      { timeout: 10_000 }
    );

    assert.strictEqual(await overallProgress.getAttribute('aria-valuenow'), '100');
    assert.strictEqual(await overlayProgress.getAttribute('aria-valuenow'), '100');

    const fileSummary = await page.locator('.file-item').getAttribute('aria-label');
    assert.match(fileSummary, /^broken\.zip, ZIP file, \d+ B, failed:/);
    assert.match(fileSummary, /The ZIP must contain at least one \.html file/);

    await page.close();
  });

  it('persists login for 14 days and clears expired auth', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    const persisted = await page.evaluate(() => {
      const before = Date.now();
      window.setAuth({ userId: 'alice', tenantId: 'acme', clientId: 'brand' });
      const after = Date.now();
      return {
        before,
        after,
        raw: localStorage.getItem('bbg_auth'),
        auth: window.getAuth()
      };
    });

    const payload = JSON.parse(persisted.raw);
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    assert.deepStrictEqual(persisted.auth, { userId: 'alice', tenantId: 'acme', clientId: 'brand' });
    assert.deepStrictEqual(payload.identity, { userId: 'alice', tenantId: 'acme', clientId: 'brand' });
    assert.ok(payload.expiresAt >= persisted.before + fourteenDaysMs);
    assert.ok(payload.expiresAt <= persisted.after + fourteenDaysMs);

    const expired = await page.evaluate(() => {
      localStorage.setItem('bbg_auth', JSON.stringify({
        identity: { userId: 'expired', tenantId: 'old', clientId: 'old' },
        expiresAt: Date.now() - 1
      }));
      return {
        auth: window.getAuth(),
        raw: localStorage.getItem('bbg_auth')
      };
    });

    assert.strictEqual(expired.auth, null);
    assert.strictEqual(expired.raw, null);

    await page.close();
  });

  it('moves focus into the login dialog, traps focus, and restores it when closed', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await page.focus('#dropZone');
    await page.evaluate(() => window.showLoginDialog());

    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'loginUsername');
    assert.strictEqual(await page.locator('.logo').getAttribute('inert'), '');
    assert.strictEqual(await page.locator('#dropZone').getAttribute('inert'), '');

    await page.keyboard.press('Shift+Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'loginBtn');

    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'loginUsername');

    await page.evaluate(() => window.closeLoginDialog());
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'dropZone');
    assert.strictEqual(await page.locator('.logo').getAttribute('inert'), null);
    assert.strictEqual(await page.locator('#dropZone').getAttribute('inert'), null);

    await page.close();
  });

  it('moves focus into the processing dialog, traps focus, and restores it when closed', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await page.focus('#dropZone');
    await page.evaluate(() => window.showProcessingDialog());

    // cancelBtn is the first (and only) focusable element — receives initial focus
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'cancelBtn');
    assert.strictEqual(await page.locator('.container').getAttribute('inert'), '');

    // Tab wraps within the single focusable element
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'cancelBtn');

    await page.keyboard.press('Shift+Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'cancelBtn');

    await page.evaluate(() => window.closeProcessingDialog());
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'dropZone');
    assert.strictEqual(await page.locator('.container').getAttribute('inert'), null);

    await page.close();
  });
});
