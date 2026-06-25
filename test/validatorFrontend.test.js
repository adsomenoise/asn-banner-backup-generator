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

describe('Validator frontend UI', () => {
  let server;
  let baseUrl;
  let browser;

  before(async () => {
    server = await startWebServer(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('validates ads in a separate mode and renders accessible findings', async () => {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    assert.strictEqual(await page.locator('#modeSwitch').isVisible(), true);
    await page.click('#validatorModeBtn');
    await page.selectOption('#validatorPreset', 'generic');
    await page.setInputFiles('#validatorFileInput', {
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: zipWithoutHtml()
    });

    await page.waitForSelector('.validator-file-item');
    assert.strictEqual(await page.locator('#validatorProgressBar').getAttribute('role'), 'progressbar');
    assert.strictEqual(
      await page.locator('.validator-file-item').getAttribute('aria-label'),
      'broken.zip, ZIP file, pending'
    );

    await page.click('#validateBtn');
    await page.waitForFunction(
      () => document.querySelector('#validatorReport')?.textContent?.includes('HTML entry'),
      { timeout: 10_000 }
    );

    assert.match(await page.locator('#validatorStatusText').textContent(), /Validation complete/);
    assert.strictEqual(await page.locator('#validatorProgressBar').getAttribute('aria-valuenow'), '100');
    assert.match(await page.locator('#validatorReport').textContent(), /The ZIP must contain at least one \.html file/);
    assert.match(await page.locator('#validatorReport').textContent(), /Add a root or shallow HTML entry point/);
    assert.ok(await page.locator('.check-row').count() >= 8);

    const checkRows = await page.locator('.check-row').evaluateAll(rows => rows.map(row => ({
      status: row.querySelector('.check-status')?.textContent?.trim(),
      text: row.textContent
    })));

    assert.ok(checkRows.some(row => row.status === 'pass' && row.text.includes('Package size')));
    assert.ok(checkRows.some(row => row.status === 'pass' && row.text.includes('ZIP extraction')));
    assert.ok(checkRows.some(row => row.status === 'warning' && row.text.includes('Allowed file types')));
    assert.ok(checkRows.some(row => row.status === 'fail' && row.text.includes('HTML entry')));
    assert.ok(checkRows.some(row => row.text.includes('Remove unsupported files or choose a preset')));

    await page.close();
  });

  it('hides validator mode controls on non-localhost domains', async () => {
    const page = await browser.newPage();
    const local = new URL(baseUrl);
    await page.route('**/*', route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.hostname !== 'production.example') {
        return route.continue();
      }
      return route.fetch({
        url: `${baseUrl}${requestUrl.pathname}${requestUrl.search}`,
        headers: {
          ...route.request().headers(),
          host: local.host
        }
      }).then(response => route.fulfill({ response }));
    });

    await page.goto(`http://production.example:${local.port}/`, { waitUntil: 'domcontentloaded' });

    assert.strictEqual(await page.evaluate(() => window.isLocalhost()), false);
    assert.strictEqual(await page.locator('#modeSwitch').isVisible(), false);
    assert.strictEqual(await page.locator('#backupPanel').isVisible(), true);
    assert.strictEqual(await page.locator('#validatorPanel').isVisible(), false);

    await page.close();
  });

  it('shows a clear error when validator upload returns HTML instead of JSON', async () => {
    const page = await browser.newPage();
    await page.route('**/api/v1/validator/jobs', route => {
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<!DOCTYPE html><title>Not found</title>'
      });
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await page.click('#validatorModeBtn');
    await page.setInputFiles('#validatorFileInput', {
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: zipWithoutHtml()
    });

    await page.waitForFunction(
      () => document.querySelector('#validatorStatusText')?.textContent === 'Upload failed.'
    );

    const toastText = await page.locator('.toast').textContent();
    assert.match(toastText, /server returned HTML instead of validator API JSON/);
    assert.doesNotMatch(toastText, /Unexpected token/);

    await page.close();
  });
});
