// Castle Clash home: tiny progressive enhancement. No network calls,
// no auto-rooms. Adds a pennant flutter on load (skipped under
// prefers-reduced-motion) and keeps the muster form fully native.
(function () {
  'use strict';
  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !document.body.animate) return;
  var pennants = document.querySelectorAll('.pennant');
  pennants.forEach(function (p, i) {
    p.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(2deg)' }, { transform: 'rotate(0deg)' }],
      { duration: 900, delay: 200 + i * 250, iterations: 2, easing: 'ease-in-out' }
    );
  });
}());
