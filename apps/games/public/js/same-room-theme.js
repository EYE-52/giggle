/* One-device play opens in Day. Keep a theme the group already chose. */
(() => {
  let saved;
  try { saved = localStorage.getItem('pb_theme'); } catch { /* Day without storage. */ }
  document.documentElement.dataset.theme = ['night', 'dark', 'arcade'].includes(saved) ? 'night' : 'day';
})();
