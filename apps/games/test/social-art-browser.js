'use strict';
/* Social art browser harness: isolated QA for Would You Rather, Never
 * Ever and Most Likely To. Real server modules, legal actions, private
 * projections and production views. Own fixtures (normal 4-player match
 * plus 20-player and long-custom snapshots), own disposable server, own
 * evidence directory. No production room or player data.
 * Run fixtures: node test/social-art-browser.js
 * Run server:   node test/social-art-browser.js --serve
 *   (SOCIAL_ART_QA_PORT=0 picks a free port; evidence goes to
 *    qa-output/social-art/ unless SOCIAL_ART_QA_REPORT_DIR is set.)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const registry = require('../games/registry');
const { actionWindow } = require('../games/_sdk');
const ROOT = path.resolve(__dirname, '..');
const IDS = ['would-you-rather', 'never-ever', 'most-likely'];
const PLAYERS = [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bo' }, { id: 'p3', name: 'Charlie' }, { id: 'p4', name: 'Dev' }];
function bigRoster() {
  const out = [];
  for (let i = 0; i < 20; i++) out.push({ id: 'p' + (i + 1), name: `Alexandria Wellington-${i} · Fjord-McAllister the Third` });
  return out;
}
function rosterFor(r) {
  if (r === '20') return bigRoster();
  if (r === '3') return PLAYERS.slice(0, 3);
  return PLAYERS.slice();
}
const LONG = {
  'would-you-rather': { prompts: [{ a: 'Always know when someone is lying to you at the worst possible moment on a crowded night bus ' + 'unexpectedly delightful '.repeat(4), b: 'Always get away with lying but never be believed when you tell the truth ' + 'surprisinglylongchoice '.repeat(3) }] },
  'never-ever': { statements: ['Pretended to understand a movie everyone else loved while secretly planning to rewatch it alone ' + 'at midnight '.repeat(6)], labels: { have: 'Guilty as charged, I have', haveNot: 'Never, purely innocent' } },
  'most-likely': { prompts: ['Most likely to start an impromptu dance party in a quiet library and get everyone to join ' + 'win everything '.repeat(4)] },
};
class Ctx {
  constructor(players, packs) {
    this._players = players.slice();
    this._packs = packs || {};
    this.time = 1700000000000; this.timers = []; this.awards = {}; this.seq = 0; this.broadcasts = 0;
  }
  allPlayers() { return this._players.slice(); }
  players() { return this._players.slice(); }
  hostId() { return this._players[0].id; }
  settings() { return { rounds: 2 }; }
  now() { return this.time; }
  award(pid, n) { this.awards[pid] = (this.awards[pid] || 0) + n; }
  broadcast() { this.broadcasts++; }
  lobby() {}
  content(id) {
    if (this._packs[id]) return this._packs[id];
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en', id + '.json'), 'utf8')); } catch { return {}; }
  }
  later(ms, fn) { const t = { at: this.time + ms, fn, dead: false, seq: this.seq++ }; this.timers.push(t); return () => { t.dead = true; }; }
  fire() { const t = this.timers.filter((t) => !t.dead).sort((a, b) => a.at - b.at || a.seq - b.seq)[0]; if (!t) return false; t.dead = true; this.time = Math.max(this.time, t.at); t.fn(); return true; }
}
function make(id, players, packs) {
  const def = registry.get(id), ctx = new Ctx(players || PLAYERS, packs);
  return { id, def, ctx, players: (players || PLAYERS).slice(), state: def.create(ctx), actions: 0 };
}
function project(g, pid) {
  return JSON.parse(JSON.stringify({ ...g.def.view(g.state, pid), game: g.id, instanceId: 'social-art-' + g.id, w: actionWindow(g.state), me: pid, hostId: g.state.hostId || g.players[0].id, players: g.players.slice(), totals: g.ctx.awards, spectator: pid === 'watch', spectators: [{ id: 'watch', name: 'Watcher' }], serverNow: g.ctx.now() }));
}
function act(g, pid, a) { const w = actionWindow(g.state); g.def.onAction(g.state, g.ctx, pid, a); g.actions++; if (g.capture && w === actionWindow(g.state)) g.capture(); }
function advance(g) {
  const s = g.state, id = g.id, phase = s.phase;
  const send = (pid, a) => act(g, pid, a);
  if (phase === 'done') return false;
  if (phase === 'reveal') { send('p1', { next: true }); return true; }
  for (const p of g.players) {
    if (g.state.phase !== phase) break;
    if (id === 'most-likely') send(p.id, { vote: g.players.find((x) => x.id !== p.id).id });
    else if (id === 'never-ever') send(p.id, { vote: p.id === 'p2' ? 'have' : 'not' });
    else if (id === 'would-you-rather') send(p.id, { vote: p.id === 'p4' ? 'b' : 'a' });
  }
  if (g.state.phase === phase) g.ctx.fire();
  return true;
}
function framesFor(g, labelSuffix) {
  const views = [...g.players.map((p) => project(g, p.id)), project(g, 'watch')];
  return { label: g.state.phase + ' · ' + (g.state.round || 1) + (labelSuffix || ''), views };
}
function fixtures() {
  return IDS.map((id) => {
    const frames = [];
    /* Normal 4-player match through real legal actions. */
    const g = make(id);
    let n = 0;
    while (g.state.phase !== 'done' && n++ < 60) {
      frames.push(framesFor(g, ''));
      let acknowledged = false;
      g.capture = () => { if (!acknowledged) { acknowledged = true; frames.push(framesFor(g, ' acknowledged')); } };
      advance(g);
      g.capture = null;
    }
    assert.equal(g.state.phase, 'done', id + ' completes with real legal actions');
    frames.push(framesFor(g, ''));
    assert(g.actions > 0, id + ' performed legal actions');
    const actions = g.actions;
    /* 20-player single-round snapshots: open, locked, reveal, done. */
    const big = make(id, bigRoster());
    big.state.rounds = 1;
    frames.push({ ...framesFor(big, ' · 20 players'), label: 'vote · 1 · 20 players' });
    act(big, 'p1', id === 'most-likely' ? { vote: 'p2' } : id === 'never-ever' ? { vote: 'not' } : { vote: 'a' });
    frames.push({ ...framesFor(big, ' · 20 players locked'), label: 'vote acknowledged · 1 · 20 players' });
    for (const p of big.players) {
      if (big.state.phase !== 'vote') break;
      if (big.state.votes[p.id]) continue;
      if (id === 'most-likely') act(big, p.id, { vote: p.id === 'p1' ? 'p2' : 'p1' });
      else if (id === 'never-ever') act(big, p.id, { vote: 'not' });
      else act(big, p.id, { vote: 'b' });
    }
    if (big.state.phase === 'vote') big.ctx.fire();
    assert.equal(big.state.phase, 'reveal', id + ' 20-player reveal');
    frames.push({ ...framesFor(big, ' · 20 players'), label: 'reveal · 1 · 20 players' });
    act(big, big.state.hostId, { next: true });
    assert.equal(big.state.phase, 'done', id + ' 20-player done');
    frames.push({ ...framesFor(big, ' · 20 players'), label: 'done · 20 players' });
    /* Long/custom-text vote snapshot (4 players, unseen strings). */
    const custom = make(id, PLAYERS, LONG);
    frames.push({ ...framesFor(custom, ' · long custom text'), label: 'vote · 1 · long custom text' });
    return { id, frames, actions };
  });
}
const FIXTURES = fixtures();
if (require.main === module && !process.argv.includes('--serve')) {
  for (const f of FIXTURES) console.log('SOCIAL_ART_FIXTURE_PASS ' + f.id + ' ' + f.frames.length + ' snapshots, ' + f.actions + ' legal actions');
}
if (require.main === module && process.argv.includes('--serve')) {
  let live = make('would-you-rather');
  let liveRoster = '4', livePack = 'normal';
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    try {
      if (u.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); return; }
      if (u.pathname === '/api/qa-report' && req.method === 'POST') {
        let raw = '';
        for await (const c of req) raw += c;
        const data = JSON.parse(raw);
        const name = 'social-art-' + (data.width || 0) + 'x' + (data.height || 0) + '-' + (data.theme || 'day') + '.json';
        const dir = process.env.SOCIAL_ART_QA_REPORT_DIR || path.join(ROOT, 'qa-output', 'social-art');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
        res.end('Saved');
        return;
      }
      if (u.pathname === '/api/fixtures') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(FIXTURES)); return; }
      if (u.pathname === '/api/state') {
        const id = u.searchParams.get('game') || live.id;
        const roster = u.searchParams.get('roster') || liveRoster;
        const pack = u.searchParams.get('pack') || livePack;
        if (id !== live.id || roster !== liveRoster || pack !== livePack) {
          live = make(id, rosterFor(roster), pack === 'long' ? LONG : null);
          liveRoster = roster; livePack = pack;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(project(live, u.searchParams.get('player') || 'p1')));
        return;
      }
      if (u.pathname === '/api/action' && req.method === 'POST') {
        let raw = '';
        for await (const c of req) raw += c;
        const b = JSON.parse(raw);
        if (b.w === actionWindow(live.state) && b.player !== 'watch') act(live, b.player, b.action);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(project(live, b.player)));
        return;
      }
      if (u.pathname === '/api/step') { advance(live); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(project(live, u.searchParams.get('player') || 'p1'))); return; }
      if (u.pathname === '/api/reset') {
        const id = u.searchParams.get('game') || live.id;
        const roster = u.searchParams.get('roster') || liveRoster;
        const pack = u.searchParams.get('pack') || livePack;
        live = make(id, rosterFor(roster), pack === 'long' ? LONG : null);
        liveRoster = roster; livePack = pack;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(project(live, u.searchParams.get('player') || 'p1')));
        return;
      }
      const file = path.resolve(ROOT, 'public', '.' + u.pathname);
      if (!file.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end('Not found'); return; }
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.html': 'text/html', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
      res.setHeader('Content-Type', type);
      res.end(fs.readFileSync(file));
    } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
  });
  const port = Number(process.env.SOCIAL_ART_QA_PORT || 0);
  server.listen(port, '127.0.0.1', () => console.log('SOCIAL_ART_QA http://127.0.0.1:' + server.address().port));
}
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Social Art QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/party-scenes.css"><style>body{margin:0;padding:16px}#qa-toolbar>summary{min-height:44px;display:flex;align-items:center;font-size:16px;cursor:pointer;margin-bottom:10px}header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;font-size:16px}header select,header button{min-height:44px;font-size:16px}#stage{width:min(100%,940px);margin:auto}.qa-phone #stage{width:390px;max-width:100%}#checks{margin:20px auto;max-width:940px;font-size:16px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left}#status{font-size:16px;line-height:1.5}#errors{white-space:pre-wrap;color:var(--melon-deep)}</style></head><body><details id="qa-toolbar" open><summary>QA controls</summary><header><strong>Social Art · local QA</strong><label>Game <select id="game"></select></label><label>View <select id="person"><option value="p1">Asha</option><option value="p2">Bo</option><option value="p3">Charlie</option><option value="p4">Dev</option><option value="p20">Player 20</option><option value="watch">Watcher</option></select></label><label>Roster <select id="roster"><option value="3">3 players</option><option value="4">4 players</option><option value="20">20 players</option></select></label><label>Pack <select id="pack"><option value="normal">Normal text</option><option value="long">Long custom text</option></select></label><button id="reset">Restart test</button><button id="step">Play next legal action</button><button id="phone">Phone width</button><button id="theme">Night theme</button><button id="verify">Verify three views</button><button id="broadcast">Same-window broadcast</button><label>Snapshot <select id="frame"></select></label></header></details><p id="status">Loading real game views…</p><div id="stage" class="game-stage"><div class="game-clock"><div class="timerbar" id="tbar"><div></div></div><div class="timertext" id="ttime"></div></div><main id="gbody" data-layout="standard"></main></div><div id="checks"></div><pre id="errors"></pre><script type="module">
import {show,reset} from '/js/game-host.js';
let fixtures=await(await fetch('/api/fixtures')).json(),S=null;const by=id=>document.getElementById(id),root=by('gbody');
by('game').innerHTML=fixtures.map(f=>'<option>'+f.id+'</option>').join('');
let report=[],captureActions=null,rawState=null;
function footer(state){by('ttime').textContent=state.endsAt?'Time · '+Math.max(0,Math.ceil((state.endsAt-state.serverNow)/1000))+'s':'';if(state.phase==='done'&&!by('rematch')){const f=document.createElement('div');f.id='rematch';f.className='row mt';f.innerHTML='<button class="btn">Rematch</button><button class="btn ghost">Change game</button>';root.appendChild(f);f.querySelector('button').onclick=load;f.querySelector('button.ghost').onclick=()=>{by('qa-toolbar').open=true;by('game').focus();};}}
async function paint(state,captured){rawState=JSON.parse(JSON.stringify(state));captureActions=captured;S=state;const v=await show(root,S.game,S,{now:()=>S.serverNow,send:async a=>{if(captureActions){captureActions.push(a);return;}const next=await(await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:S.me,w:S.w,action:a})})).json();await paint(next);by('status').textContent='Real action recorded · '+JSON.stringify(a)+' → '+next.phase;},focus:n=>{const field=typeof n==='string'?document.querySelector(n):n;if(field&&field.focus){try{field.focus({preventScroll:true});}catch{field.focus();}}},toast:m=>{by('status').textContent=m;}});if(!v)throw Error('View failed '+S.game);footer(S);return v;}
function fillFrames(){const f=fixtures.find(f=>f.id===by('game').value);by('frame').innerHTML='<option value="">Live test</option>'+f.frames.map((x,i)=>'<option value="'+i+'">'+x.label+'</option>').join('');}
async function load(){reset();fillFrames();await paint(await(await fetch('/api/reset?game='+by('game').value+'&player='+by('person').value+'&roster='+by('roster').value+'&pack='+by('pack').value)).json());by('status').textContent='Real engine · '+S.game+' · '+S.phase+' · '+S.me+' · '+S.players.length+' players';}
by('game').onchange=load;by('reset').onclick=load;by('roster').onchange=load;by('pack').onchange=load;
by('person').onchange=async()=>{if(by('frame').value!=='')by('frame').onchange();else{reset();await paint(await(await fetch('/api/state?game='+by('game').value+'&player='+by('person').value+'&roster='+by('roster').value+'&pack='+by('pack').value)).json());}};
by('step').onclick=async()=>{await paint(await(await fetch('/api/step?player='+by('person').value)).json());by('status').textContent='Legal player actions / server timer → '+S.phase;};
by('broadcast').onclick=async()=>{await paint(JSON.parse(JSON.stringify(rawState||S)));by('status').textContent='Same-window broadcast applied';};
by('phone').onclick=()=>{document.body.classList.toggle('qa-phone');by('phone').textContent=document.body.classList.contains('qa-phone')?'Desktop width':'Phone width';};
by('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';};
by('frame').onchange=async()=>{if(by('frame').value===''){await load();return;}reset();const f=fixtures.find(f=>f.id===by('game').value);const views=f.frames[Number(by('frame').value)].views;await paint(views.find(v=>v.me===by('person').value)||views[0]);by('status').textContent='Actual private projection · '+S.game+' · '+S.phase+' · '+S.me+' · '+S.players.length+' players';};
by('verify').onclick=async()=>{
  report=[];by('errors').textContent='';by('verify').disabled=true;
  const worlds={'would-you-rather':'.wyr-world','never-ever':'.never-world','most-likely':'.likely-world'};
  for(const f of fixtures){
    const issues=[];let seen=0,actions=0;
    for(const me of ['p1','p2','p3','p4','watch']){
      reset();
      for(const frame of f.frames){
        const state=frame.views.find(v=>v.me===me)||frame.views[0];
        try{
          const captured=[];await paint(state,captured);seen++;
          const choice=root.querySelector('button[data-v]:not(:disabled),#wNext:not(:disabled),#nNext:not(:disabled),#mNext:not(:disabled)');
          if(choice){choice.click();await Promise.resolve();if(captured.length!==1)issues.push(frame.label+' action did not emit exactly once');else actions++;}
          if(!root.querySelector('.party-scene'))issues.push(frame.label+' has no owned scene');
          if(!root.querySelector(worlds[f.id]))issues.push(frame.label+' misses its scoped world');
          const hud=root.querySelector('.party-hud');
          if(!hud)issues.push(frame.label+' missing game HUD');else if(hud.dataset.phase!==state.phase)issues.push(frame.label+' stale HUD phase');
          if(root.scrollWidth>root.clientWidth+2)issues.push(frame.label+' scene horizontal overflow '+root.scrollWidth+'/'+root.clientWidth);
          if(document.documentElement.scrollWidth>document.documentElement.clientWidth+2)issues.push(frame.label+' document horizontal overflow');
          for(const n of root.querySelectorAll('button,input,select,textarea,summary')){
            const r=n.getBoundingClientRect(),css=getComputedStyle(n);
            if(r.height===0)continue;
            if(r.height<44||r.width<44)issues.push(frame.label+' short target '+(n.id||n.textContent.trim().slice(0,20))+' '+r.width.toFixed(1)+'×'+r.height.toFixed(1));
            if(n.tagName!=='SUMMARY'&&parseFloat(css.fontSize)<16)issues.push(frame.label+' small control text '+(n.id||n.textContent.trim().slice(0,20)));
          }
          for(const n of root.querySelectorAll('.party-prompt'))if(parseFloat(getComputedStyle(n).fontSize)<24)issues.push(frame.label+' small prompt');
          if(me==='watch'&&[...root.querySelectorAll('input,button,select,textarea')].some(n=>!n.disabled&&!n.closest('#rematch')))issues.push(frame.label+' watcher enabled action');
          if(state.phase==='done'&&!by('rematch'))issues.push('missing shell rematch');
          if(state.phase==='vote'&&root.querySelector('.party-result'))issues.push(frame.label+' vote leaks reveal rows');
        }catch(e){issues.push(frame.label+': '+e.message);}
      }
    }
    if(!actions)issues.push('No UI action emitted');report.push({id:f.id,seen,actions,issues:[...new Set(issues)]});
    by('checks').innerHTML='<table><thead><tr><th>Game</th><th>Real private views</th><th>Result</th></tr></thead><tbody>'+report.map(r=>'<tr><td>'+r.id+'</td><td>'+r.seen+'</td><td>'+(r.issues.length?r.issues.length+' issues':'PASS')+'</td></tr>').join('')+'</tbody></table>';
  }
  by('errors').textContent=report.filter(r=>r.issues.length).map(r=>r.id+'\\n'+r.issues.join('\\n')).join('\\n\\n');
  by('status').textContent='VERIFY_COMPLETE '+report.reduce((n,r)=>n+r.seen,0)+' actual renders / '+report.length+' games / '+report.reduce((n,r)=>n+r.issues.length,0)+' issues';
  await fetch('/api/qa-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',report})});
  by('verify').disabled=false;reset();await load();
  by('status').textContent='VERIFY_COMPLETE '+report.reduce((n,r)=>n+r.seen,0)+' actual renders / '+report.length+' games / '+report.reduce((n,r)=>n+r.issues.length,0)+' issues';
};
await load();
</scr` + `ipt></body></html>`;

module.exports = { FIXTURES };

