// KART_STALL_PLAYWRIGHT=/path/to/playwright KART_STALL_SECONDS=120 node test/kart-render-warmup-browser.cjs
// Optional KART_STALL_BASELINE_DIR contains the three original view/LOD modules.
// Real production views with synthetic public snapshots, not an ordinary match.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.KART_STALL_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.KART_STALL_OUT||'/tmp/codex-kart-stalls-browser';
const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.glb':'model/gltf-binary','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{try{
  const p=new URL(req.url,'http://local').pathname;
  if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(p==='/classic-map'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id:'neon',...require('../games/engines/kart-maps.js').mapDef('neon')}));}
  const file=path.resolve(root,p.startsWith('/test/')?'.'+p:'./public'+p);if(!file.startsWith(root+'/'))throw Error('invalid path');
  let data=fs.readFileSync(file);
  if(p==='/js/renderers/three-view.js')data=data.toString().replace('renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: \'high-performance\' });', '$&\nglobalThis.kartStallProbe?.renderer(renderer);').replace('built = await hooks.build(THREE, helper);','$&\nglobalThis.kartStallProbe?.built(built);');
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);
 }catch(e){res.writeHead(404);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
  const reports=[];
  for(const before of process.env.KART_STALL_BASELINE_DIR?[true,false]:[false])for(const map of (process.env.KART_STALL_MAPS||'skyport,foundry,neon').split(',')){
   const page=await browser.newPage({viewport:{width:960,height:540}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   if(before)for(const name of ['kart-view.js','kart-elevated-view.js','kart-lod.mjs'])await page.route('**/js/engines/'+name,route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(process.env.KART_STALL_BASELINE_DIR,name))}));
   await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/kart-render-warmup/index.html?map=${map}`);
   await page.waitForFunction(()=>window.kartStalls?.ready,null,{timeout:90000});
   await page.evaluate(()=>window.kartStalls.start());
   const end=Date.now()+Number(process.env.KART_STALL_SECONDS||120)*1000;while(Date.now()<end)await new Promise(r=>setTimeout(r,Math.min(1000,end-Date.now())));
   const result=await page.evaluate(()=>window.kartStalls.result());result.before=before;result.errors=errors;reports.push(result);
   fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(result));
   await page.evaluate(()=>window.kartStalls.stop());await page.close();
  }
  if(reports.some(r=>r.errors.length||!r.frames.n||!r.peakDraws||!r.before&&Number(process.env.KART_STALL_SECONDS||120)>=20&&(r.uses.length!==13||r.drivers!==4||Object.values(r.glCalls).some(n=>n!==0))))process.exitCode=1;
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
