'use strict';
// Mobile viewport QA: real production clients + real engine projections at
// phone sizes. Root opens this page at 320x640, 390x844, 568x320, 844x390 and
// keyboard-reduced 390x320, then presses Run. No production room is used.
// Room socket acknowledgements stay covered by skill-scenes-hud-browser.js;
// this harness focuses on short-height/keyboard/action-visibility geometry.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ids, fixtures } = require('./skill-scenes-hud-fixtures');

const root = path.resolve(__dirname, '../public');
const directory = process.env.SKILL_MOBILE_REPORT_DIR || '/tmp/giggle-all-mobile-20261007/skill';
// Primary control per game: the input or button a phone user must reach.
const PRIMARY = {
  charades: '#cSend',
  chess: '#chsq-e2',
  'countdown-word': '#cwLock',
  'doodle-guess': '[data-w]',
  'draw-phone': '#pSend',
  'memory-tray': '#mSend',
  'number-hunt': '#nSend',
  'pose-party': '.cp-ready',
  'reaction-tap': '#rPad',
  scattergories: '#scSave',
  'show-and-go': '.cp-ready',
  'twenty-questions': '#tQSend',
  'typing-race': '#tInput',
  'warm-words': '[data-ww-input]',
  'word-chain': '#wcGo',
};
const INPUTS = {
  charades: '#cGuess',
  'countdown-word': '#cwWord',
  'draw-phone': '#pPhrase',
  'memory-tray': '#mAns',
  'number-hunt': '#nGuess',
  scattergories: '#sc0',
  'twenty-questions': '#tQ',
  'typing-race': '#tInput',
  'warm-words': '[data-ww-input]',
  'word-chain': '#wcWord',
  'doodle-guess': '#dGuess',
};

