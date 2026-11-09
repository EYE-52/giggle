const {chromium}=require('playwright');const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const out=__dirname;const results=[];
async function main(){const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
async function start(game,theme='day',width=390){const context=await browser.newContext({viewport:{width,height:width===390?844:900},isMobile:width===390,hasTouch:width===390});const page=await context.newPage();await page.addInitScript(theme=>{localStorage.setItem('pb_theme',theme);localStorage.setItem('giggle:game-screen-prompt-dismissed','1');const N=WebSocket;window.WebSocket=class extends N{constructor(...a){super(...a);this.addEventListener('message',e=>{try{const s=JSON.parse(e.data);if(s.t==='state')window.qaState=s}catch{}})}}},theme);await page.goto('http://127.0.0.1:8320/practice/?game='+game);await page.waitForFunction(()=>!document.querySelector('#practiceStart').disabled);await page.evaluate(()=>document.querySelector('#practiceSetup').requestSubmit());await page.waitForFunction(()=>document.querySelector('#practiceStatus').textContent.includes('seats ready'));const seat=page.frames().find(f=>new URL(f.url()).searchParams.get('seat')==='1');await seat.locator('#howtoGo').click();await seat.waitForFunction(()=>window.qaState&&!window.qaState.preparing);await seat.evaluate(()=>document.fonts.ready);return{context,page,seat};}
try{
if(!process.env.QA_NIGHT_ONLY){
for(const game of ['hot-takes','dare-roulette','lyric-fill'])for(const width of [390,1440]){const {context,seat}=await start(game,'day',width);const read=()=>seat.locator('.gk-hud-timer').evaluate(n=>({text:n.textContent,left:parseFloat(n.style.getPropertyValue('--gk-timer-left'))}));const a=await read(),t=Date.now();await new Promise(r=>setTimeout(r,6000));const b=await read(),elapsed=Date.now()-t;const delta=parseInt(a.text)-parseInt(b.text);assert(delta>=5&&delta<=8,game+' real six-second clock: '+JSON.stringify({a,b,elapsed}));assert(b.left<a.left,game+' progress drains');results.push({game,width,clock:{a,b,elapsed,delta}});await context.close();}
{
 const {context,seat}=await start('backronyms');const count=await seat.locator('.pl-dots>li').count();const rounds=await seat.evaluate(()=>window.qaState.rounds);assert.equal(count,rounds);assert.equal(count,6);results.push({game:'backronyms',dots:count,rounds});await context.close();
}
{
 const {context,seat}=await start('chess');const src=await seat.locator('#chsq-g8 img').getAttribute('src');assert.equal(src,await seat.locator('#chsq-b8 img').getAttribute('src'));assert.match(src,/bn\.webp$/);results.push({game:'chess',g8:src});await context.close();
}
{
 const {context,page,seat}=await start('ballpark');const input=seat.locator('[data-input]'),button=seat.locator('.round-primary');assert(await button.isDisabled());await input.fill('42');assert(!(await button.isDisabled()));const r=await button.boundingBox();assert(r.y+r.height<=844);await page.screenshot({path:path.join(out,'after','phone','ballpark-enabled.png')});results.push({game:'ballpark',emptyDisabled:true,filledEnabled:true});await context.close();
}
{
 const {context,page,seat}=await start('fleet-duel');const button=seat.locator('[data-confirm-ship]');assert.equal(await button.getAttribute('aria-disabled'),'true');assert.match(await seat.locator('.fl-reason').textContent(),/Tap a square/);await seat.locator('.fl-chart [data-square="0"]').click();assert.equal(await button.getAttribute('aria-disabled'),'false');assert(await seat.locator('.fl-ships button').evaluateAll(ns=>ns.length===5&&ns.every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})));await page.screenshot({path:path.join(out,'after','phone','fleet-duel-enabled.png')});results.push({game:'fleet-duel',reason:true,placedEnabled:true,allShipsVisible:true});await context.close();
}
{
 const {context,page,seat}=await start('five-second');await seat.waitForFunction(()=>window.qaState.phase==='vote');assert.match(await seat.locator('#gbody').innerText(),/No answer was sent in time/);const roles=await seat.locator('.pl-state').allTextContents();assert(roles.includes('No answer'));assert(!roles.includes('Answered'));await page.screenshot({path:path.join(out,'after','phone','five-second-no-answer.png')});results.push({game:'five-second',roles});await context.close();
}
{
 const {context,page,seat}=await start('echo-pads');await seat.waitForFunction(()=>window.qaState.phase==='reveal',null,{timeout:20000});const S=await seat.evaluate(()=>window.qaState);assert(Object.values(S.last.reached).every(n=>n===0));assert(Object.values(S.scores).every(n=>n===0));await page.screenshot({path:path.join(out,'after','phone','echo-pads-zero.png')});results.push({game:'echo-pads',scores:S.scores,reached:S.last.reached});await context.close();
}
}
for(const game of ['chess','hot-potato','dial-in','draw-off','word-grid','backronyms']){const{context,page,seat}=await start(game,'night');assert(await seat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));fs.mkdirSync(path.join(out,'after','night'),{recursive:true});await page.screenshot({path:path.join(out,'after','night',game+'.png')});results.push({game,theme:'night',overflow:false});await context.close();}
console.log('GLM_REGRESSIONS_PASS',results.length);
}finally{fs.writeFileSync(path.join(out,process.env.QA_NIGHT_ONLY?'regressions-night.json':'regressions.json'),JSON.stringify(results,null,2));await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1});
