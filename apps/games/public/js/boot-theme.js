/* Apply the correct seat's theme before first paint. Practice must never read
 * a legacy test seat's preferences or a normal room's identity storage. */
(() => {
  try {
    const params = new URLSearchParams(location.search);
    const n = params.get('seat') || '';
    const session = params.get('practice') || '';
    const seat = /^[1-8]$/.test(n);
    const practice = params.get('embed') !== '1' && seat && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(session);
    const prefix = practice ? `practice:${session}:seat${n}:` : seat ? `seat${n}:` : '';
    const store = practice ? sessionStorage : localStorage;
    const theme = store.getItem(prefix + 'pb_theme');
    if (['night', 'dark', 'arcade'].includes(theme)) document.documentElement.dataset.theme = 'night';
    else if (!theme && window.matchMedia) {
      // No choice made yet: follow the device's light or dark setting, live,
      // until the player picks one with the theme button.
      const dark = matchMedia('(prefers-color-scheme: dark)');
      const follow = () => {
        if (store.getItem(prefix + 'pb_theme')) return;
        if (dark.matches) document.documentElement.dataset.theme = 'night';
        else delete document.documentElement.dataset.theme;
      };
      follow();
      dark.addEventListener?.('change', follow);
    }
    const tint = document.querySelector('meta[name="theme-color"]');
    if (tint) {
      const updateTint = () => { tint.content = getComputedStyle(document.documentElement).getPropertyValue('--topbar-bg').trim(); };
      updateTint();
      new MutationObserver(updateTint).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    }
  } catch { /* Storage restrictions keep the default day palette. */ }
})();
