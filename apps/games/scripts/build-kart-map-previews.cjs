'use strict';
// Capture the authored production worlds, with a full-footprint menu camera.
// Requires local Chrome + Playwright; no synthetic artwork or baked labels.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'public/assets/karts/previews');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const server=spawn(process.execPath,['test/fixtures/kart-map-previews/server.cjs'],{cwd:root,env:{...process.env,KART_PREVIEW_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let logs='',browser;server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
  try{
    for(let i=0;i<200&&!logs.includes('Kart map previews:');i++)await pause(25);
    if(!logs.includes('Kart map previews:'))throw Error(logs);
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
    const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    const measurements=[];
    const catalog=await (await fetch(`http://127.0.0.1:${port}/maps`)).json(),maps=catalog.filter(m=>!process.env.KART_PREVIEW_KEYS||m.key.startsWith(process.env.KART_PREVIEW_KEYS)),images=[];
    const previous=JSON.parse(fs.readFileSync(path.join(output,'manifest.json')));
    for(const map of maps){
      await page.waitForFunction(()=>document.querySelector('#stage').dataset.state!=='loading',null,{timeout:90000});
      await page.selectOption('#map',map.key);await page.click('#load');
      await page.waitForFunction(key=>{const s=JSON.parse(document.querySelector('#status').textContent);return s.state==='error'||s.state==='ready'&&s.key===key;},map.key,{timeout:90000});
      const metadata=await page.locator('#status').evaluate(el=>JSON.parse(el.textContent));
      if(metadata.state!=='ready')throw Error(JSON.stringify(metadata));
      const data=await page.locator('#stage').evaluate(canvas=>{const small=document.createElement('canvas');small.width=480;small.height=270;small.getContext('2d').drawImage(canvas,0,0,480,270);return small.toDataURL('image/webp',.79).split(',')[1];});
      const bytes=Buffer.from(data,'base64');if(bytes.length<2000)throw Error(`${map.key}: blank or missing arena capture`);if(bytes.length>=25000)throw Error(`${map.key}: preview exceeds 25KB`);
      const file=`assets/karts/previews/${map.key}.webp`;fs.writeFileSync(path.join(root,'public',file),bytes);
      measurements.push(metadata);
      const points=metadata.camera.footprint,rounded=n=>Math.round(n*10000)/10000;
      const framing={minX:rounded(Math.min(...points.map(p=>p[0]))),maxX:rounded(Math.max(...points.map(p=>p[0]))),minY:rounded(Math.min(...points.map(p=>p[1]))),maxY:rounded(Math.max(...points.map(p=>p[1])))};
      images.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),label:map.label,mapId:map.id,profile:map.profile,revision:metadata.revision,framing});
      console.log(`${map.key}: ${bytes.length} bytes`);
    }
    if(errors.length)throw Error(errors.join('\n'));
    if(process.env.KART_PREVIEW_QA_OUT){fs.mkdirSync(process.env.KART_PREVIEW_QA_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.KART_PREVIEW_QA_OUT,'capture-measurements.json'),JSON.stringify(measurements,null,2)+'\n');}
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({source:'Actual production map builders and shipped assets, Daybreak. Orthographic full-footprint camera, menu fill light, no chase-camera fog, and no outside horizon in shaped arena overviews. WebP only; no baked text.',width:480,height:270,images:catalog.map(m=>images.find(i=>i.label===m.label)||previous.images.find(i=>i.label===m.label))},null,2)+'\n');
  }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
