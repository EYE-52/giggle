'use strict';
// Actual game views and server projections in a bounded Meet-like frame.
// No live services. The wide-parent pass catches window-only breakpoints.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const registry = require('../games/registry');
const { Clock, fixtures: build } = require('./skill-scenes-hud-fixtures');
const root = path.resolve(__dirname, '..');
const sizes = [[360,640],[420,700],[560,760],[800,600],[1440,900],[1024,768],[768,1024],[390,844]];
function cases() {
 return registry.list().map(meta => {
  const ctx = new Clock(meta.id, {rounds:3});
  ctx.roster = Array.from({length:Math.max(2,meta.minPlayers)},(_,i)=>({id:String.fromCharCode(97+i),name:['Ada','Morgan','Charlotte','Sam'][i]||'Robin'}));
  const def=registry.get(meta.id), state=def.create(ctx);
  let pid=state.turnPid||state.turn||state.drawer||'a'; if(!ctx.roster.some(p=>p.id===pid))pid='a';
  let S={strings:{},...def.view(state,pid),players:ctx.roster,me:pid,you:pid,hostId:'a',instanceId:'fit-'+meta.id,serverNow:ctx.now()};
  if(meta.id==='doodle-guess') S=build[meta.id].find(f=>f.label==='Drawing').state;
  if(meta.id==='draw-phone') S=build[meta.id].find(f=>f.label==='Draw').state;
  return {meta,S};
 });
}
const PAGE=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/skins.css"><link rel="stylesheet" href="/css/game-ui.css"></head><body class="game-playing is-embed"><section id="fit-panel"><div class="app" id="app"><header class="play-toolbar"><div class="play-title"><h1>Game</h1></div></header><main class="game-stage"><div id="gbody" data-layout="standard"></div></main></div></section><script type="module">
import {show,reset} from '/js/game-host.js';
let S; window.actions=[]; const api={send:a=>{window.actions.push(a);return true},now:()=>S?.serverNow||1700000000000,context:()=>({isHost:true,sound:false}),announce(){},cue(){},focus:n=>n?.focus({preventScroll:true}),resultsReady(){},loadError:e=>{throw e}};
window.load=async data=>{reset();document.querySelectorAll('link[data-fit-style]').forEach(n=>n.remove());const {meta}=data;S=data.S;document.body.dataset.game=meta.id;document.body.classList.toggle('game-immersive',meta.layout==='immersive');document.querySelector('.app').dataset.layout=meta.layout;document.querySelector('.play-toolbar').hidden=meta.layout==='immersive';document.querySelector('.game-stage').style.display=meta.layout==='immersive'?'contents':'';document.querySelector('.play-title h1').textContent=meta.name;const el=document.querySelector('#gbody');el.innerHTML='';el.dataset.game=meta.id;el.dataset.layout=meta.layout;await show(el,meta.id,S,api,meta);await document.fonts.ready;};
</script></body></html>`;
const baselineCache=new Map();
function fixture() {return http.createServer((req,res)=>{
 const u=new URL(req.url,'http://fit'); if(u.pathname==='/') {res.setHeader('Content-Type','text/html');return res.end(PAGE)}
 const file=path.resolve(root,'public','.'+decodeURIComponent(u.pathname));if(!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403);return res.end()}
 if(process.env.FIT_BASELINE==='1'&&/\.(css|js|mjs)$/.test(file)){let data=baselineCache.get(file);if(!data){try{data=require('node:child_process').execFileSync('git',['show','HEAD:apps/games/public'+u.pathname],{maxBuffer:10*1024*1024});baselineCache.set(file,data)}catch{}}if(data){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(data)}}
 fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end()}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(b)});
})}
async function measure(page) {const result=await page.evaluate(()=>{
 const root=document.querySelector('#gbody')||document.body,bounds=root.getBoundingClientRect(),visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const box=n=>{const r=n.getBoundingClientRect();return {selector:n.id?'#'+n.id:n.className?.baseVal||n.className||n.tagName,x:r.x,y:r.y,w:r.width,h:r.height}};
 const fieldBox=n=>{const r=n.getBoundingClientRect();let left=Math.max(0,r.left,bounds.left),right=Math.min(innerWidth,r.right,bounds.right),top=Math.max(0,r.top,bounds.top),bottom=Math.min(innerHeight,r.bottom,bounds.bottom);for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),a=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,a.left);right=Math.min(right,a.right)}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,a.top);bottom=Math.min(bottom,a.bottom)}}return {...box(n),visibleW:Math.max(0,right-left),visibleH:Math.max(0,bottom-top)}};
 const primaries=[...root.querySelectorAll('.tb-primary,.gk-primary,.round-primary,.b6-primary,.party-primary,button[type=submit],.bk-primary,[data-roll]')].filter(visible).map(fieldBox);
 const fields=[...root.querySelectorAll('canvas:not(#pk-radar),.bk-stage>svg,.fl-chart,.chboard,.cr-board,.ld-board,.b3-board')].filter(n=>visible(n)&&n.getBoundingClientRect().width>0).map(fieldBox);
 const criticalControls=[...root.querySelectorAll('.b4-field button,.b4-field input')].filter(visible).map(fieldBox);
 const clippedControls=criticalControls.filter(r=>r.visibleW<r.w-2||r.visibleH<r.h-2);
 const bad=[...root.querySelectorAll('*')].filter(n=>{if(!visible(n))return false; const r=n.getBoundingClientRect(); if(r.width<1||r.height<1)return false; const clipped=n.closest('.pl-seats,.b6-scroll,.bk-log,.dg-feed,.dp-roster,.round-roster');return !clipped&&(r.right>bounds.right+2||r.left<bounds.left-2)}).slice(0,12).map(box);
 return {container:{name:getComputedStyle(root).containerName,type:getComputedStyle(root).containerType},criticalControls,clippedControls,root:box(root),overflow:document.documentElement.scrollWidth>innerWidth+1,primary:primaries,fields,bad,offscreen:primaries.filter(r=>r.y<0||r.y+r.h>innerHeight+1||r.x<0||r.x+r.w>innerWidth+1||r.visibleW<r.w-2||r.visibleH<r.h-2),tiny:fields.filter(r=>Math.min(r.visibleW,r.visibleH)<180)};
});const child=page.frames?.().find(f=>f.url().includes('/game-assets/'));if(child){const inner=await measure(child);return {...result,embedded:inner,overflow:result.overflow||inner.overflow,primary:[...result.primary,...inner.primary],fields:[...result.fields,...inner.fields],offscreen:[...result.offscreen,...inner.offscreen],clippedControls:[...result.clippedControls,...inner.clippedControls],tiny:[...result.tiny,...inner.tiny]}}return result;}
async function drawingResize(page, id, out) {
 if (!['doodle-guess','draw-phone','draw-off','sketchy-impostor'].includes(id)) return;
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{const app=document.querySelector('.app');app.style.width='420px';app.style.height='700px';app.style.minHeight='0';app.style.overflowY='auto';const panel=document.querySelector('#fit-panel');panel.style.height='700px';panel.style.overflow='hidden';});
 await page.waitForTimeout(120);
 const canvas=page.locator('#gbody canvas').first();
 const draw=async()=>{const r=await canvas.boundingBox();await page.mouse.move(r.x+r.width*.25,r.y+r.height*.25);await page.mouse.down();await page.mouse.move(r.x+r.width*.75,r.y+r.height*.75,{steps:8});await page.mouse.up();};
 await draw();
 const before=await canvas.evaluate(c=>{window.fitCanvas=c;return c.toDataURL()});
 const first=await page.evaluate(()=>window.actions.findLast(a=>a.stroke));
 assert(first,id+' accepts an actual pointer stroke');
 assert(Math.abs(first.stroke.pts[0][0]-.25)<.03&&Math.abs(first.stroke.pts.at(-1)[1]-.75)<.03,id+' maps pointer input to normalized paper coordinates');
 for(const width of [360,560,420,800,420]){await page.evaluate(w=>document.querySelector('.app').style.width=w+'px',width);await page.waitForTimeout(80);assert(await canvas.evaluate(c=>c===window.fitCanvas),id+' never remounts on resize');assert((await canvas.evaluate(c=>c.toDataURL()))===before,id+' retains ink during container-only resize');}
 const focus=page.locator('#dFocus,#pFocus');if(await focus.count()){await focus.click();await page.waitForTimeout(160);const focused=await measure(page);assert.equal(focused.tiny.length,0,id+' focus keeps a usable sheet');assert((await canvas.evaluate(c=>c.toDataURL()))===before,id+' focus preserves ink');if(process.env.FIT_SHOTS==='1')await page.screenshot({path:path.join(out,id+'-focus.png')});await focus.click();await page.waitForTimeout(120);}
 const bounds=await page.locator('#gbody').evaluate(n=>n.getBoundingClientRect().bottom);
 assert(bounds<=701,id+' follows the bounded panel height, not the 900px window');
 await draw();const last=await page.evaluate(()=>window.actions.findLast(a=>a.stroke));
 assert(Math.abs(last.stroke.pts[0][0]-.25)<.03&&Math.abs(last.stroke.pts.at(-1)[1]-.75)<.03,id+' pointer mapping remains correct after resizing');
}
async function run(){
 const {chromium}=require('playwright'),out=path.resolve(process.env.FIT_ARTIFACTS||path.join(root,'../../artifacts/narrow-fit/after'));
 fs.mkdirSync(out,{recursive:true});const server=fixture();let browser;const prior=process.env.FIT_MERGE==='1'&&fs.existsSync(path.join(out,'measurements.json'))?JSON.parse(fs.readFileSync(path.join(out,'measurements.json'))):{rows:[],errors:[]};const selectedIds=process.env.FIT_GAMES?.split(',')||[];const rows=prior.rows.filter(r=>!selectedIds.includes(r.id)),errors=prior.errors.filter(r=>!selectedIds.includes(r.id));
 try {await new Promise((r,j)=>{server.once('error',j);server.listen(Number(process.env.FIT_PORT||8392),'127.0.0.1',r)});
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||(fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)});
 const selected=process.env.FIT_GAMES?.split(',');
 await registry.get('pocket-karts').initialize();
 for(const data of cases().filter(c=>!selected||selected.includes(c.meta.id))){
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',...(process.env.FIT_VIDEO==='1'?{recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:900}}}:{})});const page=await context.newPage();
  page.on('pageerror',e=>errors.push({id:data.meta.id,error:e.stack||e.message}));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.load);await page.evaluate(data=>window.load(data),data);if(data.meta.runtime?.type==='frame'){await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('#play canvas,#play [role=grid]'),null,{timeout:20000});}
  for(const [width,height] of sizes)for(const theme of ['day','night']){
   await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForTimeout(140);
   const result=await measure(page);assert.deepEqual(result.container,{name:'game',type:'size'},data.meta.id+' keeps the named size container');if(['doodle-guess','draw-phone','draw-off','sketchy-impostor','chain-reaction','chess','checkers','kalah','ludo','four-in-a-row','reversi','fleet-duel','block-stack','penalty-kicks'].includes(data.meta.id))assert(result.fields.length,data.meta.id+' has a rendered playfield');rows.push({id:data.meta.id,width,height,theme,...result});
   if(process.env.FIT_SHOTS==='1')await page.screenshot({path:path.join(out,data.meta.id+'-'+width+'-'+theme+'.png')});
  }
  // A bounded call panel in a large window; only its container resizes.
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{const app=document.querySelector('.app');app.style.width='420px';app.style.margin='0';app.style.height='700px';app.style.minHeight='0';app.style.overflowY='auto';const panel=document.querySelector('#fit-panel');panel.style.height='700px';panel.style.overflow='hidden';});await page.waitForTimeout(100);
  const bounded=await measure(page);assert(bounded.root.y+bounded.root.h<=701,data.meta.id+' obeys the bounded host height');rows.push({id:data.meta.id,width:420,height:700,theme:'night',wideParent:true,...bounded});
  if(process.env.FIT_AUDIT!=='1')await drawingResize(page,data.meta.id,out);
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({rows,errors},null,2));
  const video=page.video();await context.close();if(video)fs.renameSync(await video.path(),path.join(out,'video',data.meta.id+'.webm'));console.log('FIT '+data.meta.id);
 }
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({rows,errors},null,2));
 const failures=rows.filter(r=>r.overflow||r.offscreen.length||r.tiny.length||r.clippedControls?.length);
 console.log(JSON.stringify({games:new Set(rows.map(r=>r.id)).size,measurements:rows.length,failures:failures.length,errors}));
 if(process.env.FIT_AUDIT!=='1'){assert.equal(errors.length,0,'game views have no uncaught errors');assert.equal(failures.length,0,'container fit failures: '+failures.slice(0,8).map(r=>r.id+' '+r.width+' '+JSON.stringify({overflow:r.overflow,offscreen:r.offscreen,tiny:r.tiny,clippedControls:r.clippedControls})).join('\n'))}
 }finally {await browser?.close();await new Promise(r=>server.close(r))}
}
module.exports={cases,fixture,measure,sizes};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
