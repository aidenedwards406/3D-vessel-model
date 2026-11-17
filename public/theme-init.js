// Applies the saved light/dark preference before the app renders (avoids a flash).
// Only the theme preference is stored; study data is never written to the browser.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('vessel-viewer:theme') || 'system';
  } catch (e) {
    /* storage unavailable: fall back to the OS setting */
  }
  var dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
