'use strict';
// Isolated local acceptance surface. Native browser controls send production
// client payloads through real Room/WebSocket handling. Buttons outside the
// iframe are visibly QA-only; peer/clock commands are controlled engine prep.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { WebSocketServer } = require('ws');
const { Room } = require('../server/room');
const { auditTextContrast } = require('./live-text-contrast');
const { ids, fixtures, denseFixtures, Clock } = require('./word-worlds-fixtures');
const publicRoot = path.resolve(__dirname, '../public');
const evidence = process.env.WORD_QA_REPORT_DIR || '/tmp/giggle-word-worlds-20261007';

function wrapper() { return `<!doctype html><meta charset="utf-8"><title>Six word worlds — local acceptance</title><style>body{margin:0;background:#273b40;color:white;font:16px Arial}header{padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}button,select{min-height:44px;font:16px Arial;padding:7px}iframe{display:block;border:0;margin:0 auto;background:#eee}pre{margin:5px;padding:5px;font-size:15px;white-space:pre-wrap}</style><header><label>Game <select id="game">${ids.map(id => `<option>${id}</option>`).join('')}</select></label><button data-size="1280,800">Desktop 1280</button><button data-size="1024,600">Low laptop 1024×600</button><button data-size="1024,768">Laptop 1024</button><button data-size="390,844">Phone 390</button><button data-size="844,390">Landscape 844</button><button data-size="568,320">Landscape 568</button><button id="theme">Day / Night</button><button id="checks">Check phases & layout</button><button id="live">Live Room</button><button id="peer">Peer action</button><button id="clock">Advance QA clock</button><button id="snapshot">Repeat snapshot</button><button id="watch">Watch / play</button></header><iframe id="world" width="1280" height="800" title="Full game viewport"></iframe><pre id="result">Local acceptance only. Game inputs below use the real client and Room.</pre><script>const frame=document.querySelector('#world'),game=document.querySelector('#game'),result=document.querySelector('#result');const params=new URLSearchParams(location.search);if([...game.options].some(o=>o.value===params.get('game')))game.value=params.get('game');function load(){frame.src='/view?game='+game.value+'&state='+(params.get('state')||'0')+'&dense='+(params.get('dense')||'0')+'&theme='+(params.get('theme')||'day')+'&v='+Date.now()}load();game.onchange=load;for(const b of document.querySelectorAll('[data-size]'))b.onclick=()=>{const[w,h]=b.dataset.size.split(',');frame.width=w;frame.height=h;result.textContent='Actual iframe '+w+'×'+h;};for(const command of ['checks','live','peer','clock','snapshot','watch','theme'])document.querySelector('#'+command).onclick=()=>frame.contentWindow.postMessage({qa:command},location.origin);window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.report)result.textContent=e.data.report});</script>`; }

