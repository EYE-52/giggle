// KART_CAMERA_PLAYWRIGHT=/path/to/playwright node test/kart-camera-browser.cjs
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.KART_CAMERA_PLAYWRIGHT||'playwright'),root=path.resolve(__dirname,'..'),out=process.env.KART_CAMERA_OUT||'/tmp/codex-kart-camera-browser';
const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.glb':'model/gltf-binary','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{try{
    const url=new URL(req.url,'http://local'),p=url.pathname;
    if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
    if(p==='/classic-map'){const id=url.searchParams.get('id');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id,...require('../games/engines/kart-maps.js').mapDef(id)}));}
    const file=path.resolve(root,p.startsWith('/test/')?'.'+p:'./public'+p);if(!file.startsWith(root+'/'))throw Error('invalid path');
    let body=fs.readFileSync(file);
    if(p==='/js/renderers/three-view.js')body=body.toString().replace('built = await hooks.build(THREE, helper);','$&\nglobalThis.kartCameraProbe?.built(built,renderer);');
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body);
  }catch(e){res.writeHead(404);res.end(e.message);}});
  await new Promise(r=>server.listen(Number(process.env.KART_BROWSER_PORT)||0,'127.0.0.1',r));let browser;const results=[];
  try{
    browser=await chromium.launch({executablePath:process.env.KART_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
    const cases=[['garden','cannon','fox',false],['ring','cannon','fox',false],['ring','barrier','fox',false],['neon','neon-near','fox',true],['garden','mouth','fox',false],['garden','rear','fox',false],['garden','rear','bunny',false],['garden','rear','panda',false],['garden','rear','raccoon',false],['skyport','wall','fox',true],['harbor','wall','raccoon',true]];
    for(const [width,height]of [[1280,800],[390,844]])for(const [map,scene,driver,raised]of cases.filter(c=>process.env.KART_CAMERA_OCCLUSION?['barrier','neon-near'].includes(c[1]):!process.env.KART_CAMERA_QUICK||c[0]==='garden'&&['cannon','rear'].includes(c[1])&&['fox','raccoon'].includes(c[2]))){
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:width<500}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      if(process.env.KART_CAMERA_BEFORE)for(const name of ['kart-view.js','kart-elevated-view.js','kart-assets.mjs','kart-camera-collision.mjs','kart-festive-lights.mjs'])await page.route('**/js/engines/'+name,route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(process.env.KART_CAMERA_BEFORE,name))}));
      await page.goto(`http://127.0.0.1:${server.address().port}/test/fixtures/kart-camera/index.html?map=${map}&case=${scene}&driver=${driver}&raised=${raised?1:0}`);
      await page.waitForFunction(()=>window.kartCameraCheck?.ready,null,{timeout:90000});await page.waitForTimeout(700);
      if(scene==='mouth'){await page.locator('.pk-stage canvas,.pke-stage canvas').click({force:true});await page.keyboard.down('ArrowUp');await page.waitForTimeout(650);await page.keyboard.up('ArrowUp');await page.waitForTimeout(200);}
      if(scene==='mouth')await page.waitForFunction(()=>window.kartCameraCheck.result().modelVisible,null,{timeout:10000});
      const report=await page.evaluate(()=>window.kartCameraCheck.result()),name=`${map}-${scene}-${driver}-${width}x${height}.png`;
      if(['barrier','neon-near'].includes(scene))report.coverage=await page.evaluate(()=>window.kartCameraCheck.coverage());
      results.push({...report,screenshot:name,width,height,errors});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({browser:browser.version(),results},null,2));console.log(JSON.stringify({name,...report,errors}));
      if(!process.env.KART_CAMERA_BEFORE)assert.equal(report.eyeOverlapsSolid,false,'camera inside solid: '+name);
      if(!process.env.KART_CAMERA_BEFORE&&scene==='mouth')assert(Math.hypot(...report.eye.map((v,i)=>v-report.model[i]))>6,'muzzle camera pulled inside kart: '+name);
      assert.equal(report.modelVisible,true,'kart missing: '+name);assert.deepEqual(errors,[],name+' browser errors');
      if(!process.env.KART_CAMERA_BEFORE&&report.coverage)assert(report.coverage.fraction>.94,'foreground hides kart: '+name+' '+JSON.stringify(report.coverage));
      await page.screenshot({path:path.join(out,name)});
      await page.evaluate(()=>window.kartCameraCheck.dispose());await context.close();
    }
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({browser:browser.version(),results},null,2));console.log(JSON.stringify({pass:true,screenshots:results.length,out}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
