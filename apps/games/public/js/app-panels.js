/* One app interaction for legacy disclosures, including dynamically painted
 * games. Keep content under its original owner: delegated game handlers,
 * private inputs, ids and native details.open state continue to work.
 * Dialog's top layer escapes clipped Meet panels and blocks game input. */
(() => {
  if (window.gigglePanels) return;
  let active = null, serial = 0;
  const docked = node => node.matches('.chhist-wrap') && (node.closest('#gbody')?.clientWidth || innerWidth) >= 1000;
  const key = node => `${document.body.dataset.game || ''}|` + (node.id || `${[...node.classList].filter(c => !c.startsWith('app-')).join('.')}@${[...document.querySelectorAll('details')].filter(n => n.className === node.className).indexOf(node)}`);
  const focus = node => node?.focus({ preventScroll: true });
  const focusables = panel => [...panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
    .filter(n => !n.disabled && !n.hidden && n.getClientRects().length);
  function position() {
    if (!active) return;
    const { node, panel, summary } = active;
    if (!node.isConnected) return;
    const sheet = innerWidth < 600;
    panel.classList.toggle('is-sheet', sheet);
    if (sheet) {
      panel.style.left = '0px'; panel.style.top = 'auto'; panel.style.bottom = '0px';
      return;
    }
    const r = summary.getBoundingClientRect(), gap = 8, pad = 16;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const below = r.bottom + gap;
    panel.style.left = `${Math.max(pad, Math.min(r.left, innerWidth - w - pad))}px`;
    panel.style.top = `${Math.max(pad, below + h <= innerHeight - pad ? below : r.top - h - gap)}px`;
    panel.style.bottom = 'auto';
  }
  function close(restore = true) {
    if (!active) return;
    const old = active; active = null;
    old.panel.close(); old.node.open = false;
    old.summary.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new Event('game-screenchange'));
    if (restore && old.summary.isConnected) focus(old.summary);
  }
  function open(node, { restore } = {}) {
    if (!node.isConnected || docked(node)) return;
    if (active?.node === node) return;
    close(false);
    const summary = node.querySelector(':scope > summary'), panel = node.querySelector(':scope > .app-panel');
    if (!summary || !panel) return;
    node.open = true;
    summary.setAttribute('aria-expanded', 'true');
    panel.querySelector('.app-panel-title').textContent = summary.getAttribute('aria-label') || summary.textContent.trim();
    const body = panel.querySelector(':scope > .app-panel-body');
    active = { node, summary, panel, body, key: key(node) };
    // Put native autofocus inside the viewport before entering the top layer.
    // Otherwise a launcher low on a scrolling setup page can scroll that page.
    panel.style.left = '16px'; panel.style.top = '16px'; panel.style.bottom = 'auto';
    const pageScroll = [scrollX, scrollY];
    const scrollParents = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth) scrollParents.push([parent, parent.scrollLeft, parent.scrollTop]);
    }
    panel.showModal(); position();
    for (const [parent, left, top] of scrollParents) { parent.scrollLeft = left; parent.scrollTop = top; }
    if (scrollX !== pageScroll[0] || scrollY !== pageScroll[1]) window.scrollTo({ left: pageScroll[0], top: pageScroll[1], behavior: 'instant' });
    document.dispatchEvent(new Event('game-screenchange'));
    if (restore) {
      body.scrollTop = restore.scroll;
      const target = restore.id ? document.getElementById(restore.id) : null;
      focus(target && panel.contains(target) ? target : panel.querySelector('[data-app-close]'));
      if (target && restore.selection && typeof target.setSelectionRange === 'function') target.setSelectionRange(...restore.selection);
    } else if (body.scrollHeight > body.clientHeight) {
      focus(body); // Native paging and arrow keys scroll the list from the first keystroke.
    } else focus(panel.querySelector('[data-app-close]'));
  }
  function mode(node) {
    const isDocked = docked(node), summary = node.querySelector(':scope > summary'), panel = node.querySelector(':scope > .app-panel');
    node.classList.toggle('app-docked', isDocked);
    if (isDocked) {
      if (active?.node === node) close(false);
      node.open = true; summary.tabIndex = -1; summary.removeAttribute('aria-haspopup'); summary.removeAttribute('aria-expanded'); summary.setAttribute('role', 'heading'); summary.setAttribute('aria-level', '2');
      panel.setAttribute('role', 'region'); panel.removeAttribute('aria-modal');
    } else {
      summary.tabIndex = 0; summary.setAttribute('aria-expanded', String(active?.node === node)); summary.removeAttribute('role'); summary.removeAttribute('aria-level'); summary.setAttribute('aria-haspopup', 'dialog');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
      if (active?.node !== node) node.open = false;
    }
  }
  function enhance(node) {
    // Room already has a fixed utility sheet with its own focus/confirm flow.
    if (node.matches('.room-menu') || node.closest('.game-retiring')) return;
    if (node.classList.contains('app-disclosure') && node.querySelector(':scope > .app-panel')) return;
    const summary = node.querySelector(':scope > summary'); if (!summary) return;
    node.classList.add('app-disclosure');
    const panel = document.createElement('dialog'); panel.className = 'app-panel'; panel.id = `app-panel-${++serial}`;
    panel.setAttribute('aria-labelledby', `${panel.id}-title`);
    const head = document.createElement('header'); head.className = 'app-panel-head';
    const title = document.createElement('h2'); title.className = 'app-panel-title'; title.id = `${panel.id}-title`;
    const exit = document.createElement('button'); exit.type = 'button'; exit.dataset.appClose = ''; exit.setAttribute('aria-label', 'Close panel');
    exit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    head.append(title, exit);
    const body = document.createElement('div'); body.className = 'app-panel-body'; body.tabIndex = -1;
    body.setAttribute('role','group'); body.setAttribute('aria-labelledby',title.id);
    for (const child of [...node.childNodes]) if (child !== summary) body.append(child);
    panel.append(head, body); node.append(panel);
    summary.setAttribute('aria-controls', panel.id); summary.setAttribute('aria-expanded', 'false');
    summary.addEventListener('click', event => {
      event.preventDefault();
      if (docked(node)) return;
      if (active?.node === node) close(); else open(node);
    });
    exit.addEventListener('click', () => close());
    panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
    panel.addEventListener('click', event => {
      // A native dialog reports backdrop hits with the dialog as the target.
      if (event.target !== panel) return;
      const r = panel.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { event.stopPropagation(); close(); }
    });
    node.addEventListener('toggle', () => {
      if (docked(node)) { node.open = true; return; }
      if (node.open && active?.node !== node) open(node);
      if (!node.open && active?.node === node) close(false);
    });
    mode(node);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches('details')) enhance(root);
    for (const node of root.querySelectorAll('details')) enhance(node);
  }
  function start() {
    scan(document.body);
    new MutationObserver(records => {
      const previous = active;
      for (const record of records) for (const node of record.addedNodes) scan(node);
      if (previous && (!previous.node.isConnected || !previous.panel.isConnected)) {
        const focused = previous.panel.querySelector(':focus');
        const restore = { scroll: previous.body.scrollTop, id: focused?.id, selection: focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null };
        const replacement = [...document.querySelectorAll('details.app-disclosure')].find(node => key(node) === previous.key);
        close(false); if (replacement && !replacement.closest('.bk-panel.is-final')) open(replacement, { restore });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('keydown', event => {
    if (!active || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.key === 'Tab') {
      const items = focusables(active.panel), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.addEventListener('resize', () => {
    for (const node of document.querySelectorAll('details.app-disclosure')) mode(node);
    position();
  });
  // An anchored panel follows its button when its own scroll container moves.
  window.addEventListener('scroll', event => { if (active && !active.panel.contains(event.target)) position(); }, true);
  window.gigglePanels = { close, open, closeFor(owner) { if (active && owner.contains(active.node)) close(false); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
