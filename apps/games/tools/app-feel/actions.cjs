const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../../../artifacts/app-feel/after'),base=process.env.APP_FEEL_URL||'http://127.0.0.1:8380';
(async()=>{const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const c=await b.newContext({viewport:{width:390,height:902},hasTouch:true,recordVideo:{dir:path.join(out,'video'),size:{width:560,height:920}}}),p=await c.newPage(),checks=[];
try{
 await p.goto(base+'/practice/?game=four-in-a-row');await p.locator('#practiceStart').click();await p.waitForFunction(()=>document.querySelector('#practiceStatus').textContent.includes('seats ready'));
 const a=p.frames().find(f=>new URL(f.url()).searchParams.get('seat')==='1'),other=p.frames().find(f=>new URL(f.url()).searchParams.get('seat')==='2');
 await a.locator('#howtoGo').click();await a.locator('.bk-stage').waitFor();await p.waitForTimeout(400);
 await a.locator('.bk-match>summary').click();await a.locator('[data-resign]').click();await a.locator('[data-confirm-resign]').click();await a.locator('.bk-final').waitFor({state:'visible'});assert.equal(await a.locator('.app-panel[open]').count(),0,'game result closes its old action sheet');
 await p.screenshot({path:path.join(out,'result-after-resign.png')});await a.locator('#bRematch').click();await a.locator('.bk-final').waitFor({state:'hidden'});checks.push('Resign confirmation, authority result, sheet closure and usable Rematch');
 await a.locator('.bk-match>summary').click();await a.locator('[data-offer-draw]').click();await p.keyboard.press('Escape');await p.locator('#practiceTab2').click();
 await other.waitForFunction(()=>document.querySelector('.bk-status-text')?.textContent.includes('Draw offered'));
 await other.locator('.bk-match>summary').click();await other.locator('[data-accept-draw]').click();await other.locator('.bk-final').waitFor({state:'visible'});assert.equal(await other.locator('.app-panel[open]').count(),0);await p.screenshot({path:path.join(out,'draw-reply-result.png')});checks.push('Draw notification, other seat reply, settled result and modal closure');
 await p.locator('#practiceStop').click();
 await p.goto(base+'/practice/?game=chess');await p.locator('#practiceStart').click();await p.waitForFunction(()=>document.querySelector('#practiceStatus').textContent.includes('seats ready'));const chess=p.frames().find(f=>new URL(f.url()).searchParams.get('seat')==='1');await chess.locator('#howtoGo').click();await chess.locator('.bk-stage').waitFor();await p.waitForTimeout(400);
 await chess.locator('.chhist-wrap>summary').focus();
 for(const selector of ['#ch-flip','.bk-help>summary','.bk-match>summary']){await p.keyboard.press('Tab');assert(await chess.locator(selector).evaluate(n=>n===document.activeElement),'toolbar Tab order follows visible tools');}
 const top=await chess.locator('[data-seat="0"]').evaluate(n=>n.getBoundingClientRect().y);await chess.locator('#ch-flip').click();assert.equal(await chess.locator('[data-sq]').first().getAttribute('data-sq'),'h1');assert((await chess.locator('[data-seat="0"]').evaluate(n=>n.getBoundingClientRect().y))>top,'black player follows flipped board');checks.push('Chess flip follows board orientation and keeps player identity');
 await p.screenshot({path:path.join(out,'chess-flipped.png')});await p.locator('#practiceStop').click();
}finally{await c.close();fs.writeFileSync(path.join(out,'../action-checks.json'),JSON.stringify({pass:checks.length===3,checks,video:path.relative(out,await p.video().path())},null,2));await b.close()}
console.log('APP_ACTIONS_PASS',checks);
})().catch(e=>{console.error(e);process.exitCode=1});
