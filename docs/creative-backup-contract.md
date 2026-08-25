# Creative Backup Image Contract

This app can generate backup images much faster when a creative exposes a deterministic backup frame.

Generated wrappers for standalone `.riv` uploads implement this contract automatically. ZIP creatives should implement one of the patterns below. The validator reports `HAS_BACKUP_HOOK` when it detects a complete contract and `MISSING_BACKUP_HOOK` when visual-stability fallback would be required.

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

This fallback observes DOM, CSS, canvas, WebGL, and video motion without replacing the creative's `requestAnimationFrame`. It is faster than always waiting for the deadline, but the explicit contract remains the most deterministic option.
