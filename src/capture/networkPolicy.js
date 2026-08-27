const SAFE_SCHEMES = new Set(['data:', 'blob:', 'about:']);

export function isRequestAllowed(requestUrl, documentUrl, allowedHosts = [], allowedFileRoot = null) {
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
  if (!['http:', 'https:'].includes(target.protocol)) return false;

  const documentOrigin = new URL(documentUrl).origin;
  if (target.origin === documentOrigin) return true;
  return allowedHosts.includes(target.hostname);
}

export async function installNetworkPolicy(context, documentUrl, allowedHosts = [], allowedFileRoot = null) {
  await context.route('**/*', route => {
    if (isRequestAllowed(route.request().url(), documentUrl, allowedHosts, allowedFileRoot)) return route.continue();
    return route.abort('blockedbyclient');
  });
}
