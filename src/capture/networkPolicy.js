import net from 'node:net';
import { isBlockedHostname, isPublicAddress } from './publicEgressProxy.js';

const SAFE_SCHEMES = new Set(['data:', 'blob:', 'about:']);

export function isRequestAllowed(requestUrl, documentUrl, allowedHosts = [], allowedFileRoot = null, allowPublicNetwork = false) {
  let target;
  try {
    target = new URL(requestUrl);
  } catch {
    return false;
  }
  if (SAFE_SCHEMES.has(target.protocol)) return true;
  if (target.href === new URL(documentUrl).href) return true;
  if (target.protocol === 'file:') {
    if (new URL(documentUrl).protocol !== 'file:' || !allowedFileRoot) return false;
    const root = decodeURIComponent(new URL(allowedFileRoot).pathname).replace(/\/$/, '') + '/';
    const targetPath = decodeURIComponent(target.pathname);
    return targetPath.startsWith(root);
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol)) return false;

  const documentOrigin = new URL(documentUrl).origin;
  if (target.origin === documentOrigin) return true;
  if (allowedHosts.includes(target.hostname)) return true;
  if (!allowPublicNetwork) return false;
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(hostname);
  return family ? isPublicAddress(hostname, family) : !isBlockedHostname(hostname);
}

export async function installNetworkPolicy(context, documentUrl, allowedHosts = [], allowedFileRoot = null, allowPublicNetwork = false) {
  await context.route('**/*', route => {
    if (isRequestAllowed(route.request().url(), documentUrl, allowedHosts, allowedFileRoot, allowPublicNetwork)) return route.continue();
    return route.abort('blockedbyclient');
  });
}
