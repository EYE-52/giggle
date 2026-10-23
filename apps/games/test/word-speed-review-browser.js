'use strict';
// Native UI review fixture. Number results come from production engine actions;
// Memory preparation/refusal are deliberate view/API conditions. No claim of
// native production transport, physical device, RTC, or natural-clock acceptance.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public');
const {fixtures}=require('./skill-scenes-hud-fixtures');
const number=require('../games/number-hunt/server');
const players=['a','b','c'].map((id,i)=>({id,name:['Ada the extraordinarily patient detective','Ben <script> & the curious observer','Cy'][i]}));
const ctx={content:()=>({}),allPlayers:()=>players,players:()=>players,settings:()=>({rounds:1}),now:()=>1000,later(){},award(){},broadcast(){}};
const s=number.create(ctx);s.secret=42;
number.onAction(s,ctx,'c',{guess:10});for(const pid of ['a','b','c'])number.onAction(s,ctx,pid,{guess:42});
const states={number:{...number.view(s,'a'),players,me:'a',instanceId:'review-number'},memory:{...fixtures['memory-tray'].find(f=>f.label==='Recall').state,instanceId:'review-memory',endsAt:10000}};
const page=String.raw`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Word and speed repair review</title><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><style>body{margin:0;padding:12px}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}nav button,nav select{min-height:44px;font:inherit;padding:8px}#frame{margin:auto;max-width:100%;border:1px solid var(--line);overflow:auto;background:var(--bg)}#gbody{min-width:0;width:100%}#note{font-size:14px;overflow-wrap:anywhere}#frame:has(.sk-memory){min-height:350px}</style><body class="game-playing"><nav><button id="memory">Memory recall</button><button id="prepare">Preparing</button><button id="ready">Ready</button><button id="reject">Refuse next Save</button><button id="number">Tied round</button><button id="final">Tied final</button><button id="night">Night</button><select id="size" aria-label="Stage size"><option value="390,650">Phone390</option><option value="320,580">Phone320</option><option value="568,320">Embed568×320</option><option value="768,850">Tablet768</option><option value="1100,700">Desktop1100</option></select></nav><div id="frame"><div id="gbody"></div></div><p id="note">Controlled current-source UI fixture. Memory readiness/refusal are deliberate conditions; Number ties use real engine actions.</p><script type="module">
const states=await(await fetch('/states')).json(),el=document.querySelector('#gbody'),note=document.querySelector('#note');let view,S,kind,rejected=false;
const api={now:()=>1000,send:a=>{if(rejected){rejected=false;return false;}S={...S,myRecall:a.recall.split(',').map(w=>w.trim().toLowerCase()),submitted:[S.me]};view.render(el,S,api);return true;}};
async function show(which){view?.dispose?.(el);kind=which;view=(await import('/js/games/'+(which==='number'?'number-hunt':'memory-tray')+'.js')).default;S=structuredClone(states[which]);view.mount?.(el,api);view.render(el,S,api);}
for(const id of ['memory','number'])document.querySelector('#'+id).onclick=()=>show(id);
document.querySelector('#prepare').onclick=()=>{if(kind!=='memory')return;S={...S,preparing:true};view.render(el,S,api);};
document.querySelector('#ready').onclick=()=>{if(kind!=='memory')return;S={...S,preparing:false};view.render(el,S,api);};
document.querySelector('#reject').onclick=()=>{rejected=true;note.textContent='Next Memory Save returns false. The draft should stay and retry feedback should appear.';};
document.querySelector('#final').onclick=async()=>{await show('number');S={...S,phase:'done',spectator:true,me:'watch'};view.render(el,S,api);};
document.querySelector('#night').onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='night'?'day':'night';
const resize=()=>{const [w,h]=document.querySelector('#size').value.split(',');const f=document.querySelector('#frame');f.style.width=w+'px';f.style.height=h+'px';};document.querySelector('#size').onchange=resize;resize();await show('memory');
</script></html>`;
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(page);}if(url.pathname==='/states'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(states));}const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}fs.readFile(file,(err,data)=>{if(err){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);});});
if(require.main===module)server.listen(Number(process.env.WORD_SPEED_REVIEW_PORT||8473),'127.0.0.1',()=>console.log('WORD_SPEED_REVIEW http://127.0.0.1:'+(process.env.WORD_SPEED_REVIEW_PORT||8473)));
module.exports={server,states};
