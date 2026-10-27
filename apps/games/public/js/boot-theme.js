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
    const theme = (practice ? sessionStorage : localStorage).getItem(prefix + 'pb_theme');
    if (['night', 'dark', 'arcade'].includes(theme)) document.documentElement.dataset.theme = 'night';
  } catch { /* Storage restrictions keep the default day palette. */ }
})();
