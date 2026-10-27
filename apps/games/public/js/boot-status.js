/* Independent of the module graph: a failed initial JS import must not leave
 * a never-ending loader. No progress is invented and ready content is never
 * held back for an animation. Normal boot/error rendering removes this node. */
(() => {
  const boot = document.querySelector('[data-app-boot]');
  if (!boot) return;
  setTimeout(() => {
    if (!boot.isConnected || !boot.hasAttribute('data-app-boot')) return;
    boot.removeAttribute('data-app-boot');
    boot.setAttribute('role', 'alert');
    boot.setAttribute('aria-busy', 'false');
    const title = boot.querySelector('[data-boot-title]');
    const description = boot.querySelector('[data-boot-description]');
    if (title) title.textContent = 'Taking longer than expected';
    if (description) description.textContent = 'The games did not finish loading. Check your connection, then reload.';
    const mark = boot.querySelector('.loading-mark');
    if (mark) mark.hidden = true;
  }, 12000);
})();
