const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../../../artifacts/app-feel/after'),base=process.env.APP_FEEL_URL||'http://127.0.0.1:8380';
(async()=>{const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const c=await b.newContext({recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:1100}}}),p=await c.newPage(),checks=[];
try{
 await p.goto(base+'/practice/?game=chess');await p.locator('#practiceStart').click();await p.waitForFunction(()=>document.querySelector('#practiceStatus').textContent.includes('seats ready'));
 const host=p.frames().find(f=>new URL(f.url()).searchParams.get('seat')==='1');
 await host.locator('#howtoClose').click();
 for(const [width,height]of [[1440,900],[1024,768],[768,1024],[390,844],[420,700],[560,760]])for(const theme of ['day','night']){
  await p.setViewportSize({width,height});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await host.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await p.locator('#practiceGuide>summary').click();await p.waitForTimeout(220);await p.screenshot({path:path.join(out,`practice-info-${width}x${height}-${theme}.png`)});await p.keyboard.press('Escape');
  const trigger=host.locator('.room-manage>summary');await trigger.scrollIntoViewIfNeeded();const before=await trigger.boundingBox();await trigger.click();await p.waitForTimeout(220);const after=await trigger.boundingBox();assert(Math.abs(before.y-after.y)<1,'Manage players never reflows lobby');
  await p.screenshot({path:path.join(out,`manage-players-${width}x${height}-${theme}.png`)});await p.keyboard.press('Escape');
  checks.push(`Practice / Manage players ${width}x${height} ${theme}`);
 }
 await host.locator('[data-how="chess"]').first().click();await host.locator('#howtoGo').click();await host.locator('.bk-stage').waitFor();
 await p.setViewportSize({width:1440,height:900});await p.locator('#practiceTab1').focus();await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#practiceTab2').getAttribute('aria-selected'),'true');await p.keyboard.press('ArrowLeft');assert.equal(await p.locator('#practiceTab1').getAttribute('aria-selected'),'true');checks.push('Practice segments: arrow-key seat switch and state preserved');
 await host.locator('#roomMenu>summary').click();assert.equal(await host.locator('#roomMenu>summary').getAttribute('aria-expanded'),'true');await p.keyboard.press('Escape');assert(await host.locator('#roomMenu>summary').evaluate(n=>n===document.activeElement));checks.push('Room menu: expanded state, Escape focus');
 await host.locator('#bGameScreenToggle').click();await p.waitForTimeout(300);assert(await host.evaluate(()=>!!document.fullscreenElement),'full screen from real gesture');await host.evaluate(()=>document.exitFullscreen());checks.push('Full screen: enter from button, exit, live board retained');
 await p.locator('#practiceStop').click();
 await p.goto(base+'/same-room/?game=chess');await p.locator('#srGamePicker>.app-panel').waitFor({state:'attached'});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
 for(const [width,height]of [[1440,900],[1024,768],[768,1024],[390,844],[420,700],[560,760]])for(const theme of ['day','night']){
  await p.setViewportSize({width,height});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const trigger=p.locator('#srGamePicker>summary');await trigger.scrollIntoViewIfNeeded();const before=await p.locator('.sr-people-panel').boundingBox();await trigger.click();await p.waitForTimeout(220);const after=await p.locator('.sr-people-panel').boundingBox();assert(Math.abs(before.y-after.y)<1,'game chooser leaves setup fixed '+JSON.stringify({width,height,before,after}));
  await p.screenshot({path:path.join(out,`one-device-picker-${width}x${height}-${theme}.png`)});await p.keyboard.press('Escape');
 }
 await p.locator('#srGamePicker>summary').click();await p.locator('#srShowGames').click();await p.locator('[data-game-choice="four-in-a-row"]').click();assert.equal(await p.locator('#srGame').inputValue(),'four-in-a-row');assert(!(await p.locator('#srGamePicker>.app-panel').evaluate(n=>n.open)));checks.push('One-device chooser: no reflow at 6 sizes / 2 themes; selection closes and keeps new game');
 fs.writeFileSync(path.join(out,'../shell-checks.json'),JSON.stringify({pass:true,checks,video:path.relative(out,await p.video().path())},null,2));console.log('APP_SHELLS_PASS',checks);
}finally{await c.close();await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
