'use strict';
// Production views and engine projections, at both review sizes/themes.
// Optional Chromium test; FILL_URL allows the browser to run on another Mac.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function createFixture(){
 const visual=require('./visual-qa-browser.cjs'),data=visual.cases(),custom=require('./custom-mobile-browser');
 await require('../games/pocket-karts/server').initialize();
 for(const [id,phases]of [['chain-reaction',['live','cascade']],['pocket-karts',['countdown','drive']]]){
  const meta=require('../games/registry').list().find(g=>g.id===id);
  data.push({id,meta,immersive:true,frames:phases.map(phase=>({label:phase,state:custom.reset(id,phase)}))});
 }
 return visual.createFixture(undefined,data);
}
async function run(){
 const {chromium}=require('playwright'),out=process.env.FILL_SHOTS||'/tmp/codex-fill/after',report=[];
 fs.mkdirSync(out,{recursive:true});let server,browser;
 try{
  let base=process.env.FILL_URL;
  if(!base){server=await createFixture();await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
  const data=await(await fetch(base+'/cases')).json();assert.equal(data.length,42);
  browser=await chromium.launch({headless:true,channel:'chromium'});
  for(const width of [390,1280])for(const theme of ['day','night']){
   const context=await browser.newContext({viewport:{width,height:width===390?844:800},isMobile:width===390,hasTouch:width===390}),page=await context.newPage();
   for(const d of data){
    if(process.env.FILL_GAMES&&!process.env.FILL_GAMES.split(',').includes(d.id))continue;
    const errors=[],row={width,theme,id:d.id,frames:[],errors};page.on('pageerror',error);function error(e){errors.push(e.message);}
    try{
     await page.goto(base);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.evaluate(d=>window.loadCase(d),d);
     for(let i=0;i<d.frames.length;i++){
      const f=d.frames[i];await page.evaluate(S=>window.applyFrame(S),f.state);await page.waitForTimeout(d.id==='pocket-karts'?1500:350);
      if(d.id==='chain-reaction')await page.frameLocator('iframe.game-document').locator('.cr-board').waitFor({state:'visible'});
      const documentFrame=d.id==='chain-reaction'?page.frames().find(f=>f.url().includes('/game-assets/chain-reaction/')):page.mainFrame();assert(documentFrame,'game document');
      if(d.id==='pocket-karts')await page.locator('.pk-stage canvas').waitFor({state:'visible'});
      const metrics=await documentFrame.evaluate(()=>{
       const root=document.querySelector('#gbody')||document.body,players=root.querySelector('.pl-live');let gap=null;
       if(players&&getComputedStyle(players).position!=='absolute'){
        let previous=players.previousElementSibling;
        while(previous&&(!previous.getBoundingClientRect().height||['absolute','fixed'].includes(getComputedStyle(previous).position)))previous=previous.previousElementSibling;
        if(previous)gap=players.getBoundingClientRect().top-previous.getBoundingClientRect().bottom;
       }
       const card=root.querySelector('.cp-prompt-card'),text=card?.querySelector('.cp-prompt-text'),ring=card?.querySelector('.cp-ring');
       const promptGap=card&&text?card.getBoundingClientRect().bottom-Math.max(text.getBoundingClientRect().bottom,ring?.getBoundingClientRect().bottom||0):null;
       const pick=root.querySelector('.dg-pick');let pickCenter=null;
       if(pick){const boxes=[...pick.children].map(n=>n.getBoundingClientRect()).filter(r=>r.height);pickCenter=(Math.min(...boxes.map(r=>r.top))+Math.max(...boxes.map(r=>r.bottom)))/2;}
       return{overflow:document.documentElement.scrollWidth-innerWidth,gap,promptGap,pickCenter,viewportHeight:innerHeight,board:root.querySelector('.cr-board')?.getBoundingClientRect().toJSON(),contrast:window.auditTextContrast?.(root,4.5)};
      });
      // The framed game has its own document; use the same contrast oracle.
      if(d.id==='chain-reaction'){
       const source=require('./live-text-contrast').auditTextContrast.toString();
       metrics.contrast=await documentFrame.evaluate(source=>new Function('return ('+source+')(document.body,4.5)')(),source);
      }
      const screenshot=`${width}-${theme}-${d.id}-${i}-${f.state.phase}.png`;
      await page.screenshot({path:path.join(out,screenshot),fullPage:true});row.frames.push({phase:f.state.phase,screenshot,...metrics});
      if(process.env.FILL_ASSERT==='1'){
       assert(metrics.overflow<=1,d.id+' horizontal overflow');
       if(width===390&&['bluff','compliment-battle','hot-takes','most-likely','pick-one','rapid-polls','roast-toast','story-builder','two-truths'].includes(d.id)&&metrics.gap!==null)assert(metrics.gap<=48,d.id+' roster follows the round');
       if(width===1280&&['pose-party','show-and-go'].includes(d.id)&&f.state.phase==='perform')assert(metrics.promptGap<=48,d.id+' prompt card hugs its content');
       if(width===1280&&d.id==='doodle-guess'&&f.state.phase==='pick')assert(Math.abs(metrics.pickCenter-metrics.viewportHeight/2)<=32,'the word picker is centred on the desk');
       if(d.id==='chain-reaction'&&i&&metrics.board){const before=row.frames[0].board;assert(['x','y','width','height'].every(k=>Math.abs(metrics.board[k]-before[k])<=1),'Chain board keeps its position while scores change');}
       if(theme==='night')assert.equal(metrics.contrast?.errors.length||0,0,d.id+' '+f.state.phase+' contrast: '+JSON.stringify(metrics.contrast?.errors));
      }
     }
     assert.deepEqual(errors,[]);
    }catch(e){row.failure=e.message;console.log('FILL_ERROR',width,theme,d.id,e.message.slice(0,160));}
    page.off('pageerror',error);report.push(row);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log('FILL_CASE',width,theme,d.id,row.frames.length);
   }
   await context.close();
  }
  const failures=report.filter(r=>r.failure);assert.equal(failures.length,0,JSON.stringify(failures.map(r=>({id:r.id,width:r.width,theme:r.theme,failure:r.failure}))));
  console.log('FILL_SCENES_BROWSER_PASS',report.length);
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
}
module.exports={createFixture};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
