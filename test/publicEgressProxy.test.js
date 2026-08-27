import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isBlockedHostname, isPublicAddress, resolvePublicHost } from '../src/capture/publicEgressProxy.js';
import { isRequestAllowed } from '../src/capture/networkPolicy.js';

describe('public renderer egress policy', () => {
  it('allows globally routable IPv4 and IPv6 addresses', () => {
    assert.strictEqual(isPublicAddress('8.8.8.8'), true);
    assert.strictEqual(isPublicAddress('2606:4700:4700::1111'), true);
  });

  it('blocks private, local, metadata, reserved, and mapped address ranges', () => {
    for (const address of [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
      '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1',
      '::', '::1', '64:ff9b:1::1', 'fc00::1', 'fe80::1', 'ff00::1',
      '2001:db8::1', '2002:7f00:1::1', '::ffff:7f00:1'
    ]) assert.strictEqual(isPublicAddress(address), false, address);
  });

  it('blocks internal hostname conventions', () => {
    for (const hostname of [
      'localhost', 'app.localhost', 'printer.local', 'service.internal',
      'router.home', 'device.lan', 'metadata.google.internal'
    ]) assert.strictEqual(isBlockedHostname(hostname), true, hostname);
    assert.strictEqual(isBlockedHostname('code.createjs.com'), false);
  });

  it('accepts only DNS names whose complete answer set is public', async () => {
    const allPublic = await resolvePublicHost('cdn.example', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
      ]
    });
    assert.strictEqual(allPublic.address, '93.184.216.34');

    await assert.rejects(() => resolvePublicHost('mixed.example', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.4', family: 4 }
      ]
    }), /non-public/);
    await assert.rejects(() => resolvePublicHost('metadata.google.internal'), /not public/);
  });

  it('lets creatives request public web URLs but rejects local literals before proxying', () => {
    const documentUrl = 'http://127.0.0.1:3002/job/index.html';
    assert.strictEqual(isRequestAllowed('https://code.createjs.com/runtime.js', documentUrl, [], null, true), true);
    assert.strictEqual(isRequestAllowed('wss://events.example.com/creative', documentUrl, [], null, true), true);
    assert.strictEqual(isRequestAllowed('https://8.8.8.8/resource.js', documentUrl, [], null, true), true);
    assert.strictEqual(isRequestAllowed('http://127.0.0.1:8080/admin', documentUrl, [], null, true), false);
    assert.strictEqual(isRequestAllowed('http://169.254.169.254/latest/meta-data', documentUrl, [], null, true), false);
  });
});
