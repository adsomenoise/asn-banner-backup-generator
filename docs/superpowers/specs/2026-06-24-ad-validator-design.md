# Preset-Driven Ad Validator Design

## Goal

Add an ad validator as a separate top-level capability alongside backup-image generation. The validator should inspect uploaded ad files, run configurable validation presets, and return an actionable report without generating backup JPGs or changing the existing backup workflow.

The first version should support:

- HTML5 display ad ZIP validation for CM360/DV360-style delivery.
- Platform-specific presets for CM360/DV360, Google Ads, and Amazon Ads.
- A generic QA preset that gives useful creative-health checks without claiming platform compliance.
- Rive and video validation paths.

## User Experience

The web UI gets two top-level modes:

- Generate Backups
- Validate Ads

Validate Ads uses its own upload area, file list, preset selector, validation action, progress/status region, and report output. It should not reuse backup-generation button labels or imply that output JPGs will be created.

The default preset is `Generic QA`. Users can choose one preset before validating. A later version may add “Run all relevant presets,” but the first version should keep one selected preset per validation run to avoid noisy cross-platform findings.

After validation completes, the report shows:

- Overall status: `pass`, `warning`, or `fail`.
- Per-file status and finding counts.
- Findings grouped by severity: `error`, `warning`, `info`.
- Detected metadata where available: file type, file size, dimensions, HTML entry, asset counts/list summary, duration for video.
- Suggested fixes for common findings.

## Architecture

Add a validator subsystem rather than folding validation into backup jobs.

Proposed modules:

- `src/validator/presets.js`: preset definitions and limits.
- `src/validator/validateAd.js`: orchestration for one uploaded file and selected preset.
- `src/validator/checks/*.js`: focused check modules for ZIP, HTML, renderability, Rive, video, and platform rules.
- `src/validator/ValidatorJob.js`: validator-specific job and file report model. Do not extend the backup-generation `Job` model for validator reports.
- `src/validator/ValidatorStore.js`: in-memory store following the existing `JobStore` pattern.

Reuse existing helpers where they are already well bounded:

- ZIP safety and extraction behavior from `extractZip`.
- HTML entry discovery from `findBannerEntry`.
- Dimension detection from `detectBannerSize`.
- Rive dimension parsing and generated wrapper viability from `riveTemplate`.
- Video probing/capture helpers from `captureVideo`.
- Playwright browser/capture infrastructure only for renderability smoke checks, not full backup generation.

## API

Add validator routes under `/api/v1/validator`:

- `POST /api/v1/validator/jobs`
  - Upload files and create a validator job.
  - Accepts `.zip`, `.riv`, and supported video files.
  - Returns job metadata and uploaded file records.

- `POST /api/v1/validator/jobs/{jobId}/validate`
  - Body: `{ "preset": "generic" }`.
  - Starts validation asynchronously and returns the current job state.

- `GET /api/v1/validator/jobs/{jobId}`
  - Returns job status, selected preset, progress, file reports, findings, and detected metadata.

A later `GET /api/v1/validator/jobs/{jobId}/report` endpoint can export JSON or HTML, but report export is not required for the first version.

Validator endpoints should use the same auth, rate limiting, ownership, upload limits, and cleanup assumptions as backup jobs.

## Presets

Preset definitions should be data-first so limits can be updated without rewriting validation orchestration.

Initial presets:

- `generic`
  - General QA checks for supported ad file types.
  - Does not claim platform compliance.

- `cm360_dv360`
  - HTML5 ZIP delivery checks aligned with CM360/DV360-style expectations.
  - Includes ZIP safety, HTML entry, dimensions, clickTag, package constraints, renderability, and suspicious external references.

- `google_ads`
  - Similar HTML5 ZIP checks with Google Ads-specific limits stored in the preset definition.

- `amazon_ads`
  - Similar HTML5 ZIP checks with Amazon Ads-specific limits stored in the preset definition.

- `rive`
  - Rive file checks: filename dimensions, wrapper generation viability, renderability smoke check.

- `video`
  - Video checks: supported extension, readable metadata, dimensions, duration, decode/frame-capture viability.

If an uploaded file type is not applicable for a selected preset, the validator should return a warning finding instead of failing the whole job unexpectedly.

## Findings Model

Each finding should be structured:

```json
{
  "severity": "error",
  "code": "MISSING_HTML",
  "title": "Missing HTML entry",
  "message": "The ZIP must contain at least one .html file.",
  "suggestion": "Add a root or shallow HTML entry point and re-upload the ZIP.",
  "path": "creative.zip"
}
```

Severity semantics:

- `error`: likely blocks trafficking or validation for the selected preset.
- `warning`: may be acceptable depending on campaign or platform configuration.
- `info`: useful metadata or non-blocking diagnostic detail.

Overall status:

- `fail` if any file has an `error`.
- `warning` if there are no errors but at least one warning.
- `pass` if there are no errors or warnings.

## Initial Checks

Generic checks:

- Safe filename.
- Supported file extension.
- File size within configured upload limit.
- ZIP magic bytes for ZIP uploads.
- ZIP traversal and extraction limits.
- At least one HTML file for HTML5 ZIPs.
- Detectable dimensions for HTML5 ZIPs, with source recorded.
- Renderability smoke check where possible.
- Blank render detection where possible.

HTML5/platform checks:

- Required HTML entry present.
- Dimensions detected and reasonable.
- `clickTag` or equivalent click-through hook present.
- Unsupported or suspicious file types in ZIP.
- External asset references flagged as warnings unless allowed by preset.
- Package limits from preset definitions.

Rive checks:

- Filename includes dimensions, e.g. `Banner_300x250.riv`.
- Generated wrapper can be constructed.
- Renderability smoke check can load the wrapper.

Video checks:

- Supported extension.
- ffprobe metadata readable.
- Dimensions detected.
- Duration readable and within preset-configured expectations when present.
- Last-frame capture or decode probe succeeds.

## UI Behavior

The validator UI should follow the accessibility patterns already added to the backup workflow:

- Keyboard-operable upload controls.
- Accessible file list summaries.
- Real `progressbar` semantics.
- Polite live-region announcements.
- Modal focus handling if a processing overlay is used.

The report should be scannable:

- Top summary row with overall status.
- Preset name and timestamp.
- Per-file sections with status badges.
- Findings grouped by severity.
- Short suggested fix text visible inline.

## Error Handling

Validation should be resilient per file. A failure to inspect one file should produce a file-level `error` finding, not crash the entire job.

Job-level `error` should be reserved for infrastructure failures such as storage, local server startup, or unexpected server exceptions.

Unknown exceptions should be converted into a structured finding with code `VALIDATION_ERROR`, a safe user-facing message, and a generic retry suggestion.

## Testing

Add focused tests at three levels:

- Unit tests for preset selection and individual check modules.
- API contract tests for validator upload, validate, status, ownership, auth, and error shapes.
- Frontend Playwright tests for validator mode, preset selection, accessible progress/status, and report rendering.

Representative fixtures:

- ZIP with no HTML.
- ZIP with HTML but no dimensions.
- ZIP with path traversal.
- ZIP with a clickTag.
- Rive file with and without dimensions in filename.
- Minimal video fixture or a mocked/probed sample if real video fixtures are too heavy.

## Out of Scope For First Version

- Exportable PDF/HTML validation reports.
- Running every preset at once.
- Persisting validator history beyond the existing temporary job lifetime.
- Automated platform submission or API integration.
- Pixel-perfect visual comparison against reference images.
