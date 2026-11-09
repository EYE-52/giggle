/* Real practice rooms, production views. Only use the assigned spare port.
 * NODE_PATH=/private/tmp/codex-driving-browser/node_modules node tools/app-feel/review.cjs
 * Run from apps/games. Screens and recordings are written into this worktree. */
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const out = path.resolve(process.env.APP_FEEL_ARTIFACTS || path.join(__dirname, '../../../../artifacts/app-feel/after'));
const baselineRef=process.env.APP_FEEL_BASELINE || '6e91b6b626ce350538f19ff6154d34f229678cc6';
const label=process.env.APP_FEEL_LABEL || '';
const requestedSeats=Number(process.env.APP_FEEL_SEATS || 0);
const beforeMode=process.env.APP_FEEL_PHASE==='before';
const phaseOut=beforeMode?out.replace(/after$/, 'before'):out;
const base = process.env.APP_FEEL_URL || 'http://127.0.0.1:8380';
const games = (process.env.APP_FEEL_GAMES || 'chess,checkers,reversi,kalah,four-in-a-row,five-row,fleet-duel,dots-boxes,ludo,snakes-ladders,pig-dice,mega-tic-tac-toe').split(',');
const sizes = [[1440,900],[1024,768],[768,1024],[390,844],[420,700],[560,760]];
(async () => {
 fs.mkdirSync(phaseOut, { recursive:true });
 const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, ...(beforeMode?{args:['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']}: {}) });
 const context = await browser.newContext({viewport:{width:1440,height:900},hasTouch:true,...(beforeMode?{}:{recordVideo:{dir:path.join(phaseOut,'video'),size:{width:1440,height:1100}}})});
 const page = await context.newPage(), report = { baselineRef, cases:[], errors:[], interactions:[] };
 if(beforeMode){
  page.on('console',m=>console.log('BASELINE_CONSOLE',m.type(),m.text()));
  page.on('requestfailed',r=>console.log('BASELINE_REQUEST',r.url(),r.failure()?.errorText));
  const {execFileSync}=require('node:child_process');
  const repo=path.resolve(__dirname,'../../../..');
  const modified=execFileSync('git',['diff','--diff-filter=M','--name-only',baselineRef],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(f=>f.startsWith('apps/games/public/'));
  const originals=new Map(modified.map(file=>['/'+file.slice('apps/games/public/'.length),execFileSync('git',['show',baselineRef+':'+file],{cwd:repo})]));
  await page.route('**/*',route=>{const pathname=new URL(route.request().url()).pathname;const source=originals.get((pathname==='/'||/^\/r\/[a-z0-9]+$/i.test(pathname))?'/index.html':pathname.endsWith('/')?pathname+'index.html':pathname);if(source)return route.fulfill({body:source,contentType:pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'text/javascript':'text/html'});return route.continue();});
 }
 page.on('pageerror', e => report.errors.push(e.message));
 try {
 for (const game of games) {
  await page.setViewportSize({width:1440,height:900});
  await page.goto(base+'/practice/?game='+game);
  if(requestedSeats){await page.waitForFunction(()=>!document.querySelector('#practiceStart').disabled);while(Number(await page.locator('#practiceCount').inputValue())<requestedSeats && !(await page.locator('#practiceMore').isDisabled()))await page.locator('#practiceMore').click();}
  if(beforeMode) await page.locator('#practiceStart').waitFor({state:'visible'});
  await page.locator('#practiceStart').click();
  await page.waitForFunction(() => document.querySelector('#practiceStatus').textContent.includes('seats ready'));
  const host = page.frames().find(f => new URL(f.url()).searchParams.get('seat') === '1');
  await host.locator('#howtoGo').click(); await host.locator('.bk-stage').waitFor();
  if(!beforeMode)await host.locator('.app-disclosure').first().waitFor();
  await host.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
  for (const [width,height] of sizes) {
   const embed = width===420 || width===560;
   // The narrow cases are the shipping inside-Meet preview URL.
   const url = new URL(host.url());
   if (embed !== url.searchParams.has('look')) {
    if (embed) url.searchParams.set('look','giggle'); else url.searchParams.delete('look');
    await host.goto(url.href); await host.locator('.bk-stage').waitFor(); await page.waitForTimeout(400);
   }
   const bar=await page.locator('.practice-bar').evaluate(n=>n.getBoundingClientRect().height);
   await page.setViewportSize({width,height:height+bar});
   for (const theme of ['day','night']) {
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await host.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.waitForTimeout(250);
    const metrics = await host.evaluate(() => {
     const rect = sel => { const n=document.querySelector(sel); if(!n)return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}; };
     return { viewport:[innerWidth,innerHeight], scrollWidth:document.documentElement.scrollWidth, scrollHeight:document.documentElement.scrollHeight,
      palette:{ink:getComputedStyle(document.querySelector('.bk-title')).color,background:getComputedStyle(document.body).backgroundColor},
      stage:rect('.bk-stage'), tools:rect('.bk-tools'), status:rect('.bk-status'), extra:rect('.bk-extra'),
      players:[...document.querySelectorAll('.bk-player')].map(n=>{const r=n.getBoundingClientRect();return {y:r.y,bottom:r.bottom};}),
      unhandled:[...document.querySelectorAll('details')].filter(n=>!n.matches('.room-menu,.app-disclosure')).map(n=>n.className) };
    });
    const stem=`${game}${label?'-'+label:''}-${width}x${height}-${theme}${embed?'-meet':''}`;
    await page.locator('body').click({position:{x:1,y:1},force:true});
    await page.locator('#practiceSeat1 iframe').screenshot({path:path.join(phaseOut,stem+'.png')});
    if(beforeMode){report.cases.push({game,width,height,theme,embed,...metrics});continue;}
    // Element screenshots may scroll the iframe into view; measure the settled
    // playfield immediately before the action whose layout we are testing.
    const before=await host.locator('.bk-stage').evaluate(n=>{const r=n.getBoundingClientRect();return {y:r.y,w:r.width,bottom:r.bottom};});
    for (const player of metrics.players) assert(player.bottom<=before.y+1 || player.y>=before.bottom-1, game+' player bars clear the board '+JSON.stringify({width,height,player,stage:metrics.stage}));
    await host.locator('.bk-help>summary').click(); await page.waitForTimeout(250);
    const panel=host.locator('.bk-help>.app-panel');
    assert(await panel.evaluate(n=>n.open),'help opens as native modal');
    assert.equal(await host.locator('.bk-help>summary').getAttribute('aria-expanded'),'true');
    const during=await host.locator('.bk-stage').evaluate(n=>{const r=n.getBoundingClientRect();return {y:r.y,width:r.width};});
    assert(Math.abs(during.y-before.y)<1&&Math.abs(during.width-before.w)<1,game+' help leaves board fixed '+JSON.stringify({width,height,before,during}));
    if(game==='chess'||game==='fleet-duel')await page.locator('#practiceSeat1 iframe').screenshot({path:path.join(phaseOut,stem+'-rules.png')});
    await page.keyboard.press('Escape');
    assert(await host.locator('.bk-help>summary').evaluate(n=>document.activeElement===n),'Escape restores opener');
    if(metrics.scrollWidth>width+1) console.log('OVERFLOW',await host.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(n=>({c:n.className,tag:n.tagName,w:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right,overflow:getComputedStyle(n).overflowX}))));
    if(embed){const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(v=>{v=Number(v)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=luminance(metrics.palette.ink),b=luminance(metrics.palette.background);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'Meet board title keeps readable contrast '+JSON.stringify(metrics.palette));}
    assert(metrics.scrollWidth<=width+1,game+' fits width '+JSON.stringify({width,height,doc:metrics.scrollWidth,stage:metrics.stage}));
    assert(metrics.stage.x>=0&&metrics.stage.right<=width+1,game+' board fits');
    assert(metrics.stage.bottom<=metrics.viewport[1]+1,game+' board visible');
    assert(metrics.tools.bottom<=metrics.viewport[1]+1,game+' tools visible');
    assert.deepEqual(metrics.unhandled,[],game+' every disclosure is handled');
    report.cases.push({game,width,height,theme,embed,...metrics});
   }
  }
  // A real move and a menu on the actual game, not a mockup.
  if(game==='chess'&&!beforeMode) {
   await page.setViewportSize({width:390,height:844});
   await host.locator('#chsq-e2').click(); await host.locator('#chsq-e4').click();
   await page.waitForTimeout(650);
   await host.locator('.chhist-wrap>summary').click(); await page.waitForTimeout(250);
   assert((await host.locator('#ch-hist').textContent()).includes('e4'),'actual move reaches move list');
   await page.keyboard.press('Escape');
   await host.locator('.bk-match>summary').click(); await host.locator('[data-resign]').click();
   await page.waitForTimeout(250); assert(await host.locator('[data-confirm-resign]').isVisible(),'resign confirm stays in menu after repaint');
   await host.locator('[data-keep]').click(); await page.keyboard.press('Escape');
   await host.locator('#roomMenu>summary').click(); await page.waitForTimeout(200);
   await page.screenshot({path:path.join(phaseOut,'chess-room-sheet.png')}); await page.keyboard.press('Escape');
   report.interactions.push('Chess: legal e2-e4, move sheet, resign/cancel, room sheet, Escape focus');
  }
  await page.locator('#practiceStop').click();
  console.log('APP_FEEL_GAME_PASS',game);
 }
 assert.deepEqual(report.errors,[],'no browser runtime errors'); report.pass=true;
 } finally {
  await context.close();
  if(page.video())report.video=path.relative(phaseOut,await page.video().path());
  fs.writeFileSync(path.join(phaseOut,`review${label?'-'+label:''}.json`),JSON.stringify(report,null,2));
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
