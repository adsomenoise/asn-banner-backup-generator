import crypto from 'crypto';

const SESSION_COOKIE = 'bbg_session';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSessionToken(identity, secret, options = {}) {
  if (!secret) throw new Error('A session secret is required');
  const payload = encode(JSON.stringify({
    userId: identity.userId,
    tenantId: identity.tenantId,
    clientId: identity.clientId,
    expiresAt: Date.now() + (options.ttlMs || SESSION_TTL_MS)
  }));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [payload, suppliedSignature, extra] = String(token).split('.');
  if (!payload || !suppliedSignature || extra || !safeEqual(suppliedSignature, signature(payload, secret))) return null;
  try {
    const identity = JSON.parse(decode(payload));
    if (!identity.userId || !identity.tenantId || !identity.clientId) return null;
    if (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= now) return null;
    return {
      userId: String(identity.userId),
      tenantId: String(identity.tenantId),
      clientId: String(identity.clientId)
    };
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

export class SessionAuthAdapter {
  constructor(options = {}) {
    this.secret = options.secret;
    this.cookieName = options.cookieName || SESSION_COOKIE;
  }

  extract(req) {
    const cookies = parseCookies(req.headers.cookie);
    return verifySessionToken(cookies[this.cookieName], this.secret);
  }
}

export { SESSION_COOKIE, SESSION_TTL_MS };

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
