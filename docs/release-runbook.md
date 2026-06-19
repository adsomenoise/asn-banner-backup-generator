# Production Release Runbook

## 1. Release Prerequisites

- Branch is merged into main.
- CI is green (lint + tests).
- Deployment environment variables are configured from .env.example.
- Browser dependencies for Playwright Chromium are available in the runtime image.

## 2. Release Gates

Run these checks locally before deploy:

```bash
npm ci
npm run lint
npm test
NODE_ENV=production \
AUTH_MODE=production \
CORS_ORIGIN=https://your-frontend.example.com \
AUTH_USER_ID_HEADER=x-auth-user-id \
AUTH_TENANT_ID_HEADER=x-auth-tenant-id \
AUTH_CLIENT_ID_HEADER=x-auth-client-id \
RATE_LIMIT_MAX=30 \
CAPTURE_CONCURRENCY=3 \
npm run preflight
```

## 3. Deploy Steps

1. Build and publish deployment artifact/container.
2. Inject production env variables.
3. Run startup command:

```bash
NODE_ENV=production npm run serve:prod
```

4. Verify service health:

```bash
curl -sS http://<host>:<port>/api/v1/health
```

## 4. Post-Deploy Validation

- Check /api/v1/health returns status ok.
- Upload a known-good ZIP test asset and process end-to-end.
- Confirm download archive includes expected JPG output.
- Confirm logs show JSON format in production and no repeated errors.

## 5. Rollback Plan

1. Roll back to previous artifact/container revision.
2. Re-apply previous known-good environment variable set.
3. Verify /api/v1/health.
4. Re-run smoke upload/process/download test.

## 6. Incident Notes

Capture the following for any production issue:

- Release version / git SHA.
- Time window and impacted endpoints.
- Relevant logs and request IDs.
- Whether issue was auth, upload validation, rendering/capture, or packaging.
