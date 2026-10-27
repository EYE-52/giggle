'use strict';
// Browser fixture: actual module host + actual Room/WebSocket authority.
// QA routes own disposable rooms only; no game state is injected by the hub.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { Room } = require('../server/room');
const defs = { reversi: require('../games/reversi/server'), 'four-in-a-row': require('../games/four-in-a-row/server') };
const publicRoot = path.resolve(__dirname, '../public');
const directory = process.env.BOARD_REPORT_DIR || '/tmp/giggle-board-games-20261007';
function createSession(id) {
  const game = defs[id]; if (!game) throw Error('Unknown board game');
  const room = new Room('BQ' + (id === 'reversi' ? 'R' : 'F'), {});
  const bot = () => ({ readyState:1,bufferedAmount:0,send(){},close(){} });
  const a = room.addPlayer('AlexandertheGreat',bot()).player, b = room.addPlayer('BeatrixLongName',bot()).player;
  const earlier = room.addPlayer('Early watcher',bot()).player;
  const started = room.startGame(game, {}, a.id); if (!started.ok) throw Error(started.error);
  const watcher = room.addPlayer('Late watcher',bot()).player;
  return { room, game, roles: { a,b,watcher,earlier } };
}
function clientPage() { return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board game client QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><style>body{padding:0;margin:0}.board-fixture-shell{position:fixed;top:10px;left:12px;z-index:40;border-radius:10px;background:#18202bf5;color:#f5f7fb;min-width:96px;height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font:700 14px system-ui;border-bottom:1px solid #829a9b33}.board-fixture-shell small{font:500 12px system-ui}#client-tools{display:flex;gap:8px;align-items:center;padding:4px 12px;font:13px system-ui}#client-tools button{min-height:44px;font:inherit}.app{width:100%;max-width:1100px;padding:0;margin:0 auto}.game-stage{padding:0}#gbody{min-width:0;width:100%}#fixture-rematch{display:flex;justify-content:center;gap:8px;margin-top:10px}#fixture-rematch button{font:700 14px system-ui;min-height:44px;padding:10px 16px}[hidden]{display:none!important}.qa-reduced .board-duel *{animation:none!important;transition:none!important}</style><body class="game-playing game-immersive"><div class="board-fixture-shell"><b id="game-name"></b><small>Room QA</small></div><div id="client-tools"><span id="role"></span><button id="reconnect">Reconnect</button><span id="connection"></span></div><main class="app" data-layout="immersive"><div class="game-stage"><div id="gbody" data-layout="immersive"></div><div id="fixture-rematch" hidden><button id="rematch">Rematch</button></div></div></main><script type="module">
import {show,reset} from '/js/game-host.js';
const params=new URLSearchParams(location.search),role=params.get('role')||'a',session=params.get('session'),game=params.get('game')||'reversi',el=document.getElementById('gbody'),sent=[],presented=[];
if(params.get('theme')==='night')document.documentElement.dataset.theme='night';
if(params.get('motion')==='reduce'){document.documentElement.classList.add('qa-reduced');const media=window.matchMedia.bind(window);window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true}:media(q);}
if(params.get('scene')==='1')document.getElementById('client-tools').hidden=true;
document.getElementById('game-name').textContent=game==='reversi'?'Reversi':'Four in a Row';document.getElementById('role').textContent=role;
let socket,S=null,roomHost=null,active=true,resolveReady;const ready=new Promise(r=>resolveReady=r);
const api={context:()=>({isHost:roomHost===S?.me}),send:a=>{sent.push(a);socket?.readyState===1&&socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w}));},focus:n=>n?.focus({preventScroll:true}),resultsReady:id=>presented.push(id),rematch:()=>socket.send(JSON.stringify({t:'qa-rematch'})),now:()=>Date.now()};
async function styles(){await Promise.all([...document.querySelectorAll('link')].filter(l=>!l.sheet).map(l=>new Promise(r=>{l.onload=r;l.onerror=r})));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(r));}
async function connect(){active=true;return new Promise((resolve,reject)=>{socket=new WebSocket('ws://'+location.host+'/socket');socket.onopen=()=>socket.send(JSON.stringify({t:'join',session,role}));socket.onerror=reject;socket.onmessage=async e=>{const m=JSON.parse(e.data);if(m.t==='room'){roomHost=m.room.hostId;if(active&&S)await show(el,game,S,api);}if(m.t==='state'){S={...m,me:m.you};if(active)await show(el,game,S,api);await styles();document.getElementById('fixture-rematch').hidden=true;document.getElementById('rematch').disabled=roomHost!==S.me;resolveReady();resolve();}if(m.t==='qa-error')document.getElementById('connection').textContent=m.message;};});}
window.qa={ready,sent,presented,el,api,get state(){return S},get socket(){return socket},async reconnect(){active=false;reset();socket.close();await new Promise(r=>setTimeout(r,20));await connect()},raw(a,meta={}){socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w,...meta}));},command:t=>socket.send(JSON.stringify({t})),dispose(){active=false;reset();socket.close()}};
document.getElementById('reconnect').onclick=()=>window.qa.reconnect();document.getElementById('rematch').onclick=api.rematch;
window.addEventListener('pagehide',()=>window.qa.dispose());await connect();
</script></html>`; }
function hubPage() { return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reversi and Four in a Row QA</title><style>body{font:16px/1.5 system-ui;margin:16px;background:#edf0f2;color:#243241}button,select{min-height:44px;font:inherit;padding:8px 12px}#tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#clients{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}iframe{display:block;border:1px solid #899ba5;border-radius:4px;width:390px;height:660px;max-width:100%}article{max-width:100%}article h2{font-size:15px;margin:4px 0}#status{white-space:pre-wrap}a{color:#194b92}#scenes{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}</style><div id="tools"><select id="game"><option value="reversi">Reversi</option><option value="four-in-a-row">Four in a Row</option></select><select id="theme"><option>day</option><option>night</option></select><button id="fresh">Fresh room</button><button id="run">Run board checks</button><button id="matrix">Run viewport matrix</button><span id="dims"></span></div><div id="scenes"></div><pre id="status"></pre><div id="clients"></div><script>
const roles=['a','b','watcher'],frames={},rows=[];let session,game;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));function assert(v,m){if(!v)throw Error(m)}function pass(m){rows.push(m);document.getElementById('status').textContent=rows.join('\n')}
async function until(fn,m){for(let n=0;n<250;n++){if(fn())return;await sleep(12)}throw Error(m)}
function q(role){return frames[role].contentWindow.qa}function node(role,s){const n=q(role).el.querySelector(s);assert(n,role+' missing '+s);return n}function click(role,s){node(role,s).dispatchEvent(new frames[role].contentWindow.MouseEvent('click',{bubbles:true}));}
async function fresh(id=document.getElementById('game').value,motion='normal'){
 for(const f of Object.values(frames))f.contentWindow.qa?.dispose();game=id;session=(await(await fetch('/session?game='+game)).json()).session;
 document.getElementById('clients').innerHTML=roles.map(role=>'<article><h2>'+role+'</h2><iframe data-role="'+role+'" src="/client?scene=1&game='+game+'&session='+session+'&role='+role+'&theme='+document.getElementById('theme').value+'&motion='+motion+'"></iframe></article>').join('');
 roles.forEach(role=>frames[role]=document.querySelector('[data-role='+role+']'));await until(()=>roles.every(r=>q(r)?.state),'clients connect');await Promise.all(roles.map(r=>q(r).ready));
 document.getElementById('scenes').innerHTML=roles.map(role=>'<a target="_blank" href="/client?scene=1&game='+game+'&session='+session+'&role='+role+'&theme='+document.getElementById('theme').value+'">Open '+role+' scene</a>').join('');return session;
}
async function action(role,move){const rev=q(role).state.rev;click(role,game==='reversi'?'[data-cell="'+move+'"]':'[data-column="'+move+'"]');await until(()=>roles.every(r=>q(r).state.rev>rev),'move acknowledged');}
async function run(){rows.length=0;try{
 for(const id of ['reversi','four-in-a-row']){
 await fresh(id);assert(q('watcher').state.spectator,'watcher gate');assert(q('watcher').state.legal.length===0,'watcher legal hints');assert(q('b').state.legal.length===0,'waiting seat hints');
 const selector=id==='reversi'?'[data-cell="19"]':'[data-column="3"]';click('watcher',selector);click('b',selector);assert(q('watcher').sent.length===0&&q('b').sent.length===0,'inactive actions sent');
 if(id==='reversi')assert(q('a').el.querySelectorAll('.rv-legal').length===4&&q('watcher').el.querySelectorAll('.rv-legal').length===0,'legal dots current seat only');
 else {node('watcher','[data-column="3"]').dispatchEvent(new frames.watcher.contentWindow.PointerEvent('pointermove',{bubbles:true,pointerType:'mouse'}));assert(!q('watcher').el.querySelector('.fr-preview.is-visible'),'watcher preview');}
 const focus=node('a',selector);focus.focus();const W=frames.a.contentWindow;focus.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));const cursor=q('a').el.querySelector('[tabindex="0"]');assert(cursor!==focus,'keyboard cursor moved');cursor.dispatchEvent(new W.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));const current=q('a').el.querySelector('[tabindex="0"]');current.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));current.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert(q('a').sent.length===1,'pending dedupes rapid Enter');await until(()=>roles.every(r=>q(r).state.rev===1),'keyboard authority');assert(roles.every(r=>JSON.stringify(q(r).state.board)===JSON.stringify(q('a').state.board)),'boards differ');assert(frames.a.contentDocument.activeElement===node('a',selector),'keyboard focus lost after accepted move');pass(id+': keyboard focus continuity, rapid tap, shared board and watcher controls PASS');
 click('b','[data-resign]');assert(!node('b','.bk-row-confirm').hidden,'resign confirm absent');click('b','[data-keep]');assert(q('b').sent.length===0,'cancel sends resignation');click('b','[data-resign]');click('b','[data-confirm-resign]');await until(()=>roles.every(r=>q(r).state.phase==='done'),'resign done');await until(()=>q('a').presented.length===1,'resign readiness');assert(q('a').state.result.winnerPid===q('a').state.me,'resign winner');
 const initialDoneCount=q('watcher').presented.length;await q('watcher').reconnect();await sleep(50);assert(q('watcher').presented.length===initialDoneCount,'reconnect replays readiness');pass(id+': confirm/cancel resign, result readiness, done reconnect PASS');
 const old=q('a').state.instanceId,oldWindow=q('a').state.w;assert(!node('a','[data-rematch]').disabled,'actual-context host cannot rematch');assert(node('b','[data-rematch]').disabled&&node('watcher','[data-rematch]').disabled,'non-host rematch enabled');click('a','[data-rematch]');await until(()=>roles.every(r=>q(r).state.instanceId!==old),'rematch');assert(q('a').state.rev===0,'rematch revision');q('a').raw(id==='reversi'?{place:19,rev:0}:{drop:3,rev:0},{i:old,w:oldWindow});await sleep(50);assert(q('a').state.rev===0,'old instance changed board');
 const started=q('a').presented.length;let moves=0;
 if(id==='reversi'){while(q('a').state.phase==='play'&&moves<64){const role=q('a').state.turn===1?'a':'b';await action(role,q(role).state.legal[(moves*7)%q(role).state.legal.length]);moves++;}}
 else {for(const col of [0,6,1,6,2,5,3]){const role=q('a').state.turn===1?'a':'b';await action(role,col);moves++;}assert(!node('a','.fr-board').classList.contains('fr-settled'),'winning glow shown before drop settles');}
 await until(()=>roles.every(r=>q(r).state.phase==='done'),'complete match');await until(()=>q('a').presented.length===started+1,'animation presentation gate');if(id!=='reversi')assert(node('a','.fr-board').classList.contains('fr-settled'),'drop never settles');
 const before=q('a').sent.length;click('a',selector);assert(q('a').sent.length===before,'done board sends');pass(id+': complete legal match ('+moves+' moves), delayed final animation, stale rematch, done gate PASS');
 q('a').socket.close();await until(()=>!node('b','[data-rematch]').disabled,'host migration never enables result controls');assert(node('watcher','[data-rematch]').disabled,'watcher stole host role');pass(id+': real Room host migration updates result controls without a state hostId PASS');
 await fresh(id,'reduce');click('a','[data-resign]');click('a','[data-confirm-resign]');await until(()=>q('a').state.phase==='done'&&q('a').presented.length===1,'reduced motion readiness');pass(id+': reduced-motion result boundary PASS');
 }
 await fetch('/results?name=browser-actions',{method:'POST',body:JSON.stringify({pass:true,rows,dimensions:[innerWidth,innerHeight],physicalDevice:false})});pass('ALL BOARD CLIENT CHECKS PASS');
 }catch(error){pass('FAIL '+error.message);await fetch('/results?name=browser-actions',{method:'POST',body:JSON.stringify({pass:false,rows,error:error.message,dimensions:[innerWidth,innerHeight]})});throw error;}}
async function matrix(){const issues=[],scenes=[];let checks=0;
 async function record(phase){for(const role of roles){const f=frames[role];f.style.width=innerWidth+'px';f.style.maxWidth='none';f.style.height=innerHeight+'px';await sleep(35);const d=f.contentDocument,w=f.contentWindow,root=q(role).el,svg=root.querySelector('svg'),r=svg.getBoundingClientRect();checks++;if(d.documentElement.scrollWidth>w.innerWidth+1)issues.push(game+' '+role+' '+phase+' horizontal overflow');checks++;if(r.width<100||r.height<100)issues.push(game+' '+role+' board collapsed');const controls=[];for(const button of root.querySelectorAll('button:not([hidden]),summary')){if(!button.getClientRects().length)continue;const b=button.getBoundingClientRect();checks++;if(b.height<43)issues.push(game+' '+role+' short '+button.textContent);controls.push({name:button.textContent.trim(),rect:[b.x,b.y,b.width,b.height]});}const hit=root.querySelector(game==='reversi'?'.rv-hit':'.fr-hit').getBoundingClientRect();checks++;if(w.innerWidth===390&&w.innerHeight>500&&hit.width<44)issues.push(game+' '+role+' portrait board target below44');scenes.push({game,role,phase,viewport:[w.innerWidth,w.innerHeight],board:[r.x,r.y,r.width,r.height],hit:[hit.width,hit.height],controls,status:root.querySelector('.bk-status').textContent});}}
 for(const id of ['reversi','four-in-a-row']){await fresh(id);await record('opening');await action('a',id==='reversi'?19:3);await record('mid');click('a','[data-resign]');await record('confirm');click('a','[data-confirm-resign]');await until(()=>roles.every(r=>q(r).state.phase==='done'),'matrix result');await record('done');}
 const result={pass:!issues.length,checks,issues,scenes,dimensions:[innerWidth,innerHeight],physicalDevice:false};await fetch('/results?name=matrix-'+innerWidth+'x'+innerHeight+'-'+document.getElementById('theme').value,{method:'POST',body:JSON.stringify(result)});document.getElementById('status').textContent=JSON.stringify(result,null,2);return result;}
document.getElementById('fresh').onclick=()=>fresh();document.getElementById('run').onclick=run;document.getElementById('matrix').onclick=matrix;document.getElementById('dims').textContent=innerWidth+' × '+innerHeight;window.qa={fresh,run,matrix,frames};fresh();
</script></html>`; }
function createServer() {
  const sessions = new Map();
  const server = http.createServer((req,res) => {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/session'){try{const id=url.searchParams.get('game')||'reversi',session=randomUUID();sessions.set(session,createSession(id));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({session,game:id}));}catch(e){res.statusCode=400;res.end(e.message)}return;}
    if(url.pathname==='/close'&&req.method==='POST'){sessions.get(url.searchParams.get('session'))?.room.destroy();sessions.delete(url.searchParams.get('session'));res.end('closed');return;}
    if(url.pathname==='/results'&&req.method==='POST'){let body='';req.on('data',d=>body+=d);req.on('end',()=>{try{const name=url.searchParams.get('name');if(!/^[a-z0-9-]+$/.test(name))throw Error('Bad result name');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify(JSON.parse(body),null,2));res.end('saved')}catch(e){res.statusCode=400;res.end(e.message)}});return;}
    if(url.pathname==='/'||url.pathname==='/client'){res.setHeader('Content-Type','text/html');res.end(url.pathname==='/client'?clientPage():hubPage());return;}
    const file=path.resolve(publicRoot,'.'+url.pathname);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('Not found');return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));
  });
  const wss=new WebSocketServer({server,path:'/socket'});
  wss.on('connection',ws=>{let session=null;ws.on('message',text=>{try{const m=JSON.parse(text);
    if(m.t==='join'){session=sessions.get(m.session);if(!session?.roles[m.role])throw Error('Room is unavailable');const seat=session.roles[m.role];session.room.addPlayer(seat.name,ws,seat.token);session.room.broadcastLobby();session.room.broadcastState();}
    else if(session&&m.t==='action'){session.room.onAction(ws,m.a,{i:m.i,w:m.w});ws.send(JSON.stringify({t:'qa-ack',rev:session.room.game.state.rev}));}
    else if(session&&m.t==='qa-rematch'){const p=session.room.bySocket(ws),r=session.room.startGame(session.game,{},p?.id);if(!r.ok)throw Error(r.error);}
  }catch(e){ws.send(JSON.stringify({t:'qa-error',message:e.message}));}});ws.on('close',()=>session?.room.disconnect(ws));});
  server.on('close',()=>{for(const session of sessions.values())session.room.destroy();wss.close();});return server;
}
module.exports={createServer,createSession};
if(require.main===module)createServer().listen(Number(process.env.BOARD_QA_PORT||8357),'127.0.0.1',()=>console.log('Board QA http://127.0.0.1:'+Number(process.env.BOARD_QA_PORT||8357)+'/'));
