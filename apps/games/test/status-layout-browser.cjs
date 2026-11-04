'use strict';
// Optional local browser regression: shipping renderers/shared CSS, projected
// engine snapshots and explicit UI-only status updates. No live rooms/accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {fixtures,Clock}=require('./skill-scenes-hud-fixtures');
const root=path.resolve(__dirname,'..');
const out=process.env.STATUS_LAYOUT_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'giggle-status-layout-'));
fs.mkdirSync(out,{recursive:true});
const baseline=process.env.STATUS_LAYOUT_BASELINE==='1';
const baselineRef=process.env.STATUS_LAYOUT_BASELINE_REF;
if(baseline)assert(baselineRef,'STATUS_LAYOUT_BASELINE_REF must name the immutable comparison commit');
const originalStatusCSS=baseline?execFileSync('git',['show',baselineRef+':apps/games/public/css/word-chain-world.css'],{cwd:root}):null;
const scenarios={};
const wordFeedback=[];
for(const id of ['chess','word-chain','number-hunt','reaction-tap']){
  const list=fixtures[id];
  scenarios[id]=list.find(s=>!s.state.spectator&&s.state.phase!=='done').state;
}
// A starter is selected randomly by the engine; freeze only this visual
// projection so baseline/fixed screenshots show the same word and ribbon.
scenarios['word-chain']={...scenarios['word-chain'],current:'apple',used:['apple']};
{
 const ctx=new Clock('word-chain'),game=require('../games/word-chain/server'),s=game.create(ctx);
 for(const word of ['@','zzqwxzz']){
  game.onAction(s,ctx,s.turnPid,{word});
  const feedback=game.view(s,s.turnPid).myFeedback;
  assert(feedback?.ok===false&&feedback.message,'fixture has an actual server validation failure');
  wordFeedback.push({...feedback});
 }
}
for(const id of ['checkers','kalah']){
 const ctx=new Clock(id),game=require('../games/'+id+'/server'),s=game.create(ctx);
 scenarios[id]={...game.view(s,'a'),players:ctx.roster,me:'a',you:'a',hostId:'a',instanceId:'status-'+id,serverNow:ctx.now()};
}
function html(id){return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/game-ui.css"><body class="game-playing ${['chess','checkers','kalah'].includes(id)?'game-immersive':''}"><div id="app" class="app" ${['chess','checkers','kalah'].includes(id)?'data-layout="immersive"':''}><div id="gbody" data-layout="${['chess','checkers','kalah'].includes(id)?'immersive':'standard'}"></div></div><script type="module">
const id=${JSON.stringify(id)},root=document.querySelector('#gbody'),view=(await import('/js/games/'+id+'.js')).default;
let S=await(await fetch('/state?id='+id)).json();
const api={now:()=>S.serverNow,send:()=>true,context:()=>({isHost:true}),focus:n=>n?.focus({preventScroll:true}),announce(){},toast(){},sound(){},cue(){},ready(){return true},resultsReady(){},voice:{subscribe:()=>()=>{}}};
view.mount?.(root,api);
async function settle(){await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.sheet?Promise.resolve():new Promise((resolve,reject)=>{l.addEventListener('load',resolve,{once:true});l.addEventListener('error',()=>reject(Error('stylesheet '+l.href)),{once:true});})));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
async function paint(patch={}){S={...S,...patch};(view.update||view.render).call(view,root,S,api);await settle();}
await paint();window.qa={paint,state:()=>S,dispose:()=>view.dispose?.(root),ready:true};
</script></body></html>`;}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(html(u.searchParams.get('id')));return;}
 if(u.pathname==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(scenarios[u.searchParams.get('id')]));return;}
 const file=path.resolve(root,'public','.'+u.pathname);if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('not found');return;}
 res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(baseline&&u.pathname==='/css/word-chain-world.css'?originalStatusCSS:fs.readFileSync(file));
});
let browser;const rows=[];
const dims=[[320,568],[390,844],[480,800],[568,320],[600,360],[1024,600],[1280,800]];
const runs=dims.flatMap(([width,height])=>Object.keys(scenarios).map(id=>({width,height,id})));
for(const [width,height]of [[320,568],[568,320]])for(const textSize of [14,20])runs.push({width,height,id:'word-chain',textSize});
function rect(page,selector){return page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});}
(async()=>{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await chromium.launch({headless:true});
 for(const {width,height,id,textSize}of runs){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,permissions:[]}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  try{
   await page.goto('http://127.0.0.1:'+server.address().port+'/fixture?id='+id);await page.waitForFunction(()=>window.qa?.ready);
   if(textSize)await page.addStyleTag({content:'#gbody #wcFeedback {font-size:'+textSize+'px}'});
   const board=['chess','checkers','kalah'].includes(id),selector=board?'.bk-stage':id==='word-chain'?'#wcChallenge':id==='number-hunt'?'.nh-range':'.rt-pad';
   if(!await page.locator(selector).count()){rows.push({id,width,height,unsupportedSelector:selector});continue;}
   const transitions=id==='word-chain'
    ? wordFeedback.map(feedback=>({label:feedback.code,patch:{myFeedback:feedback}})).concat(['timeout','empty','repeat','challenged','left'].map(reason=>({label:'turn notice '+reason,patch:{myFeedback:null,lastLife:{pid:'b',reason,lives:1},players:[{id:'a',name:'Ada'},{id:'b',name:'W'.repeat(16)},{id:'c',name:'Cam'}]}})),[{label:'other player turn',patch:{myFeedback:null,lastLife:null,turnPid:'b',turnNo:2,players:[{id:'a',name:'Ada'},{id:'b',name:'W'.repeat(16)},{id:'c',name:'Cam'}]}}])
    : [{label:board?'preparing status':id==='reaction-tap'?'false-start notice':'past-guesses feedback',patch:board?{preparing:true}:id==='reaction-tap'?{fouled:['b']}:{guesses:{a:[12,36,58]}}}];
   for(const transition of transitions){
    if(id==='word-chain')await page.evaluate(()=>window.qa.paint({myFeedback:null,lastLife:null,turnPid:'a',turnNo:1}));
    const before=await rect(page,selector),surfaceBefore=await rect(page,id==='word-chain'?'.wc-target':selector);
    if(!textSize&&width===320&&id==='word-chain'&&transition.label==='dictionary')await page.screenshot({path:path.join(out,(baseline?'before':'after')+'-word-chain-320-idle.png'),fullPage:true});
    await page.evaluate(patch=>window.qa.paint(patch),transition.patch);
    const after=await rect(page,selector),surfaceAfter=await rect(page,id==='word-chain'?'.wc-target':selector);const shift={x:after.x-before.x,y:after.y-before.y,width:after.width-before.width,height:after.height-before.height},surfaceShift={x:surfaceAfter.x-surfaceBefore.x,y:surfaceAfter.y-surfaceBefore.y,width:surfaceAfter.width-surfaceBefore.width,height:surfaceAfter.height-surfaceBefore.height};
    const feedback=id==='word-chain'?await page.locator('#wcFeedback').evaluate(e=>({text:e.textContent,visibleHeight:e.clientHeight,contentHeight:e.scrollHeight,lineHeight:getComputedStyle(e).lineHeight,fontSize:getComputedStyle(e).fontSize})):null;
    const r={id,label:transition.label,viewport:{width,height},textSize:textSize||'shipping',selector,before,after,shift,surfaceBefore,surfaceAfter,surfaceShift,feedback,errors,documentOverflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)};rows.push(r);
    if(!textSize&&(width===320&&id==='word-chain'&&transition.label==='dictionary'||width===1024&&id==='checkers'))await page.screenshot({path:path.join(out,(baseline?'before':'after')+'-'+id+'-'+width+'.png'),fullPage:true});
    assert.deepEqual(errors,[],id+' browser errors');
    if(!baseline){assert(Math.abs(shift.x)<1&&Math.abs(shift.y)<1,id+' '+transition.label+' shifted interaction '+JSON.stringify(shift));assert(Object.values(surfaceShift).every(n=>Math.abs(n)<1),id+' '+transition.label+' shifted/resized surface '+JSON.stringify(surfaceShift));assert.equal(r.documentOverflow,0,id+' horizontal overflow');if(feedback)assert(feedback.contentHeight<=feedback.visibleHeight+1,'feedback remains fully readable');}
   }
  }finally{await context.close();}
 }
 fs.writeFileSync(path.join(out,baseline?'baseline.json':'results.json'),JSON.stringify({baseline,baselineRef:baseline?baselineRef:null,rows,scope:'Actual shipping renderers/CSS;synthetic projected status transitions;Word Chain errors are emitted by the actual local engine;Chromium,DPR1,local network,no physical-device/live-room claim'},null,2)+'\n');
 console.log(JSON.stringify({baseline,cases:rows.length,shifts:rows.filter(r=>r.shift&&(Math.abs(r.shift.y)>=1||Math.abs(r.shift.x)>=1)).map(r=>({id:r.id,viewport:r.viewport,shift:r.shift})),unsupported:rows.filter(r=>r.unsupportedSelector)}));
})().catch(e=>{fs.writeFileSync(path.join(out,'failed-'+(baseline?'baseline':'verification')+'.json'),JSON.stringify({error:e.stack,rows},null,2));console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
