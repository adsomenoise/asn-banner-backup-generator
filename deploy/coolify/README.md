Quick deploy notes for Coolify / Docker Compose

Files added:
- deploy/coolify/nginx.conf  — nginx reverse-proxy that injects auth headers and allows large uploads
- deploy/coolify/docker-compose.yml — example compose bringing up `app` + `nginx`

Usage notes

1) Deploy via Coolify (Docker Compose):
   - In Coolify choose to deploy a project with `docker-compose.yml` and point it at `deploy/coolify/docker-compose.yml` (or copy its contents into Coolify's compose UI).
   - Ensure the `app` service has a persistent volume mounted to `/app/temp` (the compose file maps `../../temp` from repo for local testing).

2) Environment variables (set in Coolify UI) — minimal required:
   - NODE_ENV=production
   - PORT=3001
   - CORS_ORIGIN=https://bbg.bannerama.be
   - AUTH_MODE=production
   - AUTH_USER_ID_HEADER=x-auth-user-id
   - AUTH_TENANT_ID_HEADER=x-auth-tenant-id
   - AUTH_CLIENT_ID_HEADER=x-auth-client-id
   - RATE_LIMIT_MAX=30
   - CAPTURE_CONCURRENCY=2
   - LOG_LEVEL=info
   - LOG_FORMAT=json

3) How the auth headers work

- The app expects the proxy (nginx or your auth gateway) to set the identity headers the app reads.
- The supplied `nginx.conf` maps incoming request headers named `X-Auth-User-Id`, `X-Auth-Tenant-Id`, `X-Auth-Client-Id` through to the app.
- If your auth gateway uses different header names (for example `X-Forwarded-User`), update either `AUTH_*` env vars in the app to match, or change the `proxy_set_header` lines in `nginx.conf` to map the gateway headers to the app headers.

4) Important production notes

- Persist `/app/temp` to durable storage (Coolify mounts or volumes). Losing this folder will drop in-progress or completed results.
- For horizontal scaling, replace `InMemoryJobStore` with a Redis or DB-backed `JobStore`.
- Start conservatively: `CAPTURE_CONCURRENCY=2`; increase after observing CPU/memory.
- Ensure Playwright browsers and chromium deps are present (the Dockerfile in repo already installs them and includes `npm run postinstall`).

If you want, I can:
- Add a ready-to-run `coolify.yml` if you prefer Coolify's app manifest format, or
- Update `nginx.conf` to support JWT introspection / `auth_request` for automatic header injection.
