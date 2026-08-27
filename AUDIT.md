# Security Review: riveBackupImageGenerator

## Scope

Full repository security audit; no application files modified.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_sha256_2f07c85f4ddea91f2b620c5ae4af615cec3647b04cd87b8077377f595b2ab8d5
- Revision: 3412ec518a078589d9ba4e1443aae2df579a2210
- Snapshot digest: codex-security-snapshot/v1:sha256:2282fac44839841b2690e8d3dec873321cecf67463c34f582371ed5f8bd80303
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: No hostile payloads executed.
- Artifacts reviewed: 88 repository files, package-lock.json and npm production dependency advisory output

Limitations and exclusions:
- No live deployed identity proxy or cloud network was available.
- Excluded .git/\*\*: version-control internals
- Excluded node_modules/\*\*: generated dependencies; lockfile audited separately
- Excluded src/public/\*.png: binary non-executable image assets
- Excluded node_modules/\*\*: Installed third-party source excluded; locked versions checked with npm audit.
- Excluded .git/\*\*: Current repository state only.
- Excluded src/public/\*.{png,jpg,jpeg,gif,ico}: Binary assets do not implement reviewed controls.
- Excluded node_modules/\*\*: Third-party installed source excluded; locked versions assessed separately.
- Excluded .git/\*\*: Current state only; history excluded.
- Excluded src/public/\*.{png,jpg,jpeg,gif,ico}: Binary visual assets are not security control implementations.

### Scan Summary

| Field | Value |
| --- | --- |
| Scan outcome | completed |
| Reportable findings | 21 |
| Severity mix | critical: 2, high: 12, medium: 7 |
| Confidence mix | high: 20, medium: 1 |
| Coverage | partial |
| Validation mode | static source review with route/configuration cross-checks |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Multi-tenant upload/capture service processes attacker-controlled active content and media with browser, filesystem, and subprocess capabilities.

### Assets

- tenant jobs
- host and internal network
- availability
- generated artifacts

### Trust Boundaries

- internet to nginx
- nginx identity to app
- uploads to processing tools
- app to filesystem

### Attacker Capabilities

- send requests and headers
- upload supported file types
- poll and retry jobs

### Security Objectives

- authenticate production requests
- authorize before side effects
- contain content
- bound resources

### Assumptions

