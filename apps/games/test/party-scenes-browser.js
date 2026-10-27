'use strict';
// Local QA only: real server modules, legal actions, private projections and
// real browser views. No production room or player data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const registry = require('../games/registry');
const { actionWindow } = require('../games/_sdk');
const ROOT = path.resolve(__dirname, '..');
const IDS = ['bluff','compliment-battle','dare-roulette','emoji-story','five-second','funny-answer','hot-takes','lyric-fill','most-likely','never-ever','pick-one','rank-it','rapid-polls','roast-toast','story-builder','trivia','truth-dare','two-truths','would-you-rather'];
const PLAYERS = [{id:'p1',name:'Asha'},{id:'p2',name:'Bo'},{id:'p3',name:'Charlie'},{id:'p4',name:'Dev'}];
class Ctx {
  constructor() { this.time = 1700000000000; this.timers=[]; this.awards={}; this.seq=0; this.broadcasts=0; }
  allPlayers() { return PLAYERS.slice(); } players() { return this.allPlayers(); }
  hostId() { return 'p1'; } settings() { return {rounds:2}; }
  now() { return this.time; } award(pid,n) { this.awards[pid]=(this.awards[pid]||0)+n; }
  broadcast() { this.broadcasts++; } lobby() {}
  content(id) { try { return JSON.parse(fs.readFileSync(path.join(ROOT,'locales/en',id+'.json'),'utf8')); } catch { return {}; } }
  later(ms,fn) { const t={at:this.time+ms,fn,dead:false,seq:this.seq++}; this.timers.push(t); return ()=>{t.dead=true;}; }
  fire() { const t=this.timers.filter(t=>!t.dead).sort((a,b)=>a.at-b.at||a.seq-b.seq)[0]; if(!t)return false; t.dead=true; this.time=Math.max(this.time,t.at); t.fn(); return true; }
}
function make(id,scenario='normal') {
  const def=registry.get(id),ctx=new Ctx();
  if(id==='lyric-fill'&&scenario==='translated')ctx.content=()=>({lines:[{before:'एक स्थानीय गीत का शब्द',after:'',answer:'दिलवाले',song:'Local QA',artist:'Fixture'}]});
  const g={id,def,ctx,state:def.create(ctx),actions:0};
  if(['compliment-battle','roast-toast'].includes(id)&&scenario==='single-entry'){
    const author=PLAYERS.find(p=>p.id!==g.state.target);
    act(g,author.id,{entry:'A kind, funny note from '+author.name+'.'});
    ctx.fire();
  }
  return g;
}
function project(g,pid) { return JSON.parse(JSON.stringify({...g.def.view(g.state,pid),game:g.id,instanceId:'party-qa-'+g.id,w:actionWindow(g.state),me:pid,hostId:g.state.hostId||'p1',players:PLAYERS,totals:g.ctx.awards,spectator:pid==='watch',spectators:[{id:'watch',name:'Watcher'}],serverNow:g.ctx.now()})); }
function act(g,pid,a) { const w=actionWindow(g.state); g.def.onAction(g.state,g.ctx,pid,a); g.actions++; if(g.capture&&w===actionWindow(g.state))g.capture(); }
function advance(g) {
  const s=g.state,id=g.id,phase=s.phase;
  const send=(pid,a)=>act(g,pid,a);
  if(phase==='done') return false;
  if(phase==='reveal') { send(id==='two-truths'?s.subject:id==='emoji-story'?s.director:id==='five-second'?s.performer:'p1',{next:true}); return true; }
  for(const p of PLAYERS) {
    if(g.state.phase!==phase) break;
    const v=project(g,p.id);
    if(id==='bluff') { if(phase==='bluff')send(p.id,{fake:'A convincing '+p.name+' answer'}); else { const o=s.options.find(o=>o.pid!==p.id); if(o)send(p.id,{pick:o.oid}); } }
    else if(id==='compliment-battle') { if(phase==='write'&&p.id!==s.target)send(p.id,{entry:p.name+' makes everyone feel welcome.'}); else if(phase==='vote') { const b=v.ballot.find(b=>b.i!==v.myEntry); if(b)send(p.id,{vote:b.i}); } }
    else if(id==='dare-roulette') { if(phase==='spin')send(p.id,{spin:true}); else if(phase==='perform'&&p.id===s.victim)send(p.id,{ready:true}); else if(phase==='verdict'&&p.id!==s.victim)send(p.id,{vote:'done'}); }
    else if(id==='emoji-story') { if(phase==='emoji'&&p.id===s.director)send(p.id,{emoji:'🌊🐟🎉'}); else if(phase==='guess'&&p.id!==s.director)send(p.id,{guess:s.phrase}); }
    else if(id==='five-second') { if(phase==='answer'&&p.id===s.performer)send(p.id,{answers:'one, two, three'}); else if(phase==='vote'&&p.id!==s.performer)send(p.id,{vote:'pass'}); }
    else if(id==='funny-answer') { if(phase==='answer')send(p.id,{answer:p.name+' brought a tiny disco ball.'}); else { const o=s.options.find(o=>o.pid!==p.id); if(o)send(p.id,{vote:o.aid}); } }
    else if(id==='hot-takes') { if(phase==='submit')send(p.id,{take:p.name+' says breakfast belongs at midnight.'}); else if(v.current&&!v.current.mine)send(p.id,{vote:p.id==='p2'?'disagree':'agree'}); }
    // PEEK: correct answer drives deterministic UI fixtures, never gameplay advice.
    else if(id==='lyric-fill')send(p.id,{text:s.line.answer});
    else if(id==='most-likely')send(p.id,{vote:PLAYERS.find(x=>x.id!==p.id).id});
    else if(id==='never-ever')send(p.id,{vote:p.id==='p2'?'have':'not'});
    else if(id==='pick-one'||id==='would-you-rather')send(p.id,{vote:p.id==='p4'?'b':'a'});
    else if(id==='rank-it')send(p.id,{order:[0,1,2,3,4]});
    else if(id==='rapid-polls') { if(phase==='pose')send(p.id,{pose:{q:'What makes a great game night?',options:['A surprising story','A close contest','Everyone joining in']}}); else send(p.id,{vote:p.id==='p2'?0:2}); }
    else if(id==='roast-toast') { if(phase==='write'&&p.id!==s.target)send(p.id,{entry:p.name+' can turn a snack break into a three-part saga.'}); else if(phase==='vote') { if(p.id===s.target)send(p.id,{pick:0}); else {const b=v.ballot.find(b=>b.i!==v.myEntry); if(b)send(p.id,{vote:b.i});} } }
    else if(id==='story-builder') { if(phase==='build'&&p.id===s.turn)send(p.id,{line:p.name+' opened the door and found a disco-loving dragon.'}); else if(phase==='vote') {const i=s.lines.findIndex(l=>l.pid!==p.id);if(i>=0)send(p.id,{vote:i});} }
    else if(id==='trivia')send(p.id,{pick:p.id==='p2'?(s.question.answer+1)%4:s.question.answer});
    else if(id==='truth-dare') { if(phase==='choose'&&p.id===s.target)send(p.id,{deck:'classic',kind:'truth'}); else if(phase==='perform'&&p.id===s.target)send(p.id,{ready:true}); else if(phase==='vote'&&p.id!==s.target)send(p.id,{vote:'yes'}); }
    else if(id==='two-truths') { if(phase==='write'&&p.id===s.subject)send(p.id,{statements:['I can make pancakes.','I once missed a train.','I have a pet dragon.'],lie:2}); else if(phase==='vote'&&p.id!==s.subject)send(p.id,{vote:p.id==='p2'?0:2}); }
  }
  if(g.state.phase===phase) g.ctx.fire();
  return true;
}
function fixtures() {
  return IDS.map(id=>{
    const g=make(id),frames=[];let n=0;
    while(g.state.phase!=='done'&&n++<250) {
      frames.push({label:g.state.phase+' · '+(g.state.round||g.state.index+1||1),views:[...PLAYERS.map(p=>project(g,p.id)),project(g,'watch')]});
      let acknowledged=false; g.capture=()=>{if(!acknowledged){acknowledged=true;frames.push({label:g.state.phase+' acknowledged · '+(g.state.round||g.state.index+1||1),views:[...PLAYERS.map(p=>project(g,p.id)),project(g,'watch')]});}};
      advance(g);g.capture=null;
    }
    assert.equal(g.state.phase,'done',id+' completes with real legal actions and real timed transitions');
    frames.push({label:'done',views:[...PLAYERS.map(p=>project(g,p.id)),project(g,'watch')]});
    assert(g.actions>0,id+' performed legal actions');
    if(['compliment-battle','roast-toast'].includes(id)){
      const sparse=make(id,'single-entry');
      frames.push({label:'single entry vote',views:[...PLAYERS.map(p=>project(sparse,p.id)),project(sparse,'watch')]});
      advance(sparse);
      assert.equal(sparse.state.phase,'reveal',id+' sparse ballot completes with every legal eligible action');
      frames.push({label:'single entry reveal',views:[...PLAYERS.map(p=>project(sparse,p.id)),project(sparse,'watch')]});
    }
    if(id==='lyric-fill'){
      const translated=make(id,'translated');
      frames.push({label:'translated fill',views:[...PLAYERS.map(p=>project(translated,p.id)),project(translated,'watch')]});
      for(const p of PLAYERS)act(translated,p.id,{text:p.id==='p1'?'नमस्ते':'दिलवाले'});
      frames.push({label:'translated reveal',views:[...PLAYERS.map(p=>project(translated,p.id)),project(translated,'watch')]});
    }
    return {id,frames,actions:g.actions};
  });
}
const FIXTURES=fixtures();
if(require.main===module && !process.argv.includes('--serve')) {
  for(const f of FIXTURES)console.log('PARTY_ENGINE_FIXTURE_PASS '+f.id+' '+f.frames.length+' phase snapshots, '+f.actions+' legal actions');
}
if(require.main===module && process.argv.includes('--serve')) {
  let live=make('trivia');
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    try {
      if(u.pathname==='/') {res.setHeader('Content-Type','text/html');res.end(PAGE);return;}
      if(u.pathname==='/framed') {res.setHeader('Content-Type','text/html');res.end(FRAME);return;}
      if(u.pathname==='/api/qa-report'&&req.method==='POST'){let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);const name='party-'+(data.mobile?'mobile':data.hud?'hud':data.touch?'touch':'browser')+'-'+data.width+'x'+(data.height||0)+'-'+data.theme+'.json';const dir=process.env.PARTY_QA_REPORT_DIR||'/tmp/giggle-karts-polish-20261006';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2));res.end('Saved');return;}
      if(u.pathname==='/api/fixtures') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(FIXTURES));return;}
      if(u.pathname==='/api/state') {
        const id=u.searchParams.get('game');if(id&&id!==live.id)live=make(id);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(project(live,u.searchParams.get('player')||'p1')));return;
      }
      if(u.pathname==='/api/action'&&req.method==='POST') {
        let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);
        if(b.w===actionWindow(live.state)&&b.player!=='watch')act(live,b.player,b.action);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(project(live,b.player)));return;
      }
      if(u.pathname==='/api/step') {advance(live);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(project(live,u.searchParams.get('player')||'p1')));return;}
      if(u.pathname==='/api/reset') {live=make(u.searchParams.get('game'),u.searchParams.get('scenario')||'normal');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(project(live,u.searchParams.get('player')||'p1')));return;}
      const shared=process.env.GIGGLE_QA_SHARED_PUBLIC && ['/css/style.css','/css/game-ui.css','/js/game-host.js'].includes(u.pathname);
      const serving=shared?path.resolve(process.env.GIGGLE_QA_SHARED_PUBLIC):path.join(ROOT,'public');
      const file=path.resolve(serving,'.'+u.pathname);
      if(!file.startsWith(serving+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end('Not found');return;}
      const type={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
      res.setHeader('Content-Type',type);res.end(fs.readFileSync(file));
    } catch(e) {res.statusCode=500;res.end(String(e.stack));}
  });
  server.listen(Number(process.env.PARTY_QA_PORT||8137),'127.0.0.1',()=>console.log('PARTY_SCENES_QA http://127.0.0.1:'+server.address().port));
}
const FRAME=`<!doctype html><meta charset="utf-8"><title>Party scenes — framed local QA</title><style>body{margin:0;background:#fafafd;color:#252237;font:16px system-ui}header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px}button{min-width:44px;min-height:44px;font:inherit;padding:10px 18px;border:1px solid #cfccdf;border-radius:24px;background:#fff;color:#252237}iframe{display:block;margin:auto;border:1px solid #cfccdf}</style><header><span>Local QA viewport</span><button data-size="1280,800">Desktop 1280</button><button data-size="1024,600">Laptop 1024</button><button data-size="390,844">Phone 390</button><button data-size="844,390">Landscape 844</button></header><iframe id="partyframe" src="/" width="1024" height="768" title="Actual party viewport"></iframe><script>const frame=document.querySelector('#partyframe');for(const button of document.querySelectorAll('[data-size]'))button.onclick=()=>{const[w,h]=button.dataset.size.split(',');frame.width=w;frame.height=h};</script>`;
const { auditTextContrast } = require('./live-text-contrast');
const PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Party Scenes QA</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><link rel="stylesheet" href="/css/party-scenes.css"><style>body{margin:0;padding:16px}#qa-toolbar>summary{min-height:44px;display:flex;align-items:center;font-size:16px;cursor:pointer;margin-bottom:10px}#qa-toolbar:not([open])+#status,#qa-toolbar:not([open])~#checks,#qa-toolbar:not([open])~#errors{display:none}header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;font-size:16px}header select,header button{min-height:44px;font-size:16px}#stage{width:min(100%,1080px);margin:auto}.qa-phone #stage{width:390px;max-width:100%}.qa-wide #stage{width:1080px;max-width:100%}#checks{margin:20px auto;max-width:940px;font-size:16px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:left}#status{font-size:16px;line-height:1.5}.gamecard{padding:8px 0}.party-hud{margin-top:0}header.party-hud{margin-bottom:16px}.timertext{font-size:18px}#rematch{display:flex;gap:12px;flex-wrap:wrap}#errors{white-space:pre-wrap;color:var(--melon-deep)}</style></head><body class="qa-wide"><details id="qa-toolbar" open><summary>QA controls</summary><header><strong>Party Scenes · local QA</strong><label>Game <select id="game"></select></label><label>View <select id="person"><option value="p1">Asha</option><option value="p2">Bo</option><option value="p3">Charlie</option><option value="p4">Dev</option><option value="watch">Watcher</option></select></label><button id="reset">Restart test</button><button id="step">Play next legal action</button><button id="phone">Phone width</button><button id="theme">Night theme</button><button id="verify">Verify all 19 views</button><button id="verify-mobile">Verify mobile matrix</button><button id="verify-touch">Verify touch and typing</button><button id="verify-hud">Verify HUD states and long text</button><button id="broadcast">Same-window broadcast</button><button id="longtext">Long text: off</button><label>Scenario <select id="scenario"><option value="normal">Normal</option><option value="single-entry">Single submitted note (compliment / roast)</option><option value="translated">Hindi lyric test</option></select></label><label>Snapshot <select id="frame"></select></label></header></details><p id="status">Loading real game views…</p><div id="stage" class="game-stage"><div class="game-clock"><div class="timerbar" id="tbar"><div></div></div><div class="timertext" id="ttime"></div></div><main id="gbody" data-layout="standard"></main></div><div id="checks"></div><pre id="errors"></pre><script type="module">
const auditTextContrast=${auditTextContrast.toString()};
import {show,reset} from '/js/game-host.js';
let fixtures=await(await fetch('/api/fixtures')).json(),S=null;const by=id=>document.getElementById(id),root=by('gbody');
by('game').innerHTML=fixtures.map(f=>'<option>'+f.id+'</option>').join('');
by('game').value='trivia';
let report=[],captureActions=null,longText=false,rawState=null;
function stressState(state){
  const v=JSON.parse(JSON.stringify(state));
  v.players.forEach((p,i)=>p.name='Alexandria Wellington '+i+' · '+('longname'.repeat(5)));
  v.totals=Object.fromEntries(v.players.map(p=>[p.id,987654321]));
  const copy='A custom game-night prompt: '+('unexpectedly delightful answers and stories '.repeat(5));
  for(const key of ['prompt','statement','dare','category','starter','seed'])if(typeof v[key]==='string')v[key]=copy;
  if(v.fact?.prompt)v.fact.prompt=copy;
  if(v.question?.q)v.question.q=copy;
  if(v.set?.topic)v.set.topic=copy;
  if(v.current?.text)v.current.text=copy;
  if(v.prompt&&typeof v.prompt==='object'){v.prompt.a=copy;v.prompt.b=copy;}
  if(v.question?.options)v.question.options=v.question.options.map((_,i)=>'Answer '+i+' '+('surprisinglylongchoice'.repeat(4)));
  if(v.set?.items)v.set.items=v.set.items.map((_,i)=>'Ranked item '+i+' '+('longitem'.repeat(10)));
  if(v.poll?.q)v.poll.q=copy;
  for(const line of [v.line,v.last?.line])if(line){for(const key of ['before','after','song','artist'])if(typeof line[key]==='string')line[key]=copy;}
  for(const lines of [v.lines,v.last?.lines])if(lines)lines.forEach(line=>line.text=copy);
  if(v.last?.entries)for(const id of Object.keys(v.last.entries))v.last.entries[id]=copy;
  for(const key of ['prompt','statement','dare','category','starter','seed'])if(typeof v.last?.[key]==='string')v.last[key]=copy;
  if(v.poll?.options)v.poll.options=v.poll.options.map((_,i)=>'Poll answer '+i+' '+('longchoice'.repeat(5)));
  if(v.options)v.options.forEach(o=>o.text=copy);
  if(v.ballot)v.ballot.forEach(o=>o.text=copy);
  if(v.statements)v.statements=v.statements.map((_,i)=>'Statement '+i+' '+('a surprising memory '.repeat(5)));
  return v;
}
function footer(state){by('ttime').textContent=state.endsAt?'Time · '+Math.max(0,Math.ceil((state.endsAt-state.serverNow)/1000))+'s':'';if(state.phase==='done'&&!by('rematch')){const f=document.createElement('div');f.id='rematch';f.className='row mt';f.innerHTML='<button class="btn">Rematch</button><button class="btn ghost">Change game</button>';root.appendChild(f);f.querySelector('button').onclick=load;f.querySelector('button.ghost').onclick=()=>{by('qa-toolbar').open=true;by('game').focus();};}}
async function paint(state,captured){rawState=JSON.parse(JSON.stringify(state));if(longText&&!captured)state=stressState(state);captureActions=captured;S=state;const v=await show(root,S.game,S,{now:()=>S.serverNow,send:async a=>{if(captureActions){captureActions.push(a);return;}const next=await(await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:S.me,w:S.w,action:a})})).json();await paint(next);by('status').textContent='Real action recorded · '+JSON.stringify(a)+' → '+next.phase;},focus:n=>{const field=typeof n==='string'?document.querySelector(n):n;if(field&&field.focus){try{field.focus({preventScroll:true});}catch{field.focus();}}},toast:m=>{by('status').textContent=m;}});if(!v)throw Error('View failed '+S.game);footer(S);return v;}
function fillFrames(){const f=fixtures.find(f=>f.id===by('game').value);by('frame').innerHTML='<option value="">Live test</option>'+f.frames.map((x,i)=>'<option value="'+i+'">'+x.label+'</option>').join('');}
async function load(){reset();fillFrames();await paint(await(await fetch('/api/reset?game='+by('game').value+'&player='+by('person').value+'&scenario='+by('scenario').value)).json());by('status').textContent='Real engine · '+S.game+' · '+S.phase+' · '+S.me;}
by('game').onchange=load;by('scenario').onchange=load;by('reset').onclick=load;by('person').onchange=async()=>{if(by('frame').value!=='')by('frame').onchange();else{reset();await paint(await(await fetch('/api/state?player='+by('person').value)).json());}};
by('step').onclick=async()=>{await paint(await(await fetch('/api/step?player='+by('person').value)).json());by('status').textContent='Legal player actions / server timer → '+S.phase;};
by('broadcast').onclick=async()=>{await paint(JSON.parse(JSON.stringify(rawState||S)));by('status').textContent='Same-window broadcast applied';};
by('longtext').onclick=async()=>{longText=!longText;by('longtext').textContent='Long text: '+(longText?'on':'off');if(rawState){await paint(JSON.parse(JSON.stringify(rawState)));by('status').textContent=(longText?'Long-text stress view':'Normal text view')+' · '+S.game+' · '+S.phase+' · '+S.me;}};
by('phone').onclick=()=>{document.body.classList.toggle('qa-phone');document.body.classList.toggle('qa-wide');by('phone').textContent=document.body.classList.contains('qa-phone')?'Desktop width':'Phone width';};
by('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';};
by('frame').onchange=async()=>{if(by('frame').value===''){await load();return;}reset();const f=fixtures.find(f=>f.id===by('game').value);await paint(f.frames[Number(by('frame').value)].views.find(v=>v.me===by('person').value));by('status').textContent='Actual private projection · '+S.game+' · '+S.phase+' · '+S.me;};
by('verify').onclick=async()=>{
  report=[];by('errors').textContent='';by('verify').disabled=true;
  for(const f of fixtures){
    const issues=[];let seen=0,drafts=0,actions=0;
    for(const me of ['p1','p2','p3','p4','watch']){
      reset();
      for(const frame of f.frames){
        const state=frame.views.find(v=>v.me===me);
        try{
          const captured=[];await paint(state,captured);seen++;
          const texts=[...root.querySelectorAll('input[type=text]:not(:disabled)')];
          if(texts.length){for(const n of texts)n.value=n.id==='eEmoji'?'🌊🐟🎉':'A draft for '+n.id;await paint(JSON.parse(JSON.stringify(state)),captured);if(texts.some(n=>document.getElementById(n.id)?.value!==(n.id==='eEmoji'?'🌊🐟🎉':'A draft for '+n.id)))issues.push(frame.label+' loses a typed draft');else drafts++;}
          const own=state.game==='bluff'?state.myOption:state.game==='funny-answer'?state.myEntry:null;
          if(own){const b=root.querySelector('[data-v=\"'+own+'\"]');if(b&&!b.disabled)issues.push(frame.label+' own anonymous answer remains enabled');}
          const choice=root.querySelector('button[data-v]:not(:disabled),button[data-p]:not(:disabled),button[data-kind]:not(:disabled),#bSend,#fSend,#cbSend,#rtSend,#lfGo,#rLock,#rpAsk,#drSpin,#sSend,#tSend,#eSend2,#eSend,#hSend');
          if(choice){choice.click();await Promise.resolve();if(captured.length!==1)issues.push(frame.label+' action did not emit exactly once');else actions++;}

          const contrast=auditTextContrast(root);for(const error of contrast.errors)issues.push(frame.label+' contrast '+JSON.stringify(error));
          if(!root.querySelector('.party-scene'))issues.push(frame.label+' has no owned scene');
          if(root.scrollWidth>root.clientWidth+2)issues.push(frame.label+' scene horizontal overflow '+root.scrollWidth+'/'+root.clientWidth);
          if(document.documentElement.scrollWidth>document.documentElement.clientWidth+2)issues.push(frame.label+' document horizontal overflow '+document.documentElement.scrollWidth+'/'+document.documentElement.clientWidth);
          if(state.game==='trivia'&&state.phase==='answer'&&innerWidth<=640&&innerHeight>=600&&state.question.q.length<100&&state.question.options.every(o=>o.length<64)){
            const choices=root.querySelector('.party-choices');
            if(choices&&choices.getBoundingClientRect().bottom-root.getBoundingClientRect().top>innerHeight-136)issues.push(frame.label+' ordinary quiz answers exceed the phone play area');
          }
          for(const n of root.querySelectorAll('button,input,select,textarea,summary,label.party-lie')){
            const r=n.getBoundingClientRect(),css=getComputedStyle(n);
            if(r.height===0||n.type==='radio')continue;
            if(r.height<44||r.width<44)issues.push(frame.label+' short target '+(n.id||n.textContent.trim().slice(0,20))+' '+r.width.toFixed(1)+'×'+r.height.toFixed(1));
            if(n.type!=='radio'&&parseFloat(css.fontSize)<16)issues.push(frame.label+' small control text '+(n.id||n.textContent.trim().slice(0,20)));
          }
          for(const n of root.querySelectorAll('.party-prompt'))if(parseFloat(getComputedStyle(n).fontSize)<24)issues.push(frame.label+' small prompt');
          if(me==='watch'&&[...root.querySelectorAll('input,button,select,textarea')].some(n=>!n.disabled&&!n.closest('#rematch')))issues.push(frame.label+' watcher enabled action');
          if(state.phase==='done'&&!by('rematch'))issues.push('missing shell rematch');
        }catch(e){issues.push(frame.label+': '+e.message);}
      }
    }
    if(!actions)issues.push('No UI action emitted');report.push({id:f.id,seen,drafts,actions,issues:[...new Set(issues)]});
    by('checks').innerHTML='<table><thead><tr><th>Game</th><th>Real private views</th><th>Result</th></tr></thead><tbody>'+report.map(r=>'<tr><td>'+r.id+'</td><td>'+r.seen+'</td><td>'+(r.issues.length?r.issues.length+' issues':'PASS')+'</td></tr>').join('')+'</tbody></table>';
  }
  by('errors').textContent=report.filter(r=>r.issues.length).map(r=>r.id+'\\n'+r.issues.join('\\n')).join('\\n\\n');
  by('status').textContent='VERIFY_COMPLETE '+report.reduce((n,r)=>n+r.seen,0)+' actual renders / '+report.length+' games / '+report.reduce((n,r)=>n+r.issues.length,0)+' issues · '+(document.body.classList.contains('qa-phone')?'390px':'1080px')+' · '+(document.documentElement.dataset.theme||'day');
  await fetch('/api/qa-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',report})});
  by('verify').disabled=false;reset();await load();
  by('status').textContent='VERIFY_COMPLETE '+report.reduce((n,r)=>n+r.seen,0)+' actual renders / '+report.length+' games / '+report.reduce((n,r)=>n+r.issues.length,0)+' issues';
};
by('verify-mobile').onclick=async()=>{
  by('verify-mobile').disabled=true;by('status').textContent='Checking mobile matrix…';const suites=[];
  try{
    for(const id of ['verify-hud','verify-touch','verify']){
      await by(id).onclick();suites.push({id,status:by('status').textContent,issues:by('errors').textContent});
    }
    const data={mobile:true,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',documentWidth:document.documentElement.scrollWidth,sceneWidth:root.clientWidth,suites};
    await fetch('/api/qa-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    by('errors').textContent=suites.filter(s=>s.issues).map(s=>s.id+'\\n'+s.issues).join('\\n\\n');
    by('status').textContent='MOBILE_COMPLETE '+innerWidth+'×'+innerHeight+' / 19 games / '+suites.filter(s=>s.issues).length+' failed suites';
  }finally{by('verify-mobile').disabled=false;}
};
by('verify-touch').onclick=async()=>{
  const report=[];by('errors').textContent='';by('verify-touch').disabled=true;by('status').textContent='Checking touch and typing…';
  const submit={bluff:'#bSend','compliment-battle':'#cbSend','emoji-story':'#eSend2,#eSend','five-second':'#fSend','funny-answer':'#fSend','hot-takes':'#hSend','lyric-fill':'#lfGo','rapid-polls':'#rpAsk','roast-toast':'#rtSend','story-builder':'#sSend','two-truths':'#tSend'};
  const draftValue=n=>n.id==='eEmoji'?'🌊🐟🎉':n.id==='fAns'&&S.game==='five-second'?'cat, dog, bird':n.id==='rpQ'?'What makes game night great?':n.id.startsWith('rpO')?'Choice '+n.id.slice(-1):'A real typed draft for '+n.id;
  for(const f of fixtures){
    const issues=[];let seen=0,typing=0,ime=0,taps=0,keyboardSends=0,roles=0,smallest=Infinity,reorders=0;
    for(const me of ['p1','p2','p3','p4','watch']){
      reset();
      for(const frame of f.frames){
        const state=frame.views.find(v=>v.me===me),captured=[];
        try{
          await paint(state,captured);seen++;
          if(document.getElementById('rpExtra'))document.getElementById('rpExtra').open=true;
          const fields=[...root.querySelectorAll('input[type=text]:not(:disabled)')].filter(n=>n.getBoundingClientRect().height);
          if(fields.length){
            fields.forEach(n=>n.value=draftValue(n));
            const input=fields[0];input.focus({preventScroll:true});input.setSelectionRange(2,5);
            input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'猫'}));
            const changed=JSON.parse(JSON.stringify(state));if(changed.submitted)changed.submitted=[...new Set([...changed.submitted,'p4'])];
            await paint(changed,captured);seen++;
            if(fields.some(n=>document.getElementById(n.id)!==n||n.value!==draftValue(n)))issues.push(frame.label+' replaces active composer or loses draft');
            if(document.activeElement!==input||input.selectionStart!==2||input.selectionEnd!==5)issues.push(frame.label+' loses typing focus/selection');
            else typing++;
            input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
            input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true}));
            if(captured.length)issues.push(frame.label+' IME commit submits prematurely');else ime++;
            input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'猫'}));
            if(f.id==='two-truths')root.querySelector('input[name="tLie"][value="0"]').click();
            const button=root.querySelector(submit[f.id]);
            if(f.id==='emoji-story'&&state.phase==='emoji'){
              input.value='पार्टी 🎉';button.click();await Promise.resolve();
              if(captured.length||!root.querySelector('#eEmojiError')?.textContent.includes('remove the letters')||input.getAttribute('aria-invalid')!=='true')issues.push(frame.label+' invalid emoji story lacks recoverable feedback');
              fields.forEach(n=>n.value=draftValue(n));
            }
            if(button){button.click();await Promise.resolve();if(captured.length!==1)issues.push(frame.label+' submit tap does not emit once');else taps++;}
            if(f.id==='two-truths'&&captured[0]?.lie!==0)issues.push(frame.label+' lie tap is not reflected in submission');
            captured.length=0;fields.forEach(n=>n.value=draftValue(n));
            if(f.id==='two-truths'||f.id==='rapid-polls'){
              const ids=f.id==='two-truths'?['tS0','tS1','tS2']:['rpQ','rpO0','rpO1'];
              for(let i=0;i<ids.length;i++){
                const n=document.getElementById(ids[i]);n.focus();n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
                if(i<ids.length-1&&document.activeElement!==document.getElementById(ids[i+1]))issues.push(frame.label+' soft Next does not advance');
              }
            }else input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            if(captured.length!==1)issues.push(frame.label+' soft Send does not emit once');else keyboardSends++;
            await paint(frame.views.find(v=>v.me==='watch'),captured);seen++;
            if(root.querySelector('input[type=text]'))issues.push(frame.label+' watcher retains prior composer');
            await paint(state,captured);seen++;
            if(fields.some(n=>document.getElementById(n.id)===n||document.getElementById(n.id)?.value===draftValue(n)))issues.push(frame.label+' player/role transition retains stale private draft');else roles++;
            const another=frame.views.find(v=>v.me!=='watch'&&v.me!==state.me);
            await paint(another,captured);seen++;
            if([...root.querySelectorAll('input[type=text]')].some(n=>n.value.startsWith('A real typed draft')||n.value==='🌊🐟🎉'||n.value==='cat, dog, bird'))issues.push(frame.label+' direct player transition copies private draft');
            await paint(state,captured);seen++;
          }else{
            const choice=root.querySelector('button[data-v]:not(:disabled),button[data-p]:not(:disabled),button[data-kind]:not(:disabled),#drSpin,#rLock');
            if(choice){choice.click();await Promise.resolve();if(captured.length!==1)issues.push(frame.label+' choice tap does not emit once');else taps++;}
          }
          if(f.id==='rank-it'&&state.phase==='rank'&&me!=='watch'){
            const first=root.querySelector('.party-rank-name')?.textContent;
            root.querySelector('[data-dn="0"]').click();
            if(root.querySelectorAll('.party-rank-name')[1]?.textContent!==first)issues.push(frame.label+' down tap fails to reorder');
            root.querySelector('[data-up="1"]').click();
            if(root.querySelector('.party-rank-name')?.textContent!==first)issues.push(frame.label+' up tap fails to reorder');else reorders++;
            for(const [selector,key] of [['[data-dn="0"]','ArrowUp'],['[data-up="4"]','ArrowDown']]){
              const button=root.querySelector(selector);button.focus({preventScroll:true});
              button.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
              if(root.querySelector(selector)!==button||document.activeElement!==button)issues.push(frame.label+' boundary arrow loses ladder focus');
            }
          }
          if(root.scrollWidth>root.clientWidth+1)issues.push(frame.label+' scene horizontal overflow '+root.scrollWidth+'/'+root.clientWidth);
          if(document.documentElement.scrollWidth>document.documentElement.clientWidth+1)issues.push(frame.label+' document horizontal overflow '+document.documentElement.scrollWidth+'/'+document.documentElement.clientWidth);
          for(const n of root.querySelectorAll('button,input,select,textarea,summary,label.party-lie')){
            const r=n.getBoundingClientRect();if(!r.height||n.type==='radio')continue;
            smallest=Math.min(smallest,r.height,r.width);
            if(r.height<44||r.width<44)issues.push(frame.label+' short target '+(n.id||n.textContent.trim().slice(0,20))+' '+r.width.toFixed(1)+'×'+r.height.toFixed(1));
            if(n.tagName==='INPUT'&&parseFloat(getComputedStyle(n).fontSize)<16)issues.push(frame.label+' input font risks phone zoom');
            if(r.right>root.getBoundingClientRect().right+1||r.left<root.getBoundingClientRect().left-1)issues.push(frame.label+' target outside game width '+(n.id||n.textContent.trim().slice(0,20)));
          }
          if(me==='watch'&&[...root.querySelectorAll('input,button,select,textarea')].some(n=>!n.disabled&&!n.closest('#rematch')))issues.push(frame.label+' watcher has enabled input');
        }catch(e){issues.push(frame.label+': '+e.message);}
      }
    }
    if(f.id==='truth-dare'){
      const choose=f.frames.find(x=>x.views[0].phase==='choose');
      const actor=choose.views.find(v=>v.me===v.target),watch=choose.views.find(v=>v.me==='watch');
      reset();await paint(actor,[]);root.querySelector('[data-deck="wild"]').click();
      await paint(watch,[]);seen++;
      if(root.querySelector('[data-kind]'))issues.push('target to watcher retains the private choice UI');
      await paint(actor,[]);seen++;
      if(root.querySelector('[data-deck="classic"]')?.getAttribute('aria-pressed')!=='true')issues.push('returning target inherits a prior private deck draft');
    }
    report.push({id:f.id,seen,typing,ime,taps,keyboardSends,roles,reorders,smallest:Number.isFinite(smallest)?Math.round(smallest*10)/10:null,issues:[...new Set(issues)]});
    by('checks').innerHTML='<table><thead><tr><th>Game</th><th>Touch/typing views</th><th>Result</th></tr></thead><tbody>'+report.map(r=>'<tr><td>'+r.id+'</td><td>'+r.seen+'</td><td>'+(r.issues.length?r.issues.length+' issues':'PASS')+'</td></tr>').join('')+'</tbody></table>';
  }
  by('errors').textContent=report.filter(r=>r.issues.length).map(r=>r.id+'\\n'+r.issues.join('\\n')).join('\\n\\n');
  await fetch('/api/qa-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({touch:true,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',report})});
  reset();await load();by('verify-touch').disabled=false;
  by('status').textContent='TOUCH_COMPLETE '+report.reduce((n,r)=>n+r.seen,0)+' actual renders / '+report.length+' games / '+report.reduce((n,r)=>n+r.issues.length,0)+' issues';
};
by('verify-hud').onclick=async()=>{
  const report=[];by('verify-hud').disabled=true;by('errors').textContent='';
  const stress=stressState;
  for(const f of fixtures){
    const issues=[];let seen=0,watchers=0,done=0,longText=0,progress=0,contrastTexts=0,minContrast=Infinity,bodyBackground='';
    for(const me of ['p1','p2','p3','p4','watch']){
      reset();
      for(const frame of f.frames){
        const original=frame.views.find(v=>v.me===me);
        for(const state of [original,stress(original)]){
          try{
            await paint(state,[]);seen++;if(state!==original)longText++;
            const contrast=auditTextContrast(root);contrastTexts+=contrast.checked;minContrast=Math.min(minContrast,contrast.minimum??Infinity);bodyBackground=contrast.bodyBackground;for(const error of contrast.errors)issues.push(frame.label+' contrast '+JSON.stringify(error));
            const hud=root.querySelector('.party-hud');
            if(!hud)issues.push(frame.label+' missing game HUD');
            else{
              if(hud.dataset.phase!==state.phase)issues.push(frame.label+' stale HUD phase');
              if(!hud.querySelector('.party-phase')?.textContent.trim())issues.push(frame.label+' missing next-action/phase cue');
              if(me==='watch'){
                if(!hud.querySelector('.party-spectator:not([hidden])')&&!hud.querySelector('.party-phase')?.textContent.includes('Watching'))issues.push(frame.label+' missing watcher HUD');else watchers++;
              }else if(hud.querySelector('.party-spectator:not([hidden])'))issues.push(frame.label+' player HUD marked watcher');
              if(hud.querySelector('.party-progress'))progress++;
              const h=hud.getBoundingClientRect(),box=root.getBoundingClientRect();
              if(h.left<box.left-1||h.right>box.right+1)issues.push(frame.label+' HUD outside game bounds');
              const centerpiece=root.querySelector('.party-prompt,.party-emoji,.party-person,.party-rank-list');
              if(centerpiece&&h.bottom>centerpiece.getBoundingClientRect().top+1)issues.push(frame.label+' HUD overlaps centerpiece');
            }
            if(root.scrollWidth>root.clientWidth+1)issues.push(frame.label+' scene horizontal overflow with '+(state===original?'normal':'long')+' text');
            if(document.documentElement.scrollWidth>document.documentElement.clientWidth+1)issues.push(frame.label+' document horizontal overflow with '+(state===original?'normal':'long')+' text');
            if(f.id==='trivia'&&state.phase==='answer'&&innerWidth>=480&&innerHeight<=420){
              const controls=[...root.querySelectorAll('button[data-p]')];
              await Promise.all(controls.flatMap(n=>n.getAnimations()).map(a=>a.finished.catch(()=>{})));
              const answers=controls.map(n=>n.getBoundingClientRect());
              if(answers.length!==4||Math.abs(answers[0].top-answers[1].top)>1||Math.abs(answers[2].top-answers[3].top)>1||answers[2].top<=answers[0].top)issues.push(frame.label+' short-landscape quiz does not show two answer rows');
              if(answers.some(r=>r.width<44||r.height<56))issues.push(frame.label+' compact quiz shrinks an answer target');
            }
            if(state.phase==='done'){
              done++;
              if(!by('rematch'))issues.push('done missing reachable replay actions');
              if(root.querySelector('.party-scoreboard')?.textContent.includes('987654321'))issues.push('done displays cumulative night totals as match scores');
            }
            const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
            if(reduced)for(const n of root.querySelectorAll('.party-hud,.party-result,.party-choice,.party-meter>span')){
              const css=getComputedStyle(n);if(css.animationName!=='none'||parseFloat(css.transitionDuration)>0)issues.push(frame.label+' motion remains under reduced-motion');
            }
          }catch(e){issues.push(frame.label+': '+e.message);}
        }
      }
    }
    report.push({id:f.id,seen,watchers,done,longText,progress,contrastTexts,minContrast,bodyBackground,issues:[...new Set(issues)]});
    by('checks').innerHTML='<table><thead><tr><th>Game</th><th>HUD states</th><th>Result</th></tr></thead><tbody>'+report.map(r=>'<tr><td>'+r.id+'</td><td>'+r.seen+'</td><td>'+(r.issues.length?r.issues.length+' issues':'PASS')+'</td></tr>').join('')+'</tbody></table>';
  }
  by('errors').textContent=report.filter(r=>r.issues.length).map(r=>r.id+'\\n'+r.issues.join('\\n')).join('\\n\\n');
  await fetch('/api/qa-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hud:true,width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme||'day',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,report})});
  reset();await load();by('verify-hud').disabled=false;
  by('status').textContent='HUD_COMPLETE '+report.reduce((n,r)=>n+r.seen,0)+' actual renders / '+report.length+' games / '+report.reduce((n,r)=>n+r.issues.length,0)+' issues';
};
await load();
</script></body></html>`;

module.exports = { FIXTURES };
