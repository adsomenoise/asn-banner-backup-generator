# Creative Backup Image Contract

This app can generate backup images much faster when a creative exposes a deterministic backup frame.

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

If neither `?backup=1` nor `window.generateBackupFrame()` produces a ready signal, the app falls back to waiting until the configured creative duration has elapsed from navigation start, then drains queued animation frames and checks canvas stability. The default fallback duration is 15 seconds. That path is slower than the explicit contract, but is intended to capture the end frame for standard 15-second creatives.
