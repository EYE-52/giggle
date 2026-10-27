const mode = document.querySelector('#mode'), size = document.querySelector('#size'), status = document.querySelector('#status'), container = document.querySelector('#clients');
const roles = ['a', 'b', 'c', 'watcher'], activeRoles = roles.slice(0, 3), frames = {};
const wait = ms => new Promise(r => setTimeout(r, ms));
let session = null, running = false, generation = 0, game, hints, settings, report;
const qa = role => frames[role]?.contentWindow.qa;
function assert(value, message) { if (!value) throw Error(message); }
function check(message, value) { assert(value, message); report.checks.push(message); }
async function until(predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout, own = generation;
  while (Date.now() < deadline) { if (!running || own !== generation) throw Error('Run retired'); const error = roles.flatMap(r => qa(r)?.errors || [])[0]; if (error) throw Error(error); if (predicate()) return; await wait(20); }
  throw Error(message);
}
function painted(role) { const q = qa(role); return !!q?.state && q.rendered === q.state && !q.state.preparing; }
function finiteMotion(role) { return qa(role)?.el.getAnimations({ subtree: true }).filter(a => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity) || []; }
async function settle() { await until(() => roles.every(painted) && roles.every(r => !finiteMotion(r).length), 'All roles did not release, render and settle'); }
function node(role, selector) { return qa(role).el.querySelector(selector); }
function click(role, selector) { const n = node(role, selector); assert(n && !n.disabled, role + ' cannot use ' + selector); n.scrollIntoView({ block: 'nearest' }); n.click(); }
function text(role, input, button, value) { const n = node(role, input); assert(n && !n.disabled, role + ' missing composer ' + input); n.value = value; n.dispatchEvent(new frames[role].contentWindow.Event('input', { bubbles: true })); click(role, button); }
function pointer(role, type, id, x, y, target) { const win = frames[role].contentWindow, canvas = node(role, 'canvas'), b = canvas.getBoundingClientRect(); (target || canvas).dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: b.left + b.width * x, clientY: b.top + b.height * y })); }
function line(role, id) { node(role, 'canvas').scrollIntoView({ block: 'center' }); pointer(role, 'pointerdown', id, .2, .5); pointer(role, 'pointermove', id, .8, .5, frames[role].contentWindow); pointer(role, 'pointerup', id, .8, .5, frames[role].contentWindow); }
function inkPixel(role) { const cv = node(role, 'canvas'); return [...cv.getContext('2d').getImageData(cv.width / 2, cv.height / 2, 1, 1).data]; }
async function perform(role, fn, message) {
  await settle(); const counts = roles.map(r => qa(r).stateCount), before = qa(role).sent.length;
  fn(); assert(qa(role).sent.length > before, message + ': shipped control sent no action');
  const id = qa(role).sent.at(-1).qaId;
  await until(() => qa(role).receipts.some(r => r.qaId === id), message + ': missing authority receipt');
  assert(qa(role).receipts.find(r => r.qaId === id).accepted, message + ': authority did not accept the control');
  await until(() => roles.every((r, i) => qa(r).stateCount > counts[i] && painted(r)), message + ': not every role painted its newer release');
  await settle(); report.actions++; report.checks.push(message);
}
function scores() { return Object.fromEntries(roles.map(r => [r, qa(r).state.scores])); }
function clients() { return Object.fromEntries(roles.map(r => [r, { phase: qa(r).state?.phase, spectator: qa(r).state?.spectator, readyAcks: qa(r).readyAcks, presentations: qa(r).presentations, cues: qa(r).cues, errors: qa(r).errors, phases: [...new Set(qa(r).paints.filter(p => !p.preparing).map(p => p.phase))] }])); }
async function save(name, packet) { const response = await fetch('/results?name=' + name, { method: 'POST', body: JSON.stringify(packet) }); if (!response.ok) throw Error(await response.text()); }
function utility(role) {
  const win = frames[role].contentWindow, doc = win.document, room = doc.querySelector('.room-menu>summary'), icon = doc.querySelector('.game-report-icon');
  const boxes = [room, icon].map(n => n.getBoundingClientRect());
  for (const [i, n] of [room, icon].entries()) { const b = boxes[i], hit = doc.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); assert(b.width >= 43.5 && b.height >= 43.5 && b.left >= 0 && b.top >= 0 && b.right <= win.innerWidth + .5 && b.bottom <= win.innerHeight + .5, role + ' utility target outside viewport'); assert(hit === n || n.contains(hit), role + ' utility covered'); }
  assert(boxes[0].right <= boxes[1].left || boxes[1].right <= boxes[0].left || boxes[0].bottom <= boxes[1].top || boxes[1].bottom <= boxes[0].top, role + ' Room/Report overlap');
  return { room: boxes[0].toJSON(), report: boxes[1].toJSON(), viewport: [win.innerWidth, win.innerHeight] };
}
async function reportModal(role) {
  const q = qa(role), win = frames[role].contentWindow, doc = win.document, icon = doc.querySelector('.game-report-icon'), before = q.screenChanges;
  const geometry = utility(role); icon.focus({ preventScroll: true }); icon.click();
  const dialog = doc.querySelector('dialog.issue-dialog[open]'); assert(dialog && doc.activeElement === dialog.querySelector('.issue-close'), role + ' Report initial focus'); assert(q.screenChanges === before + 1, role + ' Report did not release input');
  const sent = q.sent.length; let leaked = 0; const listener = () => leaked++; win.addEventListener('keydown', listener); dialog.querySelector('.issue-close').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); win.removeEventListener('keydown', listener);
  assert(!leaked && q.sent.length === sent, role + ' Report keyboard leaked'); dialog.querySelector('.issue-close').click(); assert(doc.activeElement === icon && !doc.querySelector('dialog[open]') && q.screenChanges === before + 2, role + ' Report close lifecycle/focus');
  return { phase: q.state.phase, ...geometry, releaseEvents: q.screenChanges - before };
}
async function doodle() {
  const artists = new Set(); report.rounds = [];
  for (let round = 1; round <= 3; round++) {
    await until(() => roles.every(r => qa(r).state.phase === 'pick' && qa(r).state.round === round && painted(r)), 'Doodle next artist not released');
    const artist = activeRoles.find(r => qa(r).state.me === qa(r).state.drawer), guessers = activeRoles.filter(r => r !== artist); artists.add(artist);
    check('Round ' + round + ': only artist has word choices', roles.every(r => r === artist ? qa(r).state.choices?.length === 3 : !qa(r).state.choices));
    await perform(artist, () => click(artist, '[data-w]'), 'Round ' + round + ': artist chooses a real dealt word');
    const word = qa(artist).state.wordShown, initialMask = qa(guessers[0]).state.masked, began = Date.now();
    check('Round ' + round + ': private word/ink nonce stays with artist', [...guessers, 'watcher'].every(r => !qa(r).state.word && !qa(r).state.wordShown && !qa(r).state.inkNonce));
    await perform(artist, () => line(artist, round), 'Round ' + round + ': live pointer drawing commits through shipped tools');
    check('Round ' + round + ': all clients paint canonical ink', roles.every(r => qa(r).state.strokes.length === 1 && inkPixel(r).slice(0, 3).every(c => c < 100)));
    await perform(guessers[0], () => text(guessers[0], '#dGuess', '#dSend', word === 'fixturewrong' ? 'anotherwrong' : 'fixturewrong'), 'Round ' + round + ': wrong guess keeps play open');
    check('Round ' + round + ': wrong guess gives private feedback without points', !!qa(guessers[0]).state.myFeedback && !qa(guessers[0]).state.guessed[qa(guessers[0]).state.me] && qa(artist).state.phase === 'draw');
    if (hints) {
      await until(() => roles.every(r => qa(r).state.phase === 'draw' && qa(r).state.hintsUsed >= 1 && painted(r)), 'Timed hint did not arrive through production onTick'); await settle();
      check('Round ' + round + ': actual timed hint changes mask while keeping word private', [...guessers, 'watcher'].every(r => qa(r).state.masked !== initialMask && qa(r).state.masked !== word && !qa(r).state.word));
    } else if (round === 1) {
      await until(() => qa(artist).api.now() >= qa(artist).state.endsAt - 4800, 'Disabled hint interval not reached');
      check('Hints off: no hint or mask change after the real halfway deadline', roles.every(r => qa(r).state.hintsUsed === 0 && qa(r).state.masked === initialMask && qa(r).state.hintAt === 0));
    }
    await perform(guessers[0], () => text(guessers[0], '#dGuess', '#dSend', word), 'Round ' + round + ': first correct guess scores');
    await perform(guessers[1], () => text(guessers[1], '#dGuess', '#dSend', word), 'Round ' + round + ': second correct guess releases reveal');
    check('Round ' + round + ': all roles reveal actual word and two correct guesses', roles.every(r => qa(r).state.phase === 'reveal' && qa(r).state.word === word && Object.keys(qa(r).state.guessed).length === 2));
    report.rounds.push({ round, artist, hintsUsed: qa(artist).state.hintsUsed, elapsedDrawMs: Date.now() - began, strokes: qa(artist).state.strokes.length });
    await perform(artist, () => click(artist, '#dNext'), 'Round ' + round + ': artist advances after released reveal');
  }
  check('All three original participants drew one complete legal turn', artists.size === 3);
  check('All three original participants earned positive scores', activeRoles.every(r => qa(r).state.scores[qa(r).state.me] > 0));
}
async function phone() {
  report.drawings = [];
  for (const [i, role] of activeRoles.entries()) await perform(role, () => text(role, '#pPhrase', '#pSend', 'Fixture phrase ' + (i + 1)), role + ': saves own opening phrase');
  check('All active roles receive an assigned prompt; watcher has no private prompt', activeRoles.every(r => qa(r).state.phase === 'draw' && qa(r).state.myPrompt && qa(r).state.myPrompt !== 'Fixture phrase ' + (activeRoles.indexOf(r) + 1)) && !qa('watcher').state.myPrompt);
  const drawStarted = qa('a').api.now(), drawEndsAt = qa('a').state.endsAt;
  for (const [i, role] of activeRoles.entries()) {
    await perform(role, () => line(role, i + 1), role + ': commits an actual private pointer drawing');
    check(role + ': own canonical ink painted and remains private', qa(role).state.myStrokes.length === 1 && inkPixel(role).slice(0, 3).every(c => c < 100) && !qa('watcher').state.myStrokes.length);
    report.drawings.push({ role, strokes: qa(role).state.myStrokes.length });
  }
  status.textContent = 'Draw Phone: waiting for the real 30-second drawing deadline…';
  await until(() => roles.every(r => qa(r).state.phase === 'guess' && painted(r)), 'Production drawing timer did not release captions', 45000); await settle();
  report.drawingTimer = { configuredMs: 30000, remainingAtStartMs: drawEndsAt - drawStarted, observedElapsedMs: qa('a').api.now() - drawStarted };
  check('Real drawing deadline passes assigned ink to captions', activeRoles.every(r => qa(r).state.myDrawing.length === 1 && !('myPrompt' in qa(r).state)) && !qa('watcher').state.myDrawing.length);
  for (const [i, role] of activeRoles.entries()) await perform(role, () => text(role, '#pGuess', '#pSend', 'Fixture caption ' + (i + 1)), role + ': saves actual assigned-drawing caption');
  check('Public reveal contains three complete real phrase/drawing/caption chains', roles.every(r => qa(r).state.phase === 'reveal' && qa(r).state.chains.length === 3 && qa(r).state.chains.every(c => c.phrase && c.strokes.length === 1 && c.guess)));
  for (let i = 0; i < 3; i++) { const host = roles.find(r => qa(r).api.context().isHost); check('Story ' + (i + 1) + ': current host owns paging', !!host && node(host, '#pNext') && roles.filter(r => r !== host).every(r => !node(r, '#pNext'))); await perform(host, () => click(host, '#pNext'), 'Host reveals story ' + (i + 1) + ' and advances'); }
}
async function finalAndLifecycle() {
  await settle(); const instance = qa('a').state.instanceId, retiredWindow = qa('a').state.w;
  check('All active roles and watcher painted final scores after settlement', roles.every(r => qa(r).state.phase === 'done' && qa(r).presentations.filter(id => id === instance).length === 1 && node(r, game === 'doodle-guess' ? '.dg-done .sk-standings' : '.dp-finished .sk-standings')?.children.length === 3));
  check('Every role agrees on final score values', new Set(roles.map(r => JSON.stringify(qa(r).state.scores))).size === 1);
  report.final = { instanceId: instance, scores: scores(), clients: clients(), utilities: {} };
  for (const role of roles) report.final.utilities[role] = await reportModal(role);
  report.lifecycle = { reconnects: [], rematch: null, stale: [] };
  for (const role of roles) {
    const cueCount = qa(role).cues.length, count = qa(role).presentations.length, before = JSON.stringify(qa(role).state.scores);
    await qa(role).reconnect(); await settle(); await wait(350); await settle();
    check(role + ': finished reconnect preserves scores and is quiet', qa(role).cues.length === cueCount && qa(role).presentations.length === count && JSON.stringify(qa(role).state.scores) === before);
    report.lifecycle.reconnects.push({ role, cueCount, presentations: count, quiet: true });
  }
  const ackCounts = roles.map(r => qa(r).readyAcks.length), host = roles.find(r => qa(r).api.context().isHost);
  assert(host, 'No elected host after reconnect'); const n = frames[host].contentDocument.querySelector('#bRematch'); assert(n && !n.disabled, 'Current host rematch unavailable'); n.click();
  await until(() => roles.every(r => qa(r).state.instanceId !== instance && painted(r)), 'New rematch did not release every connected role'); await settle();
  check('Late watcher joins the next match through real active-seat readiness', roles.every((r, i) => !qa(r).state.spectator && qa(r).state.players.length === 4 && qa(r).readyAcks.length > ackCounts[i]));
  check('Released rematch begins with empty private state', roles.every(r => qa(r).state.phase === (game === 'doodle-guess' ? 'pick' : 'write') && (game === 'doodle-guess' ? !qa(r).state.strokes.length && !Object.keys(qa(r).state.scores).length : !qa(r).state.myPhrase)));
  report.lifecycle.rematch = { host, instanceId: qa('a').state.instanceId, activeRoles: [...roles], utilities: {} };
  for (const role of roles) report.lifecycle.rematch.utilities[role] = await reportModal(role);
  const sender = game === 'doodle-guess' ? roles.find(r => qa(r).state.me === qa(r).state.drawer) : 'a';
  const action = game === 'doodle-guess' ? { choose: qa(sender).state.choices[0] } : { phrase: 'retired payload' };
  for (const meta of [{ i: instance, w: retiredWindow }, { i: qa(sender).state.instanceId, w: retiredWindow }]) {
    const before = qa(sender).state, id = qa(sender).raw(action, meta);
    await until(() => qa(sender).receipts.some(r => r.qaId === id), 'Stale action receipt missing'); await settle();
    check('Retired ' + (meta.i === instance ? 'instance' : 'window') + ' cannot mutate rematch', !qa(sender).receipts.find(r => r.qaId === id).accepted && qa(sender).state === before);
    report.lifecycle.stale.push({ instance: meta.i === instance ? 'retired' : 'current', window: 'retired', rejected: true });
  }
  check('No renderer/socket errors across match and lifecycle', roles.every(r => !qa(r).errors.length));
}
async function retire() { for (const r of roles) qa(r)?.dispose(); if (session) await fetch('/close?session=' + session, { method: 'POST' }); session = null; }
document.querySelector('#show').onclick = () => frames[document.querySelector('#role').value]?.parentElement.scrollIntoView({ block: 'start' });
document.querySelector('#stop').onclick = async () => { running = false; generation++; await retire(); status.textContent = 'Stopped and retired. No acceptance report.'; document.querySelector('#run').disabled = false; document.querySelector('#stop').disabled = true; mode.disabled = size.disabled = false; };
document.querySelector('#run').onclick = async () => {
  const own = ++generation, runButton = document.querySelector('#run'); running = true; runButton.disabled = true; document.querySelector('#stop').disabled = false; mode.disabled = size.disabled = true;
  [game, hints] = mode.value.split(':'); hints = hints === 'on'; const name = game === 'doodle-guess' ? game + '-hints-' + (hints ? 'on' : 'off') : game;
  report = { pass: false, game, hints: game === 'doodle-guess' ? hints : null, physicalDevice: false, controlledTiming: false, controls: 'Synthetic DOM pointer/click/input in actual native fixture', scope: 'Production Room/readiness/WS, shipping drawing client and shell result controller, real configured timers; no authority/clock/position override. Fixture chrome and Report modal; no actual app Room drawer or Meet/RTC.', checks: [], actions: 0, startedAt: new Date().toISOString() };
  try {
    await retire(); const response = await fetch('/session?game=' + game + '&hints=' + (hints ? 'on' : 'off'), { method: 'POST' }); if (!response.ok) throw Error(await response.text()); const data = await response.json(); session = data.session; settings = data.settings; report.settings = settings;
    container.innerHTML = ''; for (const [key] of Object.entries(frames)) delete frames[key]; const [w, h] = size.value.split(',').map(Number); report.viewport = [w, h];
    for (const role of roles) { const article = document.createElement('article'), title = document.createElement('h2'), f = document.createElement('iframe'); title.textContent = role + ' · independent client'; f.title = title.textContent; f.width = w; f.height = h; f.src = '/client?session=' + session + '&game=' + game + '&role=' + role; article.append(title, f); container.append(article); frames[role] = f; }
    await settle(); check('Opening releases only after every original active client ACKs', activeRoles.every(r => qa(r).readyAcks.length > 0) && qa('watcher').state.spectator && !qa('watcher').readyAcks.length); check('Opening snapshots are quiet', roles.every(r => !qa(r).cues.length && !qa(r).presentations.length));
    status.textContent = 'Running ' + name + ': real timers, legal controls…'; if (game === 'doodle-guess') await doodle(); else await phone(); await finalAndLifecycle();
    report.pass = true; report.finishedAt = new Date().toISOString(); report.clientsAfterLifecycle = clients(); await save(name + '-fullmatch', report); status.textContent = 'PASS ' + name + ': ' + report.actions + ' accepted UI actions, ' + report.checks.length + ' checks; all-role final, quiet reconnect, released rematch and stale rejection. Saved.';
  } catch (e) { if (own === generation) { report.error = e.stack || e.message; report.finishedAt = new Date().toISOString(); if (roles.every(r => qa(r))) report.clientsAtFailure = clients(); await save(name + '-failure', report); status.textContent = 'FAIL ' + name + ': ' + report.error; } }
  finally { if (own === generation) { running = false; runButton.disabled = false; document.querySelector('#stop').disabled = true; mode.disabled = size.disabled = false; } }
};