function page() {
  return String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skill mobile viewport QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><style>body{padding:0;margin:0}#controls{padding:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-bottom:1px solid var(--line)}#controls button,#controls select{font-size:16px;min-height:44px;max-width:100%}#gbody{min-width:0;width:100%;box-sizing:border-box}#controls[hidden],#status[hidden]{display:none}#status{font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;margin:0}#viewport{font-size:14px;font-weight:800}</style><body class="game-playing"><div id="controls"><button class="btn" id="run">Check mobile viewports</button><select id="game" aria-label="Game">${ids.map((id) => '<option>' + id + '</option>').join('')}</select><select id="state" aria-label="Scenario"></select><span id="viewport" role="status"></span><button class="btn ghost" id="night">Night mode</button><button class="btn ghost" id="reduced">Reduced motion</button></div><main class="game-stage"><div id="gbody" data-layout="standard"></div></main><pre id="status" role="status">Ready</pre><script type="module">
const fixtures=${JSON.stringify(fixtures)},ids=${JSON.stringify(ids)},primary=${JSON.stringify(PRIMARY)},inputs=${JSON.stringify(INPUTS)};
const el=document.querySelector('#gbody'),game=document.querySelector('#game'),scenario=document.querySelector('#state'),status=document.querySelector('#status'),viewport=document.querySelector('#viewport'),modules={};let current=null,S=null;
const api={send:()=>{},now:()=>Date.now(),focus:(n)=>n?.focus({preventScroll:true}),announce:()=>{},toast:()=>{},sound:()=>{},voice:{state:()=>({enabled:false}),subscribe:()=>()=>{}}};
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const wait=()=>new Promise((r)=>requestAnimationFrame(r));
function showViewport(){viewport.textContent='Viewport '+document.documentElement.clientWidth+'x'+document.documentElement.clientHeight+(matchMedia('(prefers-reduced-motion:reduce)').matches?' · reduced motion':'');}
addEventListener('resize',showViewport);showViewport();
async function styles(){await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map((l)=>l.sheet?Promise.resolve():new Promise((r)=>{l.addEventListener('load',r,{once:true});l.addEventListener('error',r,{once:true});})));await document.fonts.ready;await wait();}
async function view(id){return modules[id]||=(await import('/js/games/'+id+'.js?v='+Date.now())).default;}
function paint(v,s){(v.update||v.render).call(v,el,s,api);}
function projection(id,index,extended=false){const raw=JSON.parse(JSON.stringify(fixtures[id][index].state)),shift=Date.now()-raw.serverNow;raw.serverNow=Date.now();for(const key of ['endsAt','startAt','clockStamp','phaseStartedAt'])if(raw[key]>0)raw[key]+=shift;if(extended){raw.players=raw.players.map((p)=>({...p,name:'Alexandria'+'w'.repeat(24)}));if(raw.wordShown)raw.wordShown='A'.repeat(60);if(raw.masked)raw.masked='_ '.repeat(38);if(raw.myPrompt)raw.myPrompt='A very small dragon patiently carries an enormous birthday cake across a windy mountain bridge';if(raw.choices)raw.choices=['A'.repeat(60),...raw.choices.slice(1)];if(raw.suggestions)raw.suggestions=['A very small dragon patiently carries an enormous birthday cake across a windy mountain bridge'];if(raw.target)raw.target='Words keep moving along this track. '+'W'.repeat(120);if(raw.categories)raw.categories=raw.categories.map((c)=>c+' with a wonderfully long category description');if(raw.current)raw.current='W'.repeat(24);if(raw.prompt)raw.prompt+=' — take your time and make the whole room laugh';}return raw;}
async function mount(id,index=0,extended=false){current?.dispose?.(el);el.innerHTML='';current=await view(id);current.mount?.(el,api);S=projection(id,index,extended);paint(current,S);await styles();return current;}
async function show(){await mount(game.value,Number(scenario.value)||0,false);status.textContent=game.value+' · '+fixtures[game.value][Number(scenario.value)||0].label;}
function populate(){scenario.innerHTML=fixtures[game.value].map((f,i)=>'<option value="'+i+'">'+f.label+' · '+f.state.phase+'</option>').join('');}
const fields=['input:not([type=range]):not([type=color]):not([type=checkbox]):not([type=radio])','textarea'];
function inViewport(r){const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;return r.bottom>0&&r.right>0&&r.top<vh&&r.left<vw;}
async function check(id){let checks=0;const states=[];for(let i=0;i<fixtures[id].length;i++)for(const extended of [false,true]){await mount(id,i,extended);const label=fixtures[id][i].label+(extended?' · long':'');
  assert(el.textContent.trim().length>5,id+' '+label+' blank');checks++;
  assert(el.scrollWidth<=el.clientWidth+2,id+' '+label+' scene width '+el.scrollWidth+'/'+el.clientWidth);checks++;
  assert(!document.activeElement?.matches('input,textarea'),id+' '+label+' mount opens the keyboard');checks++;
  const bounds=el.getBoundingClientRect();
  for(const n of el.querySelectorAll('button,input,textarea,select,summary,canvas')){const r=n.getBoundingClientRect(),css=getComputedStyle(n);if(!r.width||!r.height||css.visibility==='hidden'||css.display==='none')continue;assert(r.left>=bounds.left-2&&r.right<=bounds.right+2,id+' '+label+' target outside scene '+(n.id||n.className));if(n.matches('button,summary')&&!n.matches('[data-sq]'))assert(r.height>=43&&r.width>=43,id+' '+label+' target <44 '+(n.id||n.className)+' '+r.width+'x'+r.height);if(n.matches(fields.join(',')))assert(parseFloat(css.fontSize)>=16,id+' '+label+' text input <16px');}
  checks++;
  // Touch discipline: page scrolls except under an active drawing stroke.
  for(const cv of el.querySelectorAll('canvas')){const r=cv.getBoundingClientRect(),css=getComputedStyle(cv);assert(Math.abs(r.width/r.height-cv.width/cv.height)<0.06,id+' '+label+' canvas aspect distorted');const drawable=cv.dataset.drawable==='true';assert(css.touchAction===(drawable?'none':'pan-y'),id+' '+label+' canvas touch '+css.touchAction);}checks++;
  assert(getComputedStyle(document.body).touchAction!=='none',id+' '+label+' body touch locked');checks++;
  // Draft + focus survive a snapshot (keyboard stays up, text stays put).
  const sel=inputs[id],input=sel&&el.querySelector(sel);
  if(input&&!input.disabled){const draft=id==='number-hunt'?'63':id==='typing-race'?(S.target||'type').slice(0,3):'A thoughtful draft';input.value=draft;input.focus();assert(input.hasAttribute('inputmode')&&input.hasAttribute('autocomplete'),id+' '+label+' input missing keyboard attributes');paint(current,{...S,qaSnapshot:1});assert(el.querySelector(sel)===input&&input.value===draft,id+' '+label+' loses draft');checks++;}
  // Short heights: board/pad/canvas keep the primary action reachable.
  const vh=document.documentElement.clientHeight;
  if(id==='chess'&&vh<=500&&S.phase==='play'){const board=el.querySelector('.chboard');if(board){const r=board.getBoundingClientRect();assert(r.height<=vh*0.78,id+' short board '+Math.round(r.height)+'px in '+vh+'px viewport');checks++;}}
  if(id==='reaction-tap'&&vh<=500){const pad=el.querySelector('#rPad');if(pad){assert(pad.getBoundingClientRect().height<=vh*0.7,id+' short pad overflows');checks++;}}
  // Primary action scrolls into the (possibly keyboard-reduced) viewport.
  const prim=primary[id]&&el.querySelector(primary[id]);
  if(prim&&!prim.disabled&&prim.getClientRects().length){prim.scrollIntoView({block:'nearest'});await wait();const r=prim.getBoundingClientRect();assert(inViewport(r)||el.scrollHeight>el.clientHeight,id+' '+label+' primary action unreachable: '+(prim.id||prim.className));checks++;}
  if(S.spectator){for(const inp of el.querySelectorAll(fields.join(',')))assert(inp.disabled||inp.readOnly,id+' watcher writable input');checks++;}
  states.push({label,phase:S.phase,spectator:S.spectator});
}current?.dispose?.(el);current=null;return{id,checks,states,pass:true};}
async function save(results){const data={kind:'mobile',viewport:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight},reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches,results};await fetch('/results',{method:'POST',body:JSON.stringify(data)});return data;}
document.querySelector('#run').onclick=async()=>{const results=[];status.textContent='Checking mobile projections…';for(const id of ids){try{results.push(await check(id));}catch(e){results.push({id,pass:false,error:e.message});current?.dispose?.(el);current=null;}status.textContent=results.map((r)=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||r.checks+' checks')).join('\n');}await save(results);game.value='doodle-guess';populate();scenario.value=String(fixtures['doodle-guess'].findIndex((f)=>f.label==='Drawing'));await mount('doodle-guess',Number(scenario.value));status.textContent=results.map((r)=>(r.pass?'PASS':'FAIL')+' '+r.id+' '+(r.error||r.checks+' checks')).join('\n');};
game.onchange=()=>{populate();show();};scenario.onchange=show;document.querySelector('#night').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';};document.querySelector('#reduced').onclick=()=>{document.documentElement.dataset.reduced=document.documentElement.dataset.reduced==='true'?'false':'true';};const params=new URLSearchParams(location.search);if(ids.includes(params.get('game')))game.value=params.get('game');populate();scenario.value=params.get('state')||'0';if(params.get('theme'))document.documentElement.dataset.theme=params.get('theme');if(params.get('scene')==='1'){document.querySelector('#controls').hidden=true;status.hidden=true;}await show();
</script></html>`;}
function createServer() {
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/' || req.url === '/qa') {
      res.setHeader('Content-Type', 'text/html');
      res.end(page());
      return;
    }
    if (req.url === '/results' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          fs.mkdirSync(directory, { recursive: true });
          fs.writeFileSync(path.join(directory, `mobile-${data.viewport.width}x${data.viewport.height}.json`), JSON.stringify(data, null, 2));
          res.end('saved');
          console.log(data.results.filter((x) => !x.pass));
        } catch (e) { res.statusCode = 400; res.end(e.message); }
      });
      return;
    }
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  return server;
}
module.exports = { createServer, page };
if (require.main === module) createServer().listen(4329, '127.0.0.1', () => console.log('Skill mobile QA: http://127.0.0.1:4329/'));
