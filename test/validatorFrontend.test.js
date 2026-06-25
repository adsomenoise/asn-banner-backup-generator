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
      () => document.querySelector('#validatorReport')?.textContent?.includes('Missing HTML entry'),
      { timeout: 10_000 }
    );

    assert.match(await page.locator('#validatorStatusText').textContent(), /Validation complete/);
    assert.strictEqual(await page.locator('#validatorProgressBar').getAttribute('aria-valuenow'), '100');
    assert.match(await page.locator('#validatorReport').textContent(), /The ZIP must contain at least one \.html file/);
    assert.match(await page.locator('#validatorReport').textContent(), /Add a root or shallow HTML entry point/);

    await page.close();
  });
});
