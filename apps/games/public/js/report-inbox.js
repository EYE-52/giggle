import { TYPES } from './toolkit/telemetry-schema.mjs';
const $ = id => document.getElementById(id);
const names = new Map([['platform', 'Platform / rooms']]);
let key = '', before = null, revision = 0, busy = false;
const notice = (text, error = false) => { $('notice').textContent = text; $('notice').toggleAttribute('data-error', error); };
function lock() {
  revision++; key = ''; before = null; busy = false;
  $('access').value = ''; $('items').replaceChildren(); $('inbox').hidden = true;
  $('login').hidden = false; $('logout').hidden = true; $('login').querySelector('button').disabled = false;
  for (const control of $('filters').elements) control.disabled = false;
  $('more').disabled = false; notice(''); $('access').focus();
}
async function request(url, options = {}) {
  const requestRevision = revision, requestKey = key;
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && requestRevision === revision && requestKey === key) lock();
    throw new Error(data.error || 'Could not load the inbox.');
  }
  return data;
}
function node(tag, text, className) {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className; return el;
}
function report(item) {
  const problem = !!item.fingerprint;
  const card = node('article', '', 'inbox-report');
  card.append(node('h2', `${problem ? `${item.spike ? 'SPIKE · ' : ''}${item.count} · ` : ''}${names.get(item.game) || item.game}`));
  card.append(node('div', problem ? `${item.type} · ${item.release} · ${item.previousCount} in previous period` : `${new Date(item.createdAt).toLocaleString()} · ${item.category} · ${item.impact} · v${item.version}`, 'inbox-meta'));
  card.append(node('p', problem ? `${item.message}${item.selector ? ' · ' + item.selector : ''}` : item.description));
  if (problem) card.append(node('div', `First ${new Date(item.firstSeen).toLocaleString()} · Last ${new Date(item.lastSeen).toLocaleString()}`, 'inbox-meta'));
  if (item.steps) { card.append(node('strong', 'Steps to repeat'), node('p', item.steps)); }
  const details = node('details', '', 'report-diagnostics'); details.append(node('summary', 'Device and game performance'), node('pre', JSON.stringify(item.context, null, 2)));
  card.append(details, node('div', `${problem ? 'Fingerprint ' + item.fingerprint : 'Report ' + item.id}`, 'inbox-meta'));
  const states = node('div', '', 'inbox-state');
  for (const status of ['new', 'triaged', 'resolved']) {
    const button = node('button', status[0].toUpperCase() + status.slice(1));
    button.setAttribute('aria-pressed', String(item.status === status));
    button.onclick = async () => {
      if (busy) return;
      const ownRevision = revision; busy = true;
      for (const b of document.querySelectorAll('.inbox-state button')) b.disabled = true;
      for (const control of $('filters').elements) control.disabled = true;
      $('more').disabled = true;
      try {
        await request(problem ? `/api/telemetry/${item.fingerprint}` : `/api/reports/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status, ...(problem ? { release: item.release } : {}) }) });
        if (ownRevision !== revision) return;
        item.status = status;
        for (const b of states.children) b.setAttribute('aria-pressed', String(b === button));
        notice('Status saved.');
      } catch (error) { if (ownRevision === revision) notice(error.message, true); }
      finally { if (ownRevision === revision) {
        busy = false;
        for (const b of document.querySelectorAll('.inbox-state button')) b.disabled = false;
        for (const control of $('filters').elements) control.disabled = false;
        $('more').disabled = false;
      } }
    };
    states.append(button);
  }
  card.append(states); return card;
}
async function load(older = false) {
  if (busy || !key) return;
  const ownRevision = revision; busy = true; $('more').disabled = true;
  for (const control of $('filters').elements) control.disabled = true;
  notice('Loading reports…');
  const problems = $('view').value === 'problems';
  const query = new URLSearchParams({ status: $('status').value, game: $('game').value, limit: '50' });
  if (older && before) query.set('before', before);
  if (problems) { query.delete('limit'); query.delete('before'); query.set('type', $('type').value); query.set('release', $('release').value.trim() || 'all'); query.set('since', $('since').value); }
  try {
    const data = await request(`/api/${problems ? 'telemetry' : 'reports'}?${query}`);
    if (ownRevision !== revision) return;
    for (const game of data.games || []) {
      if (names.has(game.id)) continue;
      names.set(game.id, game.name); const option = node('option', game.name); option.value = game.id; $('game').append(option);
    }
    if (!older) $('items').replaceChildren();
    $('items').append(...data.items.map(report)); before = data.before;
    $('more').hidden = problems || data.items.length < 50;
    notice($('items').children.length ? `${$('items').children.length} ${problems ? 'problem groups' : 'reports'} loaded.` : `No ${problems ? 'problems' : 'reports'} here.`);
    $('login').hidden = true; $('inbox').hidden = false; $('logout').hidden = false; $('access').value = '';
  } catch (error) { if (ownRevision === revision) notice(error.message, true); else if (!key) notice(error.message, true); }
  finally {
    if (ownRevision === revision) { busy = false; $('more').disabled = false; for (const control of $('filters').elements) control.disabled = false; }
    $('login').querySelector('button').disabled = false;
  }
}
$('login').onsubmit = event => { event.preventDefault(); key = $('access').value.trim(); $('login').querySelector('button').disabled = true; load(); };
$('logout').onclick = lock;
$('filters').onsubmit = event => { event.preventDefault(); load(); };
$('status').onchange = $('game').onchange = () => load();
for (const type of TYPES) { const option = node('option', type); option.value = type; $('type').append(option); }
$('view').onchange = () => {
  before = null;
  for (const field of document.querySelectorAll('.problem-filter')) field.hidden = $('view').value !== 'problems';
  $('problemNote').hidden = $('view').value !== 'problems';
  load();
};
$('type').onchange = $('since').onchange = () => load();
$('more').onclick = () => load(true);
