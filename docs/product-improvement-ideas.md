# Product Improvement Ideas

This document records potential improvements and feature directions for the Rive Backup Image Generator. It is a reference for future prioritization, not a committed roadmap.

## Recommended Direction

The strongest product direction is to evolve the application from a one-shot backup generator into a creative QA and delivery workspace. The existing capture and validation foundations can support richer review, automation, and collaboration workflows.

## High-Value Product Improvements

### Backup preview and approval

Show every generated image before download, together with its dimensions, encoded size, capture strategy, and warnings. Allow users to approve the result or regenerate an individual file.

### Interactive frame selection

Capture several candidate frames, such as the final stable frame, last animation frame, and selected timestamps. Let the user choose the most appropriate backup when automatic end-frame detection produces a technically valid but visually undesirable result.

### Campaign contact sheet

Display all campaign formats in a responsive gallery. This would make inconsistent messaging, missing logos, incorrect crops, and divergent end frames easier to spot.

### Combined validation and generation

Provide a single workflow that validates files first, blocks critical failures, and generates backups for eligible creatives. Users should not need to upload the same campaign separately to the current backup and validator modes.

### Downloadable QA reports

Export validation results as HTML, PDF, JSON, or CSV alongside generated assets. Reports could include package metadata, dimensions, file sizes, platform compatibility, warnings, screenshots, and recommended fixes.

### Multi-preset validation

Run all applicable presets in one operation and present a compatibility matrix for CM360/DV360, Google Ads, Amazon Ads, Xandr, and other destinations.

### Custom validation presets

Allow teams to define client- or publisher-specific rules, including:

- Allowed dimensions and file extensions.
- Maximum package and output sizes.
- Naming conventions.
- Required clickTag patterns.
- Duration limits.
- Approved external domains.
- Required backup-frame contracts.

### Safe automatic repairs

Offer opt-in fixes for mechanical packaging problems, with an exact preview of the proposed changes. Possible repairs include:

- Renaming unsafe paths.
- Removing operating-system metadata files.
- Flattening unnecessary wrapper directories.
- Inserting or repairing `ad.size` metadata.
- Correcting local asset paths.
- Optimizing oversized images.
- Generating missing wrapper HTML or manifests.

## Workflow Improvements

### Persistent job history

Replace or supplement the in-memory job store with durable storage. This would make processing resilient to restarts and enable job history, saved validation reports, auditing, and later re-downloads.

### Campaign organization

Group related creative sizes under a campaign and retain client, campaign, market, language, and version metadata.

### Output naming templates

Support configurable names such as `{client}_{campaign}_{width}x{height}_backup.jpg` and detect duplicate output names before processing.

### More granular processing and downloads

Allow users to:

- Download one result instead of the complete archive.
- Select which uploaded files should be processed.
- Regenerate only selected, failed, or changed files.
- Remove an individual upload without restarting the entire job.

### Better upload feedback

Show file size, detected type, and dimensions as soon as possible. Display upload limits in the drop zone and warn before uploading files close to those limits.

### End-to-end cancellation

Ensure cancellation propagates through queued work, ZIP extraction, browser capture, image encoding, video probing, and video frame extraction.

### Completion notifications and sharing

Optionally notify users through email or webhooks when large batches finish. Expiring, read-only review links could support approval without exposing the full application.

### Saved user and tenant defaults

Remember preferred validation presets, output format, quality, byte limit, capture strategy, and naming convention.

## Deeper QA Capabilities

### Visual regression testing

Compare a new creative version with a previously approved version using image differences and configurable tolerances.

### Cross-size consistency checks

Detect missing logos, differing calls to action, inconsistent colors, mismatched copy, and inconsistent end frames across campaign sizes.

### Animation timeline inspection

Generate thumbnails at several points in the animation and flag blank openings, flashing, long static periods, late content, or unexpected loops.

### Click-through testing

Verify that the clickable region works, the clickTag value can be overridden, and navigation does not occur before user interaction.

### Network and runtime diagnostics

Surface failed requests, console errors, external domains, mixed content, missing fonts, blocked resources, and slow assets. The capture layer already collects browser warnings and errors that could feed this report.

### Font and text checks

Identify missing fonts, fallback rendering, clipped or overflowing text, and potentially unreadable text sizes.

### Richer Rive inspection

Report artboards, animations, state machines, intrinsic dimensions, available end states, and whether a designated backup state exists.

### More accurate platform rules

Expand presets with destination-specific package weight, output weight, dimensions, duration, clickTag, codec, bitrate, frame-rate, and packaging rules. Rules should carry a documented source and revision date so that compliance claims remain auditable.

### Evidence-rich findings

Attach relevant screenshots, source paths, HTML snippets, console errors, or failed network requests to validator findings.

## Automation and Integrations

### CI/CD validation

Provide a machine-readable validation command with stable exit codes and report output suitable for creative build pipelines.

### API tokens and webhooks

Allow external systems to submit jobs, query results, and receive signed completion callbacks without relying on browser-session authentication.

### Watch-folder processing

Monitor a local directory or cloud bucket and automatically process newly delivered creative packages.

### Storage and DAM integrations

Support importing source files from and publishing results to services such as S3-compatible storage, Google Drive, Dropbox, Box, or a digital asset management platform.

### Trafficking-ready deliverables

Generate destination-specific package structures, manifests, naming, and validation evidence rather than only a generic output archive.

## Platform and Operational Foundations

The following should take priority before the service is widened to untrusted or multi-tenant use. Detailed security findings are maintained separately in `AUDIT.md`.

- Replace trusted client-supplied identity headers with verified authentication and identity provenance.
- Put all expensive work behind one bounded admission queue with global and per-tenant quotas.
- Add hard timeouts and output limits to every video probe and decode operation.
- Enforce ZIP expansion limits before or during decompression allocation.
- Isolate uploaded creative network access and block access to internal services.
- Constrain accepted dimensions and image allocations.
- Persist job state and make stuck-job recovery deterministic.
- Use durable or external artifact storage when running multiple application instances.
- Add browser crash detection and automatic pool recovery.
- Separate public liveness/readiness information from authenticated operational metrics.
- Stream large result archives instead of assembling them entirely in memory if batch limits grow.

## Suggested Sequence

1. [x] Strengthen security boundaries and resource limits. Completed 2026-08-27.
2. Add result previews, campaign gallery, and per-file regeneration.
3. Combine validation and backup generation into one workflow.
4. Add durable job history and exportable reports.
5. Add multi-preset and custom validation.
6. Add visual regression, integrations, and pipeline automation.