function viewPage() { return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live word game acceptance</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><style>body{margin:0;padding:0}#gbody{min-width:0}#qa-status{display:none}#shared-clock[hidden]{display:none}html[data-art-failed=true] body{background-image:url("/assets/word-worlds/intentional-missing-qa.webp")!important}</style><body class="game-playing"><div class="app" id="app"><header class="play-toolbar"><div class="play-title"><div><h1 id="game-name"></h1><span class="play-status" id="play-role" hidden>Watching</span></div></div><details class="room-menu"><summary aria-label="Room controls">Room</summary><div class="room-menu-panel">Isolated local QA room</div></details></header><main class="game-stage"><div class="game-clock" id="shared-clock"><div class="timerbar" id="tbar"><div></div></div><div class="timertext" id="ttime" aria-label="Round time"></div></div><div id="gbody" data-layout="standard"></div></main></div><pre id="qa-status"></pre><script type="module">
const auditTextContrast=${auditTextContrast.toString()};
const ids=${JSON.stringify(ids)},normal=${JSON.stringify(fixtures)},dense=${JSON.stringify(denseFixtures)};
const params=new URLSearchParams(location.search),id=ids.includes(params.get('game'))?params.get('game'):'scattergories',el=document.querySelector('#gbody');
const modules={},inputs={scattergories:'#sc0','word-chain':'#wcWord','countdown-word':'#cwWord','lyric-fill':'#lfText','number-hunt':'#nGuess','warm-words':'[data-ww-input]'};
let view=null,S=null,socket=null,live=false,clockOffset=0,watching=false,clockWindow='',clockDuration=1;
const api={send:a=>{if(live&&socket?.readyState===1)socket.send(JSON.stringify({t:'action',a,i:S.instanceId,w:S.w}));},now:()=>live&&S?.serverNow?S.serverNow:Date.now()+clockOffset,focus:n=>n?.focus(),announce:()=>{},toast:()=>{},sound:()=>{},voice:{state:()=>({enabled:false}),subscribe:()=>()=>{}}};
const report=data=>{const value=typeof data==='string'?data:JSON.stringify(data,null,2);document.querySelector('#qa-status').textContent=value;parent.postMessage({report:value},location.origin);};
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const visible=n=>{const r=n.getBoundingClientRect(),c=getComputedStyle(n);return r.width&&r.height&&c.display!=='none'&&c.visibility!=='hidden';};
async function styles(){await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.sheet?Promise.resolve():new Promise(resolve=>{l.onload=resolve;l.onerror=resolve})));await document.fonts.ready;await nextFrame();}
async function module(game){return modules[game]||=(await import('/js/games/'+game+'.js?v='+Date.now())).default;}
function sharedClock(){const hidden=view.ownsTimer===true||!S.endsAt||/^(done|reveal|result|results|score|scores)$/.test(S.phase);document.querySelector('#shared-clock').hidden=hidden;if(!hidden){const seconds=Math.max(0,Math.ceil((S.endsAt-api.now())/1000));document.querySelector('#ttime').textContent=seconds+'s';const windowKey=S.instanceId+'|'+S.endsAt;if(clockWindow!==windowKey){clockWindow=windowKey;clockDuration=Math.max(1,S.endsAt-(S.phaseStartedAt||api.now()));}document.querySelector('#tbar>div').style.width=Math.min(100,Math.max(0,(S.endsAt-api.now())/clockDuration*100))+'%';}document.querySelector('#play-role').hidden=!S.spectator;}
function paint(state){S=state;(view.update||view.render).call(view,el,S,api);sharedClock();}
function projection(game,index,maximum){const state=JSON.parse(JSON.stringify((maximum?dense:normal)[game][index].state)),shift=Date.now()-state.serverNow;for(const key of ['endsAt','startAt','clockStamp','phaseStartedAt'])if(state[key]>0)state[key]+=shift;state.serverNow=Date.now();return state;}
async function criticalStyles(v){await Promise.all((v.styles||[]).map(href=>{let link=[...document.querySelectorAll('link[rel=stylesheet]')].find(l=>l.getAttribute('href')===href);if(link?.sheet)return Promise.resolve();return new Promise((resolve,reject)=>{if(!link){link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);}link.addEventListener('load',resolve,{once:true});link.addEventListener('error',()=>reject(Error('Required stylesheet '+href)),{once:true});});}));}
async function mount(game,index=0,maximum=false){view?.dispose?.(el);el.innerHTML='';view=await module(game);await criticalStyles(view);view.mount?.(el,api);clockOffset=0;paint(projection(game,index,maximum));document.querySelector('#game-name').textContent=game.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());await styles();scrollTo(0,0);return view;}
function metrics(game,label){const contrast=auditTextContrast(el),errors=contrast.errors.map(e=>'Contrast '+JSON.stringify(e)),r=el.getBoundingClientRect();if(el.scrollWidth>el.clientWidth+2)errors.push('Scene width '+el.scrollWidth+'/'+el.clientWidth);for(const n of el.querySelectorAll('button,input,summary')){if(!visible(n))continue;const b=n.getBoundingClientRect();if(b.left<r.left-2||b.right>r.right+2)errors.push('Outside scene: '+(n.id||n.className));if(b.height<43||b.width<43)errors.push('Under 44px: '+(n.id||n.className)+' '+b.width+'×'+b.height);if(n.matches('input')&&parseFloat(getComputedStyle(n).fontSize)<16)errors.push('Small input: '+n.id);}const categoryFields=[];for(const field of el.querySelectorAll('.sk-field')){const text=field.querySelector('label span'),input=field.querySelector('input');if(!text||!input)continue;const range=document.createRange();range.selectNodeContents(text);const b=input.getBoundingClientRect(),rects=[...range.getClientRects()];if(rects.some(t=>Math.min(t.right,b.right)-Math.max(t.left,b.left)>1&&Math.min(t.bottom,b.bottom)-Math.max(t.top,b.top)>1))errors.push('Category label overlaps answer: '+input.id);categoryFields.push({category:text.textContent,textRects:rects.map(t=>({x:t.x,y:t.y,width:t.width,height:t.height})),input:{x:b.x,y:b.y,width:b.width,height:b.height}});}const primary=el.querySelector({'scattergories':'#scLock,#sNext','word-chain':'#wcGo,#wcCh','countdown-word':'#cwLock,#cwNext','lyric-fill':'#lfGo,#lNext','number-hunt':'#nSend','warm-words':'[data-ww-form] button,[data-ww-next]'}[game]),p=primary?.getBoundingClientRect();return{game,label,phase:S.phase,spectator:S.spectator,viewport:{width:innerWidth,height:innerHeight},documentHeight:document.documentElement.scrollHeight,scrollY,primaryEnabled:!!primary&&!primary.disabled,scene:{x:r.x,y:r.y,width:r.width,height:r.height},primary:p&&{x:p.x,y:p.y,width:p.width,height:p.height,inInitialViewport:p.top>=0&&p.bottom<=innerHeight},categoryFields,contrast,errors};}
function privacy(game){if(['write','make','fill'].includes(S.phase)){assert(Object.keys(S.answers||{}).length===0,game+' peer answers exposed');assert(!el.textContent.includes('PRIVATE_PEER_ANSWER'),game+' peer answer in DOM');}if(game==='lyric-fill'&&S.phase==='fill')assert(!('answer'in S.line),'lyric answer exposed');if(game==='number-hunt'&&['hunt','overtime'].includes(S.phase))assert(!('secret'in S),'number secret exposed');if(game==='warm-words'&&S.phase==='guess')assert(!('target'in S),'warm target exposed');if(S.spectator)for(const n of el.querySelectorAll('input'))assert(n.disabled||n.readOnly,game+' watcher input writable');}
async function contracts(){const results=[];live=false;socket?.close();socket=null;for(const game of ids){let checks=0;const states=[];try{for(const maximum of [false,true]){const list=maximum?dense[game]:normal[game];for(let i=0;i<list.length;i++){await mount(game,i,maximum);privacy(game);checks++;const m=metrics(game,list[i].label+(maximum?' · 20 players/custom':'') );states.push(m);assert(!m.errors.length,game+' '+m.label+': '+m.errors.join(', '));checks++;if(m.primaryEnabled){assert(m.primary.inInitialViewport,game+' '+m.label+' primary below first viewport');checks++;}const input=el.querySelector(inputs[game]);if(input&&!input.disabled){input.value=game==='number-hunt'?'63':'a steady draft';input.focus();const start=input.selectionStart;paint({...S,qaRepeated:true});assert(el.querySelector(inputs[game])===input&&input.value===(game==='number-hunt'?'63':'a steady draft')&&document.activeElement===input,game+' draft/node/focus changed on snapshot');if(input.type!=='number')assert(input.selectionStart===start,game+' caret changed');checks++;}}}
 await mount(game);const artFlag=document.documentElement.dataset.artFailed,artInput=el.querySelector(inputs[game]);document.documentElement.dataset.artFailed='true';const missing=new Image();const failed=await new Promise(resolve=>{missing.onload=()=>resolve(false);missing.onerror=()=>resolve(true);missing.src='/assets/word-worlds/intentional-missing-qa.webp';});assert(failed&&getComputedStyle(document.body).backgroundImage.includes('intentional-missing-qa'),'failed art fixture did not fail');assert(!metrics(game,'Missing art').errors.length&&el.querySelector(inputs[game])===artInput,'failed art changed controls');document.documentElement.dataset.artFailed=artFlag;checks+=2;
 if(game==='scattergories'){await mount(game);assert(el.querySelectorAll('.sk-field input').length===5,'five categories required');checks++;}
 if(game==='countdown-word'){await mount(game);const tileC=[...el.querySelectorAll('[data-letter=C]')];tileC[0].click();assert(tileC.filter(t=>t.disabled).length===1,'first duplicate consumed once');tileC.find(t=>!t.disabled).click();assert(tileC.every(t=>t.disabled),'second duplicate consumed once');el.querySelector('#cwBack').click();assert(tileC.filter(t=>t.disabled).length===1,'backspace restores one duplicate');checks+=3;}
 if(game==='word-chain'){await mount(game);const first=JSON.parse(JSON.stringify(S)),draft=el.querySelector('#wcWord');draft.value='a steady draft';paint({...S,myFeedback:{ok:false,message:'Try again'}});assert(el.querySelector('#wcWord')===draft&&draft.value==='a steady draft','rejection changed composer');assert(el.querySelector('.sk-current .w').textContent===first.current,'rejection changed the live word');const accepted=projection(game,normal[game].findIndex(f=>f.label==='Accepted link'),false);paint(accepted);assert(el.querySelector('.sk-current .w').textContent===accepted.current&&el.querySelector('.sk-ribbon').textContent.includes(accepted.current),'accepted link missing from live text');const nextInput=el.querySelector('#wcWord');if(nextInput)nextInput.value='draft after link';paint(accepted);assert(el.querySelector('#wcWord')===nextInput,'repeated snapshot recreated composer');paint({...accepted,used:accepted.used.slice(0,-1),current:first.current});assert(el.querySelector('.sk-current .w').textContent===first.current&&el.querySelector('#wcWord')===nextInput,'challenge rollback lost live word or composer');checks+=5;await mount(game,dense[game].findIndex(f=>f.label.startsWith('Long route')),true);assert(el.querySelectorAll('#wcArchive li').length===50,'archive page not bounded');const total=S.used.length;el.querySelector('#wcOlder').click();assert(el.querySelector('#wcArchive ol').start===Math.max(1,total-99),'earlier page missing');checks+=2;const roster=el.querySelector('.wc-roster');assert(roster&&!roster.open,'roster must be compact by default');assert(el.querySelectorAll('.sk-seat').length===20&&S.players.every(p=>roster.textContent.includes(p.name)),'full names missing from roster');roster.open=true;paint({...S,qaRepeated:true});assert(roster.open&&el.querySelector('.wc-roster')===roster,'snapshot collapsed or replaced roster');checks+=3;}
 if(game==='warm-words'){await mount(game);el.querySelector('[data-ww-sort]').click();paint({...S,me:'watcher',spectator:true});assert(el.querySelector('[data-ww-sort]').textContent==='Newest first','sort label disagrees after role change');privacy(game);checks+=2;}
 results.push({game,pass:true,checks,states});}catch(error){results.push({game,pass:false,error:error.message,checks,states});}report(results.map(r=>(r.pass?'PASS ':'FAIL ')+r.game+' '+(r.error||r.checks+' contract checks')).join('\n'));}
 await fetch('/evidence',{method:'POST',body:JSON.stringify({kind:'contracts',theme:document.documentElement.dataset.theme||'day',viewport:{width:innerWidth,height:innerHeight},results})});await mount(id,Number(params.get('state'))||0,params.get('dense')==='1');report(results.map(r=>(r.pass?'PASS ':'FAIL ')+r.game+' '+(r.error||r.checks+' contract checks')).join('\n'));}
