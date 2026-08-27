import { DevAuthAdapter, HeaderAuthAdapter, SessionAuthAdapter } from './adapter.js';

const DEV_FALLBACK = { userId: 'dev-user', tenantId: 'dev-tenant', clientId: 'dev-client' };

export function createAuthMiddleware(options = {}) {
  const mode = options.mode || 'development';

  let adapter;
  if (options.adapter) {
    adapter = options.adapter;
  } else if (mode === 'production') {
    adapter = new SessionAuthAdapter(options.session || {});
  } else if (mode === 'trusted-proxy') {
    adapter = new HeaderAuthAdapter(options.headers || {});
  } else {
    adapter = new DevAuthAdapter(options.dev || {});
  }

  return function authMiddleware(req, res, next) {
    const identity = adapter.extract(req);

    if (!identity || !identity.userId) {
      if (mode !== 'development') {
        return res.status(401).json({
          error: 'Missing authentication credentials',
          code: 'UNAUTHORIZED'
        });
      }
      req.auth = { ...DEV_FALLBACK };
      return next();
    }

    req.auth = identity;
    next();
  };
}