- Internet clients can reach nginx.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Production authentication trusts attacker-controlled identity headers](#finding-1) | critical | high | inline below |
| [Reverse proxy forwards attacker-controlled identity headers](#finding-2) | critical | high | inline below |
| [Expensive processing lacks one global admission boundary](#finding-3) | high | high | inline below |
| [Video backup decoding can hang indefinitely and buffer unbounded output](#finding-4) | high | high | inline below |
| [ZIP limits occur after full decompression allocation](#finding-5) | high | high | inline below |
| [Equivalent mutation paths and validator subprocesses bypass global workload limits](#finding-6) | high | high | inline below |
| [Append upload writes into a job before ownership is checked](#finding-7) | high | high | inline below |
| [Uploaded creatives execute with unrestricted network access](#finding-8) | high | high | inline below |
| [Provided environment example disables authentication](#finding-9) | high | high | inline below |
| [Accepted dimensions permit near-100-megapixel captures](#finding-10) | high | high | inline below |
| [Video processing is insufficiently bounded](#finding-11) | high | high | inline below |
| [Creative dimensions allow near-100-megapixel browser and Sharp allocations](#finding-12) | high | high | inline below |
| [ZIP expansion occurs before decompressed-size limits](#finding-13) | high | high | inline below |
| [Uploaded creative HTML has unrestricted server-side network access](#finding-14) | high | high | inline below |
| [Optional tenant and client claims weaken isolation](#finding-15) | medium | high | inline below |
| [Rate limiting is incorrect for reverse-proxy deployment](#finding-16) | medium | high | inline below |
| [Tenant and client ownership checks are skipped when request claims are absent](#finding-17) | medium | medium | inline below |
| [Production proxy collapses all clients into one rate-limit bucket](#finding-18) | medium | high | inline below |
| [Append upload writes into another job namespace before authorization](#finding-19) | medium | high | inline below |
| [Abandoned validator uploads never become cleanup-eligible](#finding-20) | medium | high | inline below |
| [Uploaded validator jobs can persist indefinitely](#finding-21) | medium | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Production authentication trusts attacker-controlled identity headers

| Field | Value |
| --- | --- |
| Severity | critical |
| Confidence | high |
| Confidence rationale | The complete shipped proxy-to-adapter dataflow is present and no authenticating gateway or signature check exists. |
| Category | Authentication |
| CWE | CWE-287 |
| Affected lines | deploy/coolify/nginx.conf:29-32, src/auth/adapter.js:47-57, src/auth/middleware.js:17-32 |

#### Summary

The shipped nginx copies client-supplied X-Auth identity headers upstream and the production adapter accepts any non-empty user ID as authenticated.

#### Root Cause

Identity provenance is never authenticated; plain request headers are treated as verified principals.

#### Validation

Confirmed from nginx request-header forwarding through HeaderAuthAdapter and createAuthMiddleware; missing-header rejection does not prevent chosen-header impersonation.

#### Dataflow

Remote header -\> nginx $http_x_auth_\* -\> HeaderAuthAdapter -\> req.auth -\> ownership and job operations.

#### Reachability

Reachable by any client able to connect to the shipped nginx port.

#### Severity

**Critical** — A remote client can bypass authentication entirely, consume expensive rendering capacity, and impersonate owners when job IDs are known.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Authenticate at a real identity-aware gateway or verify signed tokens in-process; strip inbound identity headers, inject verified claims, and restrict the application listener to the trusted proxy.

<a id="finding-2"></a>

### [2] Reverse proxy forwards attacker-controlled identity headers

| Field | Value |
| --- | --- |
| Severity | critical |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-345 |
| Affected lines | deploy/coolify/nginx.conf:29 |

#### Summary

The shipped nginx configuration copies inbound x-auth-\* headers into the backend trust boundary. HeaderAuthAdapter treats those values as authenticated identity, so an unauthenticated client can choose user, tenant, and client identities and access or manipulate scoped jobs.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at deploy/coolify/nginx.conf:29, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Critical** — The shipped nginx configuration copies inbound x-auth-\* headers into the backend trust boundary. HeaderAuthAdapter treats those values as authenticated identity, so an unauthenticated client can choose user, tenant, and client identities and access or manipulate scoped jobs.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Strip all inbound identity headers and have an authenticated identity-aware proxy set them from a verified session/token. Bind the backend privately, validate a signed proxy assertion, and add end-to-end bypass tests.

<a id="finding-3"></a>

### [3] Expensive processing lacks one global admission boundary

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-400 |
| Affected lines | src/webServer.js:872 |

#### Summary

Legacy and validator workflows can start extraction, browser, Sharp, and media work without a bounded global queue. Per-capture limits do not cap all work across jobs.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/webServer.js:872, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Legacy and validator workflows can start extraction, browser, Sharp, and media work without a bounded global queue. Per-capture limits do not cap all work across jobs.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use one bounded durable queue with global and per-tenant quotas/backpressure; put every expensive workflow behind it.

<a id="finding-4"></a>

### [4] Video backup decoding can hang indefinitely and buffer unbounded output

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Unlike validator probes, these two spawn paths contain no timeout guard and their callers hold the semaphore until settlement. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-400, CWE-770 |
| Affected lines | src/captureVideo.js:32-60, src/captureVideo.js:149-175, src/webServer.js:278-287, src/webServer.js:352-480 |

#### Summary

The main backup path's ffprobe dimension query and ffmpeg last-frame extraction have no timeout or output caps, and stuck processing jobs are exempt from cleanup.

#### Root Cause

Not all native decoder calls share the existing timeout and output-budget control.

#### Validation

Confirmed two unguarded spawn paths, unbounded buffers, semaphore retention, and cleanup exclusion for processing jobs.

#### Dataflow

Uploaded video -\> processing semaphore -\> unguarded ffprobe/ffmpeg -\> unresolved promise/unbounded buffer.

#### Reachability

Any accepted uploader can start the backup path.

#### Severity

**High** — A small number of uploads can permanently consume every global processing permit and can exhaust heap with decoder output.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Apply an abortable wall-clock deadline to every subprocess, kill process groups, cap stdout/stderr/frame bytes, validate pixel count before Sharp, and enforce an outer file/job deadline that transitions state and cleans artifacts.

<a id="finding-5"></a>

### [5] ZIP limits occur after full decompression allocation

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Allocation order is explicit and npm audit identifies GHSA-xcpc-8h2w-3j85 in locked adm-zip 0.5.17. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-409, CWE-789 |
| Affected lines | src/extractZip.js:61-89, src/extractZip.js:137-174, package-lock.json:1 |

#### Summary

Normal extraction calls entry.getData before size checks, while container expansion has no uncompressed byte limit at all; the locked adm-zip version also has a verified high-severity allocation advisory.

#### Root Cause

Resource limits are checked after the dangerous allocation, and one expansion path omits byte limits.

#### Validation

Confirmed getData precedes data.length checks; npm audit on the locked dependency reported a crafted-ZIP 4GB allocation vulnerability.

#### Dataflow

Multipart compressed ZIP -\> AdmZip -\> getData full inflation -\> late length check or unbounded container write.

#### Reachability

All upload workflows accept ZIP input; the production auth bypass removes the intended privilege prerequisite.

#### Severity

**High** — Remote uploads can exhaust Node memory or disk before configured limits reject them.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Move to a maintained non-vulnerable archive library with streaming bounded extraction; validate declared sizes and compression ratio before inflation and enforce observed per-entry, aggregate, count, CPU, and wall-clock limits in ordinary and container ZIP paths.

<a id="finding-6"></a>

### [6] Equivalent mutation paths and validator subprocesses bypass global workload limits

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Route middleware differences and absence of validator admission control are explicit. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-400, CWE-799 |
| Affected lines | src/webServer.js:1281-1310, src/webServer.js:1323-1344, src/validator/validatorService.js:15-42 |

#### Summary

Legacy upload/process routes omit the rate limiter, and separately started validator jobs can launch ffmpeg/ffprobe without a cross-job concurrency queue.

#### Root Cause

Admission controls are attached to selected routes rather than the underlying expensive operations.

#### Validation

Confirmed legacy route omission and fire-and-forget validator jobs without a shared subprocess semaphore.

#### Dataflow

Spoofed/accepted identity -\> legacy mutations or many validator jobs -\> disk, browser, ffprobe, and ffmpeg work.

#### Reachability

Legacy routes remain mounted under /api and production header authentication is bypassable.

#### Severity

**High** — A remote client can bypass the intended mutation ceiling and create enough disk/native-process work to cause service-wide degradation or outage.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Remove legacy mutations or apply identical controls; introduce bounded global validator/capture queues plus per-user/tenant outstanding-job, stored-byte, request-byte, and queue-length quotas.

<a id="finding-7"></a>

### [7] Append upload writes into a job before ownership is checked

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-862 |
| Affected lines | src/webServer.js:1295 |

#### Summary

The append route invokes Multer with a destination derived from the URL job ID before the handler verifies requester ownership. A caller who knows a job ID can overwrite a same-named source or consume victim storage even when the handler later rejects access.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/webServer.js:1295, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — The append route invokes Multer with a destination derived from the URL job ID before the handler verifies requester ownership. A caller who knows a job ID can overwrite a same-named source or consume victim storage even when the handler later rejects access.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Authenticate and authorize before accepting multipart bytes. Stage under a randomized request directory with exclusive names, then move only after authorization and validation.

<a id="finding-8"></a>

### [8] Uploaded creatives execute with unrestricted network access

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-918 |
| Affected lines | src/browserPool.js:94 |

#### Summary

Attacker-supplied HTML is opened in Chromium while web security and site isolation are disabled. Creative JavaScript can request internal services or cloud metadata endpoints; there is no browser egress policy.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/browserPool.js:94, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Attacker-supplied HTML is opened in Chromium while web security and site isolation are disabled. Creative JavaScript can request internal services or cloud metadata endpoints; there is no browser egress policy.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Run capture workers in a network-isolated sandbox, block private/link-local/loopback destinations at browser routing and network layers, remove disable-web-security where possible, and test redirects and DNS rebinding.

<a id="finding-9"></a>

### [9] Provided environment example disables authentication

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-1188 |
| Affected lines | .env.example:13 |

#### Summary

The supplied .env.example combines NODE_ENV=production with AUTH_MODE=development and a known placeholder admin password. Preflight only warns, so a production start can proceed with all API routes open.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at .env.example:13, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — The supplied .env.example combines NODE_ENV=production with AUTH_MODE=development and a known placeholder admin password. Preflight only warns, so a production start can proceed with all API routes open.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Fail production startup when auth is disabled or credentials are placeholders. Separate local-development config from production examples and test deployed configuration.

<a id="finding-10"></a>

### [10] Accepted dimensions permit near-100-megapixel captures

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-770 |
| Affected lines | src/utils.js:103 |

#### Summary

Dimensions up to roughly 9999 by 9999 allow one capture and Sharp encode to consume very large memory and CPU.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/utils.js:103, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Dimensions up to roughly 9999 by 9999 allow one capture and Sharp encode to consume very large memory and CPU.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Enforce conservative width, height, and total-pixel limits before browser/Sharp work, plus concurrency-aware memory admission control.

<a id="finding-11"></a>

### [11] Video processing is insufficiently bounded

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-400 |
| Affected lines | src/captureVideo.js:184 |

#### Summary

Untrusted video input can drive ffprobe/ffmpeg CPU, memory, disk output, and runtime. Subprocess paths lack consistent hard bounds, and jobs left processing are exempt from cleanup.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/captureVideo.js:184, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Untrusted video input can drive ffprobe/ffmpeg CPU, memory, disk output, and runtime. Subprocess paths lack consistent hard bounds, and jobs left processing are exempt from cleanup.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use wall-clock timeouts with process-group termination, cap duration/dimensions/output, OS-limit media workers, and force timed-out jobs terminal.

<a id="finding-12"></a>

### [12] Creative dimensions allow near-100-megapixel browser and Sharp allocations

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Dimension sources, validation rule, and direct viewport/screenshot use are explicit. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-400, CWE-770 |
| Affected lines | src/utils.js:111-114, src/detectBannerSize.js:12-51, src/captureBackup.js:33-37, src/validator/checks/renderChecks.js:38-53 |

#### Summary

Attacker-controlled HTML or filenames may select dimensions up to 9999 by 9999 with no total-pixel budget.

#### Root Cause

Independent axis limits substitute for a safe total-pixel workload budget.

#### Validation

9999x9999 is accepted and used directly by both capture and validator screenshots.

#### Dataflow

Creative meta/canvas/div/filename -\> detectBannerSize -\> viewport/screenshot -\> Sharp.

#### Reachability

The uploader controls multiple accepted dimension sources.

#### Severity

**High** — One capture can require hundreds of megabytes before PNG and Sharp intermediates; concurrent captures can exhaust the process/container.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Enforce product-specific width, height, and total-pixel limits before browser context creation for every HTML, Rive, filename, and video source; configure native image decoder pixel limits.

<a id="finding-13"></a>

### [13] ZIP expansion occurs before decompressed-size limits

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-409 |
| Affected lines | src/utils.js:49 |

#### Summary

ZIP entry data is materialized before effective aggregate decompressed-byte limits are enforced. A small crafted archive can force large allocation or CPU usage; the locked adm-zip also has a high-severity allocation advisory.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/utils.js:49, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — ZIP entry data is materialized before effective aggregate decompressed-byte limits are enforced. A small crafted archive can force large allocation or CPU usage; the locked adm-zip also has a high-severity allocation advisory.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use streaming extraction; enforce entry count, per-entry and cumulative uncompressed sizes before allocation; reject suspicious ratios; resource-isolate extraction; upgrade after compatibility testing.

<a id="finding-14"></a>

### [14] Uploaded creative HTML has unrestricted server-side network access

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Execution of uploaded HTML and absence of destination controls are directly established; exact reachable internal services remain deployment-dependent. |
| Category | Server-side request forgery |
| CWE | CWE-918 |
| Affected lines | src/browserPool.js:91-95, src/captureBackup.js:33-38, src/validator/checks/renderChecks.js:35-53 |

#### Summary

Attacker-controlled HTML executes in Chromium with web security and site isolation disabled and without request interception or egress restrictions.

#### Root Cause

Untrusted active content receives ambient browser network authority with no outbound policy.

#### Validation

Confirmed both backup and validator render paths; static external-reference detection only reports literals and does not enforce runtime requests.

#### Dataflow

Uploaded ZIP HTML/JS -\> local/file navigation -\> fetch/XHR/WebSocket/subresource -\> internal network.

#### Reachability

Any accepted uploader can supply executable creative JavaScript.

#### Severity

**High** — The renderer can reach localhost, container services, private networks, and metadata endpoints from the service network position.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use an isolated renderer with deny-by-default network egress; block loopback, link-local, private, service-discovery, and metadata destinations on every request/redirect, and remove the web-security-disabling flags.

<a id="finding-15"></a>

### [15] Optional tenant and client claims weaken isolation

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-863 |
| Affected lines | src/auth.js:37 |

#### Summary

Ownership comparisons are conditional when tenant/client identifiers are absent. A deployment providing only user ID silently collapses tenant/client boundaries for that user.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/auth.js:37, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Ownership comparisons are conditional when tenant/client identifiers are absent. A deployment providing only user ID silently collapses tenant/client boundaries for that user.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Make production claims mandatory, reject incomplete identities, and centralize exact ownership checks before every side effect.

<a id="finding-16"></a>

### [16] Rate limiting is incorrect for reverse-proxy deployment

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-799 |
| Affected lines | src/webServer.js:1238 |

#### Summary

The in-memory limiter keys on req.ip without an explicit trusted-proxy model. Behind nginx clients share a bucket; naive proxy trust could enable forwarded-address spoofing. State is also per-process.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/webServer.js:1238, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — The in-memory limiter keys on req.ip without an explicit trusted-proxy model. Behind nginx clients share a bucket; naive proxy trust could enable forwarded-address spoofing. State is also per-process.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Trust an explicit proxy hop, normalize the verified client address, and use a shared rate-limit store with identity and tenant quotas.

<a id="finding-17"></a>

### [17] Tenant and client ownership checks are skipped when request claims are absent

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | The code path is certain, but exploitability depends on whether production user IDs are globally unique and whether gateways always provide tenant/client claims. |
| Category | Authorization |
| CWE | CWE-863 |
| Affected lines | src/auth/adapter.js:47-57, src/jobs/Job.js:89-95, src/validator/ValidatorJob.js:72-77 |

#### Summary

A job's tenant/client fields are compared only if the incoming identity also has those fields, while production requires only userId.

#### Root Cause

Optional missing request claims are treated as permission to skip a stored ownership dimension.

#### Validation

Confirmed both job models share this logic; deployment uniqueness guarantees are absent.

#### Dataflow

Authenticated principal with same userId but omitted tenant/client -\> skipped comparisons -\> owner-scoped operation.

#### Reachability

Requires a corrected trusted authentication layer that permits missing scope claims and user IDs reused across scopes.

#### Severity

**Medium** — After fixing header authenticity, a gateway omission can let the same non-globally-unique user ID cross tenant/client boundaries.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Define required identity claims per deployment and fail closed: if a stored job has tenant/client scope, require the corresponding authenticated request claims and exact matches.

<a id="finding-18"></a>

### [18] Production proxy collapses all clients into one rate-limit bucket

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The shipped topology and missing trust-proxy configuration are explicit. |
| Category | Availability control |
| CWE | CWE-400 |
| Affected lines | deploy/coolify/nginx.conf:20-27, src/webServer.js:1238-1256 |

#### Summary

nginx forwards client IP headers, but Express does not trust the proxy, so req.ip is the nginx peer for every external request.

#### Root Cause

The rate-limit key is derived without accounting for the supported reverse-proxy topology.

#### Validation

Confirmed no app.set('trust proxy') and all external connections originate from nginx at the application socket.

#### Dataflow

Remote client -\> nginx socket -\> common req.ip -\> common Map bucket -\> 429 for unrelated clients.

#### Reachability

Applies to the supplied compose/nginx deployment.

#### Severity

**Medium** — One user can reliably consume the shared 30-request mutation/login budget and deny service to all proxied users.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Trust only the known nginx hop/network, then use the validated client address with authenticated subject and tenant quotas in a bounded/shared limiter.

<a id="finding-19"></a>

### [19] Append upload writes into another job namespace before authorization

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Middleware order, destination construction, overwrite-capable disk storage, and late ownership check are explicit. |
| Category | Authorization |
| CWE | CWE-862 |
| Affected lines | src/webServer.js:247-271, src/webServer.js:706-715, src/webServer.js:1295-1304 |

#### Summary

Multer writes request files into the path selected by attacker-supplied jobId before handleAppendFiles checks ownership.

#### Root Cause

Filesystem mutation precedes object-level authorization.

#### Validation

Confirmed route order and diskStorage behavior; format validation prevents traversal but not cross-owner overwrite.

#### Dataflow

Known victim jobId -\> req.sessionId -\> multer destination -\> original filename write -\> ownership rejection cleanup.

#### Reachability

Requires a valid eight-hex job ID and an authenticated or spoofed identity that does not own it.

#### Severity

**Medium** — If a victim job ID is known, a colliding filename can overwrite and then delete the victim upload; the job-ID knowledge prerequisite lowers likelihood.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Authorize the target job before invoking multer, or stage uploads in a request-scoped directory and atomically move them after authorization using server-generated exclusive filenames.

<a id="finding-20"></a>

### [20] Abandoned validator uploads never become cleanup-eligible

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | State creation and terminal-only cleanup predicate are explicit. |
| Category | Resource lifecycle management |
| CWE | CWE-459, CWE-770 |
| Affected lines | src/webServer.js:164-174, src/webServer.js:278-320, src/webServer.js:770-825 |

#### Summary

Validator cleanup only removes complete/error jobs; uploaded jobs that are never validated persist indefinitely in memory and on disk.

#### Root Cause

TTL cleanup is conditional on terminal state rather than inactivity/age for all persisted uploads.

#### Validation

Confirmed validator uploads start as uploaded and terminal cleanup only recognizes complete or error.

#### Dataflow

Upload validator files -\> uploaded in-memory job -\> never start validation -\> cleanup predicate never matches.

#### Reachability

Any API caller can create and abandon validator uploads.

#### Severity

**Medium** — Repeated abandoned uploads can steadily exhaust storage and memory, although each request is bounded and v1 upload is rate limited.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Expire uploaded validator jobs by age, apply storage-level orphan pruning at startup and periodically, and enforce per-owner stored-byte/outstanding-job quotas.

<a id="finding-21"></a>

### [21] Uploaded validator jobs can persist indefinitely

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Direct source-to-sink static analysis with configuration and route wiring cross-check. |
| Category | security |
| CWE | CWE-459 |
| Affected lines | src/webServer.js:168 |

#### Summary

Validator uploads never started remain non-terminal, while cleanup selects only terminal jobs. Repeated abandoned jobs can consume disk indefinitely.

#### Validation

Direct source-to-sink static analysis with configuration and route wiring cross-check. Validation details were not recorded separately.

#### Dataflow

The canonical finding records the affected path at src/webServer.js:168, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Validator uploads never started remain non-terminal, while cleanup selects only terminal jobs. Repeated abandoned jobs can consume disk indefinitely.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Expire uploaded, failed, and stuck-processing states; persist leases/heartbeats; run startup and periodic cleanup with disk-watermark safeguards.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| HTTP authentication and authorization | not recorded | Reported | No additional canonical notes were recorded. |
| multipart upload and filesystem handling | not recorded | Reported | No additional canonical notes were recorded. |
| ZIP, Rive, HTML, image and video pipeline | not recorded | Reported | No additional canonical notes were recorded. |
| browser and subprocess isolation | not recorded | Reported | No additional canonical notes were recorded. |
| resource exhaustion, cleanup and rate limiting | not recorded | Reported | No additional canonical notes were recorded. |
| deployment, secrets and dependencies | not recorded | Reported | No additional canonical notes were recorded. |
| frontend, tests, logging and monitoring | not recorded | No issue found | No additional canonical notes were recorded. |
| Authentication and ownership | not recorded | Reported | Header authenticity bypass, pre-authorization append write, and fail-open optional ownership scopes validated. |
| Archive and file handling | not recorded | Reported | Late decompression limits and vulnerable locked adm-zip path validated; traversal controls rejected traversal hypotheses. |
| Browser rendering and network access | not recorded | Reported | Active-content SSRF and unbounded pixel workload validated. |
| Video/native processing | not recorded | Reported | Unguarded backup decoder calls and global validator admission gaps validated; shell command injection rejected. |
| API admission, retention, and rate limiting | not recorded | Reported | Legacy route bypass, abandoned validator retention, and proxy bucket collapse validated. |
| Frontend injection | not recorded | No issue found | Reviewed dynamic rendering escapes attacker-derived text or uses textContent; no exploitable DOM XSS validated. |
| Secrets and configuration | not recorded | No issue found | No hardcoded production credential material found; deployment identity configuration is reported separately. |
| Resource exhaustion and rate limiting | not recorded | Needs follow-up | Focused investigation pending. |

## Open Questions And Follow Up

- Tests and documentation coverage follow-up is still running.
  - Follow-up prompt: Review deferred unit remaining-file-coverage and close its stated proof gap. Paths: test, docs.
