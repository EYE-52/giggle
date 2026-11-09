const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
const root=__dirname, mode=process.env.QA_MODE||'live-before';
const games=require('../../apps/games/games/registry').list().map(g=>g.id).sort();
async function run(){
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const prior=path.join(root,mode+'-metrics.json');const selected=process.env.QA_GAMES?.split(',');const results=selected&&fs.existsSync(prior)?JSON.parse(fs.readFileSync(prior)).filter(x=>!selected.includes(x.game)):[];let cursor=0;
 const cases=games.flatMap(game=>['desktop','phone'].map(device=>({game,device})));
 if(process.env.QA_GAMES)cases.splice(0,cases.length,...cases.filter(x=>process.env.QA_GAMES.split(',').includes(x.game)));
 async function worker(){while(cursor<cases.length){const {game,device}=cases[cursor++];let context;
 try{
 context=await browser.newContext({viewport:device==='phone'?{width:390,height:844}:{width:1440,height:900},isMobile:device==='phone',hasTouch:device==='phone',permissions:['camera','microphone']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('pb_theme','day');localStorage.setItem('giggle:game-screen-prompt-dismissed','1');const Native=WebSocket;window.WebSocket=class extends Native{constructor(...a){super(...a);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.t==='state')window.qaState=m;}catch{}})}}});
 await page.goto('http://127.0.0.1:8320/practice/?game='+game);await page.waitForFunction(()=>!document.querySelector('#practiceStart').disabled);await page.evaluate(()=>document.querySelector('#practiceSetup').requestSubmit());
 await page.waitForFunction(()=>document.querySelector('#practiceStatus').textContent.includes('seats ready'),null,{timeout:30000});
 const seat=page.frames().find(f=>new URL(f.url()).searchParams.get('seat')==='1');
 await seat.locator('#howtoGo').click();if(game==='pocket-karts'){await seat.waitForSelector('.pk');await seat.waitForFunction(()=>document.querySelector('#gamePreparation')?.hidden!==false,null,{timeout:60000});await page.waitForTimeout(2000);}else await seat.waitForFunction(()=>window.qaState&&!window.qaState.preparing,null,{timeout:30000});await seat.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1200);
 await seat.evaluate(()=>{window.qaShifts=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.qaShifts.push({value:e.value,recent:e.hadRecentInput,sources:e.sources.map(s=>s.node?.className).filter(x=>typeof x==='string')})}).observe({type:'layout-shift'});});
 const metrics=()=>seat.evaluate(()=>{const r=s=>{const n=document.querySelector(s);if(!n)return null;const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,text:n.textContent.slice(0,180),scroll:n.scrollWidth>n.clientWidth+1}};return {phase:window.qaState?.phase,state:window.qaState,viewport:{w:innerWidth,h:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,rects:Object.fromEntries(['.gk-hud','.gk-hud-progress','.gk-hud-timer','.pl-live','.round-primary','.wp-primary','.b4-primary','.b6-primary','.bk-board','.bk-side','.play-toolbar','.b2-play','.b2-actions','.b2-work','.b2-piece','.b4-field','.b4-actions','.b6-field','.wp-play','.wp-actions','.fl-chart-col','.fl-placement','.bk-head','.bk-status','.bk-tools','.pl-seats','.b2-primary','.fl-place-actions','.bk-stage','#drSpin','#rPad','.ck','.cp-ready-row'].map(s=>[s,r(s)])),shifts:window.qaShifts,text:document.body.innerText.slice(0,5000)}});
 const a=await metrics();const dir=path.join(root,mode,device);fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,game+'-a.png')});
 await page.waitForTimeout(Number(process.env.QA_DELAY)||(mode==='after'?6000:300));const b=await metrics();await page.screenshot({path:path.join(dir,game+'-b.png')});
 results.push({game,device,a,b,errors});console.log(game,device,a.phase,'=>',b.phase,'overflow',b.overflow,'shifts',b.shifts.length);
 }catch(e){results.push({game,device,error:e.message});console.log('ERROR',game,device,e.message.slice(0,130))}finally{await context?.close();fs.writeFileSync(path.join(root,mode+'-metrics.json'),JSON.stringify(results,null,2));}
 }}
 await Promise.all([worker(),worker(),worker()]);await browser.close();
}
run().catch(e=>{console.error(e);process.exitCode=1});
