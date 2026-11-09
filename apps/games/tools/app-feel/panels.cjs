/* Browser regression for shared panels: source inventory, focus, drafts,
 * outside click, nested dialogs, resized docks and generated guide pages. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),inventory=path.resolve(root,'../../artifacts/app-feel'),out=path.resolve(process.env.APP_FEEL_ARTIFACTS || inventory);
fs.mkdirSync(out,{recursive:true});
const base=process.env.APP_FEEL_URL||'http://127.0.0.1:8380';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.route('**/__app-feel-panels',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/app-panels.css"><link rel="stylesheet" href="/css/issues.css"><script defer src="/js/app-panels.js"></script><body><button id="opener">Report</button><main id="test"></main><div id="steady" style="width:200px;height:200px">Play area</div></body></html>`}));
 await page.goto(base+'/__app-feel-panels');
 const classes=[...new Set(JSON.parse(fs.readFileSync(path.join(inventory,'disclosures.json'),'utf8')).filter(r=>!r.retired).map(r=>r.cls).filter(c=>c!=='dynamic'&&!c.includes('$')&&!c.includes('room-menu')))];
 for(const [width,height]of [[1440,900],[1024,768],[768,1024],[390,844],[420,700],[560,760]])for(const theme of ['day','night']){
  await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  for(const cls of classes.filter(c=>c!=='chhist-wrap')){
   await page.evaluate(cls=>{document.querySelector('#test').innerHTML=`<form id="form"><details class="${cls}" id="disclosure"><summary>Open ${cls}</summary><label for="draft">Your answer</label><input id="draft" name="draft"><button type="button" id="last">Last action</button></details></form>`;},cls);
   const summary=page.locator('#disclosure>summary'),panel=page.locator('#disclosure>.app-panel');
   await panel.waitFor({state:'attached'});const before=await page.locator('#steady').boundingBox();
   await summary.focus();await page.keyboard.press('Enter');assert(await panel.evaluate(n=>n.open),cls+' keyboard opens');
   const during=await page.locator('#steady').boundingBox();assert.deepEqual(during,before,cls+' never reflows play area');
   await page.locator('#draft').fill('Keep this answer');
   await page.locator('#last').focus();await page.keyboard.press('Tab');assert(await page.locator('[data-app-close]').evaluate(n=>n===document.activeElement),'Tab stays in panel');
   await page.keyboard.press('Escape');assert(await summary.evaluate(n=>n===document.activeElement),'Escape restores trigger');
   await summary.click();assert.equal(await page.locator('#draft').inputValue(),'Keep this answer','draft survives close');
   await page.mouse.click(width-2,2);assert(!(await panel.evaluate(n=>n.open)),cls+' outside click closes');
  }
  checks.push(`${width}x${height} ${theme}: ${classes.length-1} disclosure families, keyboard, focus trap, draft, outside click, no reflow`);
 }
 // A snapshot replaces the entire disclosure while it is open.
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>document.querySelector('#test').innerHTML='<details id="repaint"><summary>Snapshot help</summary><p>First snapshot</p></details>');
 await page.locator('#repaint>summary').click();
 await page.evaluate(()=>document.querySelector('#test').innerHTML='<details id="repaint"><summary>Snapshot help</summary><p>New snapshot</p></details>');
 await page.waitForFunction(()=>document.querySelector('#repaint>.app-panel')?.open);
 assert((await page.locator('#repaint>.app-panel').textContent()).includes('New snapshot'));
 await page.keyboard.press('Escape');checks.push('Open panel survives full snapshot replacement');
 // Move list swaps between a permanent side region and a modal sheet.
 await page.evaluate(()=>document.querySelector('#test').innerHTML='<details class="chhist-wrap"><summary>Moves</summary><p>1. e4 e5</p></details>');
 await page.setViewportSize({width:1440,height:900});
 await page.waitForFunction(()=>document.querySelector('.chhist-wrap')?.classList.contains('app-docked'));
 assert.equal(await page.locator('.chhist-wrap>.app-panel').getAttribute('role'),'region');
 await page.setViewportSize({width:390,height:844});await page.locator('.chhist-wrap>summary').click();assert(await page.locator('.chhist-wrap>.app-panel').evaluate(n=>n.open));await page.keyboard.press('Escape');
 checks.push('Move list: wide side region, narrow sheet, resize and focus');
 // Nested report fields stay in the real form and retain their draft.
 await page.evaluate(async()=>{document.querySelector('#test').innerHTML='';const {openIssueReport}=await import('/js/report-issue.js');window.openReport=()=>openIssueReport({games:[],game:'platform'},document.querySelector('#opener'));window.openReport();});
 await page.locator('#issueDescription').fill('The move list was hard to read.');
 await page.locator('.issue-steps>summary').click();await page.locator('#issueSteps').fill('Open Moves, then close it.');await page.keyboard.press('Escape');
 assert(await page.locator('.issue-dialog').evaluate(n=>n.open),'Escape only closes the child sheet');
 assert.equal(await page.locator('.issue-dialog form').evaluate(n=>n.elements.namedItem('steps').value),'Open Moves, then close it.','nested field belongs to original form');
 await page.locator('.issue-cancel').click();await page.evaluate(()=>window.openReport());
 await page.locator('.issue-steps>summary').click();assert.equal(await page.locator('#issueSteps').inputValue(),'Open Moves, then close it.');
 await page.screenshot({path:path.join(out,'after/report-nested-sheet.png')});await page.keyboard.press('Escape');await page.locator('.issue-cancel').click();
 checks.push('Report: nested native sheet, form ownership, Escape order and saved draft; no report sent');
 // Every generated rule page actually loads the shared behavior.
 let guides=0;
 for(const game of fs.readdirSync(path.join(root,'public/games'))){
  const file=path.join(root,'public/games',game,'index.html');if(!fs.existsSync(file)||!fs.readFileSync(file,'utf8').includes('class="gp-rules"'))continue;
  await page.goto(base+'/games/'+game+'/');await page.locator('.gp-rules>.app-panel').waitFor({state:'attached'});await page.locator('.gp-rules>summary').click();assert(await page.locator('.gp-rules>.app-panel').evaluate(n=>n.open),game+' guide rules');await page.keyboard.press('Escape');guides++;
 }
 checks.push(`${guides} generated guides: real rules open and close in sheets`);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'panel-checks.json'),JSON.stringify({pass:true,checks,errors},null,2));console.log('APP_PANELS_PASS',checks);
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
