import dns from 'node:dns/promises';
import http from 'node:http';
import net, { BlockList } from 'node:net';

const LOOKUP_TIMEOUT_MS = 5000;
const SOCKET_TIMEOUT_MS = 15000;
const blockedAddresses = new BlockList();

const blockedIpv4Subnets = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
];

for (const [network, prefix] of blockedIpv4Subnets) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
  blockedAddresses.addSubnet(`::ffff:${network}`, prefix + 96, 'ipv6');
}

for (const [network, prefix] of [
  ['::', 96], ['100::', 64], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001::', 23], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28],
  ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20], ['5f00::', 16]
]) blockedAddresses.addSubnet(network, prefix, 'ipv6');

const blockedHostSuffixes = ['.localhost', '.local', '.internal', '.home', '.lan'];

function normalizeHostname(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export function isPublicAddress(address, family = net.isIP(address)) {
  if (family === 4 || family === 'IPv4') return !blockedAddresses.check(address, 'ipv4');
  if (family === 6 || family === 'IPv6') return !blockedAddresses.check(address, 'ipv6');
  return false;
}

export function isBlockedHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === 'metadata.google.internal' ||
    blockedHostSuffixes.some(suffix => normalized.endsWith(suffix));
}

export async function resolvePublicHost(hostname, options = {}) {
  const normalized = normalizeHostname(hostname);
  if (!normalized || isBlockedHostname(normalized)) throw new Error('Destination host is not public');

  const literalFamily = net.isIP(normalized);
  if (literalFamily) {
    if (!isPublicAddress(normalized, literalFamily)) throw new Error('Destination address is not public');
    return { address: normalized, family: literalFamily };
  }

  const lookup = options.lookup || dns.lookup;
  const timeoutMs = options.timeoutMs || LOOKUP_TIMEOUT_MS;
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Destination DNS lookup timed out')), timeoutMs);
  });
  let answers;
  try {
    answers = await Promise.race([lookup(normalized, { all: true, verbatim: true }), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
  if (!answers.length || answers.some(answer => !isPublicAddress(answer.address, answer.family))) {
    throw new Error('Destination DNS includes a non-public address');
  }
  return answers[0];
}

function validateTargetUrl(rawUrl, protocols = ['http:', 'https:']) {
  const target = new URL(rawUrl);
  if (!protocols.includes(target.protocol)) throw new Error('Unsupported destination protocol');
  if (target.username || target.password) throw new Error('Destination credentials are not allowed');
  return target;
}

async function proxyWebSocket(req, clientSocket, head) {
  try {
    const target = validateTargetUrl(req.url, ['http:', 'ws:']);
    const destination = await resolvePublicHost(target.hostname);
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    const upstreamRequest = http.request({
      hostname: target.hostname, port: target.port || 80,
      path: `${target.pathname}${target.search}`, method: req.method, headers,
      lookup: pinnedLookup(destination), timeout: SOCKET_TIMEOUT_MS
    });
    upstreamRequest.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      const responseHeaders = [];
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        responseHeaders.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
      }
      clientSocket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${responseHeaders.join('\r\n')}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) clientSocket.write(upstreamHead);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamRequest.on('response', response => {
      clientSocket.end(`HTTP/1.1 ${response.statusCode || 502} Upgrade Failed\r\nConnection: close\r\n\r\n`);
    });
    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('Upstream request timed out')));
    upstreamRequest.on('error', () => clientSocket.destroy());
    upstreamRequest.end();
  } catch {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
}

function pinnedLookup(destination) {
  return (_hostname, options, callback) => {
    if (options?.all) return callback(null, [destination]);
    callback(null, destination.address, destination.family);
  };
}

async function proxyHttpRequest(req, res) {
  try {
    const target = validateTargetUrl(req.url);
    if (target.protocol !== 'http:') throw new Error('HTTPS must use CONNECT');
    const destination = await resolvePublicHost(target.hostname);
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];

    const upstream = http.request({
      protocol: 'http:', hostname: target.hostname, port: target.port || 80,
      path: `${target.pathname}${target.search}`, method: req.method, headers,
      lookup: pinnedLookup(destination), timeout: SOCKET_TIMEOUT_MS
    }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream request timed out')));
    upstream.on('error', error => {
      if (!res.headersSent) res.writeHead(502);
      res.end(`Blocked or unavailable external resource: ${error.message}`);
    });
    req.pipe(upstream);
  } catch (error) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end(`Blocked external resource: ${error.message}`);
  }
}

async function proxyConnect(req, clientSocket, head) {
  try {
    const target = validateTargetUrl(`https://${req.url}`);
    const destination = await resolvePublicHost(target.hostname);
    const upstream = net.connect({ host: destination.address, port: Number(target.port || 443), family: destination.family });
    upstream.setTimeout(SOCKET_TIMEOUT_MS, () => upstream.destroy(new Error('Upstream connection timed out')));
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.once('error', () => clientSocket.destroy());
  } catch {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
}

let proxyServer = null;
let proxyStart = null;

export async function getPublicEgressProxyUrl() {
  if (proxyServer?.listening) return `http://127.0.0.1:${proxyServer.address().port}`;
  if (proxyStart) return proxyStart;
  proxyStart = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => void proxyHttpRequest(req, res));
    server.on('connect', (req, socket, head) => void proxyConnect(req, socket, head));
    server.on('upgrade', (req, socket, head) => void proxyWebSocket(req, socket, head));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      proxyServer = server;
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  }).finally(() => { proxyStart = null; });
  return proxyStart;
}

export async function closePublicEgressProxy() {
  if (!proxyServer) return;
  const server = proxyServer;
  proxyServer = null;
  await new Promise(resolve => server.close(resolve));
}
