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
      () => document.querySelector('#progressText')?.textContent?.includes('All 1 file(s) failed'),
      { timeout: 10_000 }
    );

    const progressText = await page.locator('#progressText').textContent();
    const overlayClass = await page.locator('#overlay').getAttribute('class');
    const badgeText = await page.locator('.state-badge').textContent();

    assert.strictEqual(progressText, 'All 1 file(s) failed');
    assert.strictEqual(overlayClass, 'overlay');
    assert.match(badgeText, /failed/);

    await page.close();
  });
});
