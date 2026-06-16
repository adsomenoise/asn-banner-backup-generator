export class AuthError extends Error {
  constructor(message, code = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = 401;
    this.code = code;
  }
}

export class ForbiddenError extends Error {
  constructor(message, code = 'FORBIDDEN') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
    this.code = code;
  }
}

export class DevAuthAdapter {
  constructor(options = {}) {
    const d = options.defaultUser || {};
    this.defaultUser = {
      userId: d.userId || 'dev-user',
      tenantId: d.tenantId || 'dev-tenant',
      clientId: d.clientId || 'dev-client'
    };
  }

  extract(req) {
    const userId = req.headers['x-user-id'] || this.defaultUser.userId;
    const tenantId = req.headers['x-tenant-id'] || this.defaultUser.tenantId;
    const clientId = req.headers['x-client-id'] || this.defaultUser.clientId;
    return { userId, tenantId, clientId };
  }
}

export class HeaderAuthAdapter {
  constructor(options = {}) {
    this.headerNames = {
      userId: (options.headers && options.headers.userId) || 'x-user-id',
      tenantId: (options.headers && options.headers.tenantId) || 'x-tenant-id',
      clientId: (options.headers && options.headers.clientId) || 'x-client-id'
    };
    this.required = options.required !== false;
  }

  extract(req) {
    const userId = req.headers[this.headerNames.userId] || null;
    const tenantId = req.headers[this.headerNames.tenantId] || null;
    const clientId = req.headers[this.headerNames.clientId] || null;

    if (this.required && !userId) {
      return null;
    }

    return { userId, tenantId, clientId };
  }
}
