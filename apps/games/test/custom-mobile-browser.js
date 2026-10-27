'use strict';
// Local real-client mobile QA: engine projections, frame bridge, DOM geometry
// and synthetic multi-contact checks, launched by a browser button through CUA.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const defs = Object.fromEntries(['chain-reaction', 'pocket-karts', 'castle-clash'].map(id => [id, require('../games/' + id + '/server')]));
const directory = process.env.CUSTOM_MOBILE_REPORT_DIR || '/tmp/giggle-all-mobile-20261007/custom';
const players = ['Alexandria', 'Bo', 'Cam', 'Dee'].map((name, i) => ({ id: 'p' + i, name, connected: true }));
let live, serial = 0;
function context(id, board) {
  const ctx = { time: 7000000, timers: [], awards: {}, wallet: {},
    now: () => ctx.time, players: () => players.slice(0, id === 'castle-clash' ? 4 : 2),
    allPlayers: () => players.slice(0, id === 'castle-clash' ? 4 : 2),
    settings: () => id === 'chain-reaction' ? { boardSize: board } : id === 'pocket-karts' ? { mode: 'Garage Battle', map: 'Rookie Ring' } : { rounds: 1 },
    content: () => ({}), session: () => ctx.wallet, hostId: () => 'p0', broadcast() {}, lobby() {},
    award(pid, points) { ctx.awards[pid] = (ctx.awards[pid] || 0) + points; },
    later(ms, fn) { const t = { ms, fn, cancelled: false }; ctx.timers.push(t); return () => { t.cancelled = true; }; },
  }; return ctx;
}
function reset(id = 'castle-clash', phase = 'live', board = 'Compact', rematch = false) {
  const def = defs[id], ctx = context(id, board);
  if (rematch) ctx.wallet = live?.ctx.wallet || {};
  const state = def.create(ctx);
  if (id === 'pocket-karts') {
    if (phase !== 'countdown') { ctx.time += 3000; def.onTick(state, ctx); }
    if (phase === 'done' || phase === 'watch-done') {
      const [a, b] = state.karts;
      for (const crate of state.crates) { crate.x = 24; crate.z = -24; }
      Object.assign(a, { weapon: 'scatter', ammo: 1, shield: 0, fireCd: 0, prevAction: false, x: 0, z: -6, angle: 0, speed: 0 });
      Object.assign(b, { x: 0, z: 0, angle: 0, speed: 0, shield: 0 });
      def.onAction(state, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      ctx.time += 100; def.onTick(state, ctx); assert.equal(ctx.wallet.coins.p0, 10);
      Object.assign(a, { x: 20, z: 20, speed: 0 }); Object.assign(b, { x: -20, z: -20, speed: 0 });
      ctx.time = state.endsAt + 1; def.onTick(state, ctx); assert.equal(ctx.wallet.coins.p0, 30);
    } else if (phase === 'drive') Object.assign(state.karts[0], { weapon: 'pulse', ammo: 2, fireCd: 0 });
  } else if (id === 'castle-clash') {
    const supplies = def.view(state, 'p0').supplies;
    ctx.time = supplies.buildStartAt + supplies.cadenceMs + 1000;
    if (phase === 'siege' || phase === 'done' || phase === 'watch-done') {
      const wanted = phase === 'siege' ? 'siege' : 'done';
      let guard = 0;
      while (state.phase !== wanted && guard++ < 10) { const t = ctx.timers.filter(t => !t.cancelled).at(-1); if (!t) break; t.cancelled = true; ctx.time += t.ms; t.fn(); }
    }
  } else if (phase === 'done' || phase === 'watch-done') {
    state.board[0] = { owner: 'p0', orbs: 1 }; state.board[1] = { owner: 'p1', orbs: 1 };
    state.entered.p0 = state.entered.p1 = true;
    def.onAction(state, ctx, 'p0', { x: 0, y: 0, turnNo: state.turnNo }); assert.equal(state.phase, 'done');
  } else if (phase === 'cascade') {
    const cols = state.cols;
    for (let i = 0; i < 2 * cols; i++) {
      const x = i % cols, y = Math.floor(i / cols), degree = (x > 0) + (x < cols - 1) + (y > 0) + (y < state.rows - 1);
      state.board[i] = { owner: 'p0', orbs: degree - 1 };
    }
    state.board.at(-1).owner = 'p1'; state.board.at(-1).orbs = 1;
    state.entered.p0 = state.entered.p1 = true;
  }
  live = { id, phase, board, def, ctx, state, instance: 'custom-mobile-' + (++serial), wall: Date.now(), base: ctx.time };
  return project();
}
function project() {
  const watcher = live.phase.startsWith('watch'), you = watcher ? 'watch' : live.phase === 'wait' ? 'p1' : 'p0';
  return { ...live.def.view(live.state, you), game: live.id, you, me: you, players: live.ctx.players(), spectator: watcher,
    hostId: 'p0', instanceId: live.instance, serverNow: live.ctx.time, totals: live.ctx.awards };
}
const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Custom games mobile QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/castle-immersive.css"><style>html,body{margin:0}#gbody{padding:0;margin:0}.room-menu-panel label{display:block}#qa-status{white-space:pre-wrap;font-size:14px}.room-menu-panel button,.room-menu-panel select{min-height:44px;font-size:16px}#view{min-width:0}#gbody.qa-2d{padding:72px 12px 20px;overflow:auto}</style></head><body class="game-immersive game-playing"><details class="room-menu" id="qa-menu"><summary><span>Mobile QA</span></summary><div class="room-menu-panel"><label>Game<select id="qa-game"><option value="chain-reaction">Chain Reaction</option><option value="pocket-karts">Pocket Karts</option><option value="castle-clash">Castle Clash</option></select></label><label>Phase<select id="qa-phase"><option>live</option><option>drive</option><option>countdown</option><option>siege</option><option>cascade</option><option>wait</option><option>watch</option><option>done</option><option>watch-done</option></select></label><label>Board<select id="qa-board"><option>Compact</option><option>Standard</option></select></label><label><input id="qa-fallback" type="checkbox">Castle fallback</label><button id="qa-load">Load scene</button><button id="qa-run">Check mobile matrix</button><button id="qa-input">Check simultaneous kart controls</button><button id="qa-night">Night</button><p id="qa-status" role="status">Loading…</p></div></details><main id="gbody" data-layout="immersive"><div id="view"></div></main><script type="module">
import { createGameFrame } from '/js/game-frame.js';
const el=document.querySelector('#view'),body=document.querySelector('#gbody'),status=document.querySelector('#qa-status'),menu=document.querySelector('#qa-menu'),by=id=>document.querySelector('#'+id);
let view,S,base=0,generation=0,sent=[];const api={now:()=>S.serverNow+performance.now()-base,context:()=>({isHost:!S.spectator}),send:async a=>{sent.push(a);const n=generation,s=await fetch('/api/action',{method:'POST',body:JSON.stringify(a)}).then(r=>r.json());if(n===generation)apply(s);},announce:()=>{},toast:t=>status.textContent=t,rematch:()=>load(),lobby:()=>{menu.open=true},voice:{subscribe:()=>()=>{}}};
const sleepFrame=()=>new Promise(r=>requestAnimationFrame(r));
async function ready(){const start=performance.now();while(performance.now()-start<5000){if(S.game==='chain-reaction'){if(el.querySelector('iframe')?.contentDocument?.querySelector('.cr-cell'))break;}else{const cv=el.querySelector('.pk-stage canvas,.cc3d-scene canvas');if(cv){const r=cv.getBoundingClientRect();if(r.height>0&&Math.abs(cv.width/cv.height-r.width/r.height)<.04)break;}}await sleepFrame();}await document.fonts.ready;await sleepFrame();await sleepFrame();}
function footer(){by('rematch')?.remove();if(S.phase!=='done'||S.game==='chain-reaction')return;const f=document.createElement('div');f.id='rematch';f.className='row mt';f.innerHTML='<button class="btn" id="bRematch"'+(S.spectator?' disabled':'')+'>Rematch</button><button class="btn ghost" id="bChange"'+(S.spectator?' disabled':'')+'>Change game</button>';body.append(f);by('bRematch').onclick=()=>load(S.game,S.game==='pocket-karts'?'countdown':'live',S.boardSize||'Compact',true);by('bChange').onclick=()=>menu.open=true;}
function apply(s){S=s;base=performance.now();view.update(el,S,api);footer();}
async function load(id=by('qa-game').value,phase=by('qa-phase').value,board=by('qa-board').value,rematch=false){generation++;view?.dispose?.();el.innerHTML='';S=await fetch(rematch?'/api/rematch':'/api/reset?game='+id+'&phase='+phase+'&board='+board).then(r=>r.json());base=performance.now();body.classList.toggle('qa-2d',id==='castle-clash'&&by('qa-fallback').checked);view=id==='chain-reaction'?createGameFrame(id,{type:'frame',entry:'index.html'}):(await import('/js/games/'+(id==='castle-clash'&&by('qa-fallback').checked?'castle-clash-2d':id)+'.js')).default;view.mount(el,api);apply(S);menu.open=false;await ready();sent=[];status.textContent=id+' · '+phase+' · '+board;}
const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
const visible=n=>{if(!n.getClientRects().length||n.closest('[hidden]')||getComputedStyle(n).display==='none')return false;for(let a=n.parentElement;a;a=a.parentElement)if(a.tagName==='DETAILS'&&!a.open&&!a.querySelector(':scope > summary')?.contains(n))return false;return true;};
const assert=(ok,message)=>{if(!ok)throw Error(message)};
function geometry(label){const d=S.game==='chain-reaction'?el.querySelector('iframe').contentDocument:document,w=document.documentElement.clientWidth,h=document.documentElement.clientHeight,root=S.game==='chain-reaction'?d.body:el,out={label,game:S.game,phase:S.phase,watcher:S.spectator,controls:[],canvas:[],checks:0};assert(root.scrollWidth<=root.clientWidth+2,label+' horizontal overflow');out.checks++;
for(const b of root.querySelectorAll('button,summary,[id="pk-stick"]')){if(!visible(b))continue;const r=rect(b);assert(r.width>=43&&r.height>=43,label+' small control '+(b.id||b.textContent.trim())+' '+r.width+'×'+r.height);out.controls.push({id:b.id||b.textContent.trim().slice(0,30),...r});out.checks++;}
for(const n of root.querySelectorAll('canvas')){if(!visible(n))continue;const r=rect(n);assert(r.width>0&&r.height>0,label+' empty canvas');if(n.id!=='pk-radar')assert(Math.abs(n.width/n.height-r.width/r.height)<.04,label+' canvas backing aspect differs');out.canvas.push({...r,pixels:[n.width,n.height]});out.checks++;}
if(S.game==='chain-reaction'){assert(getComputedStyle(root.querySelector('.cr-cell')).touchAction!=='none','Chain blocks vertical scroll');if(S.spectator||label.includes('wait')||S.phase==='done')assert(!root.querySelector('[data-playable="yes"]'),'Chain watcher/wait/done offers moves');out.checks++;}
if(S.game==='pocket-karts'){const touch=el.querySelector('#pk-touch');if(S.spectator||S.phase==='done')assert(touch.hidden,'Kart watcher/results has drive controls');if(S.phase==='done'){const result=rect(el.querySelector('#pk-result')),rematch=rect(by('rematch'));assert(result.y>=55&&result.bottom<=rematch.y-4,'Kart result/garage overlaps rematch or top launchers');out.result=result;out.rematch=rematch;}out.checks++;}
if(S.game==='castle-clash'&&!body.classList.contains('qa-2d')){const belt=el.querySelector('.cc3d-belt'),tools=rect(el.querySelector('.cc3d-tools'));assert(tools.x>=0&&tools.right<=w+1&&tools.bottom<=h+1,'Castle toolbelt outside viewport');if(S.phase!=='done')assert(belt.clientWidth>=72,'Castle toolbelt shows less than one usable slot');if(S.spectator)assert([...belt.querySelectorAll('button')].every(b=>b.disabled),'Castle watcher action enabled');out.tools=tools;out.belt={width:belt.clientWidth,scrollWidth:belt.scrollWidth};out.checks++;}
return out;}
const cases=[['chain-reaction','live','Compact'],['chain-reaction','live','Standard'],['chain-reaction','wait','Standard'],['chain-reaction','watch','Standard'],['chain-reaction','done','Compact'],['chain-reaction','watch-done','Standard'],['pocket-karts','drive'],['pocket-karts','countdown'],['pocket-karts','watch'],['pocket-karts','done'],['pocket-karts','watch-done'],['castle-clash','live'],['castle-clash','siege'],['castle-clash','watch'],['castle-clash','done'],['castle-clash','watch-done']];
by('qa-run').onclick=async()=>{const results=[];for(const [id,phase,board='Compact']of cases){try{await load(id,phase,board);results.push({...geometry(id+' '+phase+' '+board),pass:true});}catch(e){results.push({game:id,label:phase+' '+board,pass:false,error:e.message});}}await fetch('/qa-results',{method:'POST',body:JSON.stringify({viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme||'day',results})});await load('castle-clash','live');status.textContent=results.map(r=>(r.pass?'PASS ':'FAIL ')+r.game+' '+r.label+' '+(r.error||r.checks+' checks')).join('\n');menu.open=true;};
by('qa-input').onclick=async()=>{try{await load('pocket-karts','drive');const stick=el.querySelector('#pk-stick'),gas=el.querySelector('#pk-tg'),drift=el.querySelector('#pk-th'),fire=el.querySelector('#pk-tb'),r=rect(stick);for(const n of [stick,gas,drift,fire]){const held=new Set();n.setPointerCapture=id=>held.add(id);n.hasPointerCapture=id=>held.has(id);n.releasePointerCapture=id=>held.delete(id);}const p=(n,type,id,x=r.x+r.width*.8,y=r.y+r.height*.3)=>n.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===1,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));const last=()=>sent.filter(a=>a.input).at(-1)?.input;let checks=0;p(stick,'pointerdown',1);p(gas,'pointerdown',2);p(drift,'pointerdown',3);p(fire,'pointerdown',4);assert(last()?.steer>0&&last().throttle===1&&last().drift&&last().boost,'Combined stick/gas/drift/fire intent lost');checks++;p(window,'pointerup',2);assert(last()?.steer>0&&last().drift,'Gas release clears another contact');checks++;document.dispatchEvent(new Event('game-screenchange'));assert(last()?.steer===0&&last().throttle===0&&!last().boost&&!last().drift,'Screen change leaves held input');checks++;const n=sent.length;for(const id of [1,2,3,4])p(window,'pointerup',id);assert(sent.length===n,'Stale lifts send extra input');checks++;await load('pocket-karts','watch');const before=sent.length;p(el.querySelector('#pk-stick'),'pointerdown',1);p(el.querySelector('#pk-tg'),'pointerdown',2);assert(sent.length===before,'Watcher sends driving intent');checks++;const result={pass:true,checks,viewport:{width:innerWidth,height:innerHeight}};await fetch('/qa-input-results',{method:'POST',body:JSON.stringify(result)});status.textContent='PASS simultaneous kart controls: '+checks+' checks';}catch(e){status.textContent='FAIL simultaneous controls: '+e.message;}menu.open=true;};
by('qa-load').onclick=()=>load();by('qa-night').onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';const query=new URLSearchParams(location.search);for(const key of ['game','phase','board'])if(query.get(key))by('qa-'+key).value=query.get(key);await load();
</script></body></html>`;
function createServer() { return http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');try{
  if(u.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(PAGE);}
  if(u.pathname.startsWith('/qa-')&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,u.pathname.slice(1)+'-'+data.viewport.width+'x'+data.viewport.height+'-'+(data.theme||'day')+'.json'),JSON.stringify(data,null,2));return res.end('saved');}
  if(u.pathname.startsWith('/api/')){let s;if(u.pathname==='/api/reset')s=reset(u.searchParams.get('game')||'castle-clash',u.searchParams.get('phase')||'live',u.searchParams.get('board')||'Compact');else if(u.pathname==='/api/rematch')s=reset(live.id,live.id==='pocket-karts'?'countdown':'live',live.board,true);else if(u.pathname==='/api/action'){let raw='';for await(const chunk of req)raw+=chunk;live.ctx.time=live.base+Date.now()-live.wall;if(!live.phase.startsWith('watch'))live.def.onAction(live.state,live.ctx,'p0',JSON.parse(raw));s=project();}else s=project();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(s));}
  let file=u.pathname.startsWith('/game-assets/chain-reaction/')?path.resolve(ROOT,'games/chain-reaction/browser',u.pathname.slice('/game-assets/chain-reaction/'.length)):path.resolve(ROOT,'public','.'+u.pathname);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end('Not found');}res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.glb':'model/gltf-binary'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
}catch(e){res.statusCode=500;res.end(String(e.stack));}});}
module.exports={createServer,reset,project};
if(require.main===module)createServer().listen(Number(process.env.PORT||8171),'127.0.0.1',()=>console.log('CUSTOM_MOBILE_QA http://127.0.0.1:'+(process.env.PORT||8171)));
