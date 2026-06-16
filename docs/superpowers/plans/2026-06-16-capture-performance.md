# Capture Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse Playwright browser processes, make capture concurrency configurable, and document a fast creative backup contract.

**Architecture:** Add a focused browser-pool module used by `captureBackup()`. Keep per-capture isolation by creating a fresh browser context/page for every capture while reusing the underlying Chromium worker. Parse `CAPTURE_CONCURRENCY` once in `webServer.js` and expose the `?backup=1` / `window.generateBackupFrame()` contract through tests and docs.

**Tech Stack:** Node.js ESM, Playwright Chromium, node:test, Express.

---

### Task 1: Browser Pool

**Files:**
- Create: `src/browserPool.js`
- Modify: `src/captureBackup.js`
- Test: `test/browserPool.test.js`

- [ ] Write failing tests proving browsers are reused and released.
- [ ] Implement `BrowserPool`, `getBrowserPool()`, and `closeBrowserPool()`.
- [ ] Update `captureBackup()` to acquire a browser from the pool and close only the context.
- [ ] Run `node --test test/browserPool.test.js test/captureBackup.test.js`.

### Task 2: Configurable Capture Concurrency

**Files:**
- Modify: `src/webServer.js`
- Test: `test/concurrencyConfig.test.js`

- [ ] Write failing tests for env parsing defaults, valid values, invalid values, and upper bound.
- [ ] Replace hard-coded `MAX_CONCURRENT = 3` with parsed `CAPTURE_CONCURRENCY`.
- [ ] Run `node --test test/concurrencyConfig.test.js`.

### Task 3: Fast Backup Contract

**Files:**
- Modify: `src/captureBackup.js`
- Create: `docs/creative-backup-contract.md`
- Test: `test/captureBackup.test.js`

- [ ] Write failing test with an HTML creative exposing `window.generateBackupFrame()`.
- [ ] Ensure the capture path loads with `?backup=1`, calls `generateBackupFrame()`, waits for `window.__backupReady`, and reports the fast strategy instead of fallback.
- [ ] Document `?backup=1`, `window.__backupReady`, and `window.generateBackupFrame()`.
- [ ] Run `npm test`.