async function liveRoom(){view?.dispose?.(el);el.innerHTML='';view=await module(id);view.mount?.(el,api);socket?.close();socket=new WebSocket('ws://'+location.host+'/socket');live=true;socket.onopen=()=>socket.send(JSON.stringify({t:'prepare',id}));socket.onmessage=async event=>{const m=JSON.parse(event.data);if(m.t==='state'){clockOffset=m.serverNow-Date.now();paint({...m,me:m.you,hostId:m.hostId||S?.hostId});document.querySelector('#game-name').textContent=id.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());}if(m.t==='prepared'){await styles();scrollTo(0,0);report('Live Room ready: '+id+'; actual '+innerWidth+'×'+innerHeight);}if(m.t==='qa-ack'){const result={game:id,kind:'native-action',action:m.action,changed:m.changed,phase:m.phase,viewport:{width:innerWidth,height:innerHeight}};report((m.changed?'Room changed: ':'Room unchanged: ')+JSON.stringify(result));fetch('/evidence',{method:'POST',body:JSON.stringify(result)});}if(m.t==='qa-error')report(m.error);};}
window.addEventListener('message',event=>{if(event.origin!==location.origin||!event.data?.qa)return;const command=event.data.qa;if(command==='theme'){document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';report(metrics(id,'Theme'));}else if(command==='checks')contracts();else if(command==='live')liveRoom();else if(command==='watch'){watching=!watching;socket?.send(JSON.stringify({t:'watch',watching}));}else if(['peer','clock','snapshot'].includes(command))socket?.send(JSON.stringify({t:command}));});
document.documentElement.dataset.theme=params.get('theme')||'day';document.documentElement.dataset.artFailed=params.get('art')==='failed'?'true':'false';await mount(id,Number(params.get('state'))||0,params.get('dense')==='1');report(metrics(id,'Initial'));if(params.get('live')==='1')await liveRoom();
</script></html>`; }

function createServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/view') { res.setHeader('Content-Type', 'text/html'); res.end(url.pathname === '/' ? wrapper() : viewPage()); return; }
    if (url.pathname === '/evidence' && req.method === 'POST') {
      let body = ''; req.on('data', data => { body += data; }); req.on('end', () => { try { const data = JSON.parse(body); fs.mkdirSync(evidence, { recursive: true }); const filename = data.kind === 'contracts' ? `contracts-${data.viewport.width}x${data.viewport.height}${data.theme==='night'?'-night':''}.json` : 'native-actions.jsonl'; if (data.kind === 'contracts') fs.writeFileSync(path.join(evidence, filename), JSON.stringify(data, null, 2)); else fs.appendFileSync(path.join(evidence, filename), JSON.stringify(data) + '\n'); res.end('Saved'); } catch (error) { res.statusCode = 400; res.end(error.message); } }); return;
    }
    const shared=process.env.GIGGLE_QA_SHARED_PUBLIC && ['/css/style.css','/css/game-ui.css','/js/game-host.js'].includes(url.pathname);
    const serving=shared?path.resolve(process.env.GIGGLE_QA_SHARED_PUBLIC):publicRoot;
    const file = path.resolve(serving, '.' + url.pathname);
    if (!file.startsWith(serving + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('Not found'); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  const wss = new WebSocketServer({ server, path: '/socket' });
  wss.on('connection', ws => {
    let room = null, clock = null, primary = null, observer = null, projectionWindow = '', projectionStartedAt = 0;
    // Room uses wall time for envelopes. Keep the isolated deadline driver and
    // outgoing clock metadata aligned when QA deliberately advances a timer.
    const send = ws.send.bind(ws);
    ws.send = (data, ...args) => {
      if (clock && typeof data === 'string') {
        const message = JSON.parse(data);
        if (message.t === 'state') {
          const windowKey = message.instanceId + '|' + message.w + '|' + message.endsAt;
          if (projectionWindow !== windowKey) { projectionWindow = windowKey; projectionStartedAt = clock.now(); }
          message.serverNow = clock.now(); message.phaseStartedAt = projectionStartedAt; data = JSON.stringify(message);
        }
      }
      return send(data, ...args);
    };
    const publish = () => { if (!room) return; room.broadcastState(); if (observer) ws.send(JSON.stringify({ t: 'state', ...room.game.def.view(room.game.state, observer.id), game: room.game.def.id, instanceId: room.game.instanceId, players: room.activeRosterPlayers().map(p => ({ id: p.id, name: p.name })), you: observer.id, spectator: true, serverNow: clock.now(), hostId: room.hostId })); };
    ws.on('message', text => {
      try {
        const m = JSON.parse(text);
        if (m.t === 'prepare') {
          room?.destroy(); if (!ids.includes(m.id)) return;
          clock = new Clock(m.id); clock.time = Date.now();
          room = new Room('WORDS', { [m.id]: clock.content() });
          const context = room.ctx.bind(room); room.ctx = () => ({ ...context(), now: () => clock.now(), later: (ms, fn) => clock.later(ms, fn) });
          const bots = ['Ada', 'Bo', 'Cam'].map(name => room.addPlayer(name, { readyState: 1, bufferedAmount: 0, send() {}, close() {} }).player);
          const game = require('../games/' + m.id + '/server');
          const settings = Object.fromEntries((game.manifest.settings || []).filter(s => clock.opts[s.key] !== undefined).map(s => [s.key, clock.opts[s.key]]));
          const started = room.startGame(game, { settings }, bots[0].id); if (!started.ok) throw Error(started.error);
          primary = bots.find(p => p.id === (m.id === 'word-chain' ? room.game.state.turnPid : bots[0].id));
          room.addPlayer(primary.name, ws, primary.token); publish(); ws.send(JSON.stringify({ t: 'prepared' }));
        } else if (m.t === 'action' && room && !observer) {
          const before = JSON.stringify(room.game.def.view(room.game.state, primary.id)); clock.time += 450;
          room.onAction(ws, m.a, { i: m.i, w: m.w });
          const after = JSON.stringify(room.game.def.view(room.game.state, primary.id));
          ws.send(JSON.stringify({ t: 'qa-ack', action: m.a, changed: before !== after, phase: room.game.state.phase }));
        } else if (m.t === 'snapshot') publish();
        else if (m.t === 'clock') { clock.fire(); publish(); }
        else if (m.t === 'peer' && room) {
          const s = room.game.state, game = room.game.def, ctx = room.ctx(); clock.time += 450;
          const peers = room.activeRosterPlayers().filter(p => p.id !== primary.id);
          if (game.id === 'word-chain') { if (s.author && s.author !== primary.id && Object.keys(s.challenges).length) { for (const p of peers) if (p.id !== s.author) game.onAction(s, ctx, p.id, { challenge: true }); } else { const word = ['fruit', 'orchard', 'tree', 'wood', 'forest'].find(w => !s.used.includes(w)); game.onAction(s, ctx, s.turnPid, { word: word || '' }); } }
          if (game.id === 'scattergories') for (const p of peers) game.onAction(s, ctx, p.id, { answers: Array(5).fill(s.letter + 'ong'), lock: true });
          if (game.id === 'countdown-word') for (const p of peers) game.onAction(s, ctx, p.id, { pass: true });
          if (game.id === 'lyric-fill') for (const p of peers) game.onAction(s, ctx, p.id, { text: s.line.answer });
          if (game.id === 'number-hunt') for (const p of peers) game.onAction(s, ctx, p.id, { guess: s.secret });
          if (game.id === 'warm-words') game.onAction(s, ctx, peers[0].id, { guess: s.target });
          publish();
        } else if (m.t === 'watch' && room) {
          if (m.watching) { observer = room.addPlayer('Watcher', { readyState: 1, bufferedAmount: 0, send() {}, close() {} }).player; } else observer = null;
          publish();
        }
      } catch (error) { ws.send(JSON.stringify({ t: 'qa-error', error: error.message })); }
    });
    ws.on('close', () => room?.destroy());
  });
  return server;
}
module.exports = { createServer, wrapper, viewPage };
if (require.main === module) createServer().listen(Number(process.env.WORD_WORLDS_PORT || 8441), '127.0.0.1', () => console.log('Word worlds: http://127.0.0.1:' + (process.env.WORD_WORLDS_PORT || 8441) + '/'));
