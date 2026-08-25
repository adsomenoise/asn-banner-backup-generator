# Creative Backup Image Contract

This app can generate backup images much faster when a creative exposes a deterministic backup frame.

Generated wrappers for standalone `.riv` uploads implement this contract automatically. ZIP creatives should implement one of the patterns below. The validator reports `HAS_BACKUP_HOOK` when it detects a complete contract and `MISSING_BACKUP_HOOK` when visual-stability fallback would be required.

The contract may be inline in the banner HTML or inside a local JavaScript file referenced by a `<script src="...">` element. The validator reports the file in which it found the contract. External scripts are not inspected.

## Fast Path

When capturing a creative, the app loads the creative URL with `?backup=1` appended.

Creatives should detect that query parameter and render their final static backup frame immediately. Once the frame is ready, set:

```js
window.__backupReady = true;
```

Example:

```html
<script>
  const params = new URLSearchParams(window.location.search);

  if (params.get('backup') === '1') {
    renderBackupFrame();
    window.__backupReady = true;
  }
</script>
```

## Function Hook

If the creative cannot render the backup frame during initial load, expose `window.generateBackupFrame`.

```js
window.generateBackupFrame = async function () {
  await stopAnimations();
  renderBackupFrame();
  window.__backupReady = true;
};
```

The app will call this function after loading the creative. The function may be synchronous or return a promise. If it returns `true`, the app also treats the backup as ready.

```js
window.generateBackupFrame = function () {
  renderBackupFrame();
  return true;
};
```

## Legacy Marker

`window.__BACKUP_READY__ = true` is still supported for older creatives, but new creatives should use `window.__backupReady`.

## Fallback

If neither `?backup=1` nor `window.generateBackupFrame()` produces a ready signal, the app samples low-resolution screenshots of the rendered viewport every 250 ms. It captures as soon as the visual has remained unchanged for 2 seconds. The configured creative duration is retained as a hard deadline (15 seconds by default), after which the final available frame is captured even when motion continues.

This fallback observes DOM, CSS, canvas, and WebGL motion without replacing the creative's `requestAnimationFrame`. HTML `<video>` elements instead pause and seek directly to their final decodable frame, ignoring the normal 15-second creative deadline. Standalone uploaded video files use ffmpeg to extract their last frame. The explicit contract remains the most deterministic option for other creative types.

## Integration recipes

These examples assume the creative already has a reliable way to render its intended final visual. Signal readiness only after that visual has been painted.

### Shared helper

Use this small helper with any animation library:

```js
function afterBackupPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__backupReady = true;
        resolve(true);
      });
    });
  });
}

window.generateBackupFrame = async function () {
  renderFinalFrame(); // Replace with the creative's own deterministic final-state function.
  return afterBackupPaint();
};

if (new URLSearchParams(window.location.search).get('backup') === '1') {
  window.generateBackupFrame();
}
```

### GSAP timeline

```js
window.generateBackupFrame = async function () {
  timeline.progress(1).pause();
  return afterBackupPaint();
};
```

Use the actual root timeline variable in place of `timeline`.

### Adobe Animate / CreateJS

```js
window.generateBackupFrame = async function () {
  exportRoot.gotoAndStop(exportRoot.totalFrames - 1);
  stage.update();
  return afterBackupPaint();
};
```

If the final visual is composed from nested timelines, create a creative-specific `renderFinalFrame()` instead of assuming that moving only `exportRoot` is sufficient.

### Rive wrapper

```js
window.generateBackupFrame = async function () {
  riveInstance.pause?.();
  riveInstance.scrub?.(Number.MAX_SAFE_INTEGER);
  riveInstance.resizeDrawingSurfaceToCanvas?.();
  return afterBackupPaint();
};
```

For state machines, an explicit designer-authored final-state input or transition is preferable to scrubbing. The generated standalone Rive wrapper already installs the supported fallback shown above.

## Validation checklist

- The contract produces the intended final visual, not merely the last programmatic frame.
- `window.__backupReady` is set only after fonts, images, canvas, or WebGL output needed by the final visual has painted.
- The normal ad experience is unchanged when `backup=1` is absent and `generateBackupFrame()` is not called.
- The hook is deterministic and safe to call once after page load.
- The creative works when other query parameters are already present.
- Validator output contains `HAS_BACKUP_HOOK` and names the expected HTML or JavaScript source.
