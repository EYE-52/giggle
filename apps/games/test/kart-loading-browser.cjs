'use strict';
// Cold-cache practice load. Network/CPU settings match a slow phone link.
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/private/tmp/codex-driving-browser/node_modules/playwright');
(async () => {
  const out = process.env.KART_LOAD_OUT || '/tmp/giggle-kart-load'; fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']});
  try {
    const context = await browser.newContext({viewport:{width:960,height:640}});
    await context.addInitScript(() => {
      const Native=WebSocket;
      window.__loadProbe={streams:0};
      const stream=WebAssembly.instantiateStreaming;
      if(stream)WebAssembly.instantiateStreaming=(...args)=>{window.__loadProbe.streams++;return stream(...args);};
      window.WebSocket=class extends Native {
        constructor(...args){super(...args);this.addEventListener('message',event=>{try{const m=JSON.parse(event.data);if(m.t==='state')window.__loadProbe.state={preparing:m.preparing,phase:m.phase};}catch{}});}
        send(data){try{const m=JSON.parse(data);if(m.t==='start')window.__loadProbe.start=performance.now();if(m.t==='game-ready'&&!window.__loadProbe.ready)window.__loadProbe.ready=performance.now();}catch{}return super.send(data);}
      };
    });
    // Optional per-seat link: the second practice seat is served directly so
    // two simulated phones do not share the measured phone's 1.6 Mbps link.
    if(process.env.KART_LOAD_PER_SEAT==='1')await context.route('**/*',async route=>{
      const request=route.request();let frame;try{frame=request.frame();}catch{}
      if(frame&&/[?&]seat=2(?:&|$)/.test(frame.url())){
        const response=await route.fetch();await route.fulfill({response});
      }else await route.continue();
    });
    const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[],requests=new Map();
    let receivedBytes=0;
    page.on('pageerror',e=>errors.push(e.stack));
    page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('BROWSER ERROR',m.text());}});
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600*1024/8,uploadThroughput:750*1024/8});
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    if(process.env.KART_LOAD_DEBUG)cdp.on('Network.webSocketFrameSent',e=>{try{const m=JSON.parse(e.response.payloadData);if(['pick-game','start'].includes(m.t))console.log('WS SENT',m);}catch{}});
    cdp.on('Network.responseReceived',e=>requests.set(e.requestId,{url:e.response.url,encoded:0,decoded:0}));
    cdp.on('Network.dataReceived',e=>{receivedBytes+=e.encodedDataLength;const r=requests.get(e.requestId);if(r)r.decoded+=e.dataLength;});
    cdp.on('Network.loadingFinished',e=>{const r=requests.get(e.requestId);if(r)r.encoded=e.encodedDataLength;});
    const nav=Date.now();
    console.log('Navigating');
    await page.goto(`http://127.0.0.1:${process.env.PORT||8280}/practice/?game=pocket-karts`);
    console.log('Starting seats');
    await page.locator('#practiceStart:not([disabled])').click();
    await page.waitForFunction(()=>document.getElementById('practiceStatus').textContent.startsWith('2 seats ready'),null,{timeout:90000});
    console.log('Seats ready');
    const host=page.frames().find(f=>/[?&]seat=1(?:&|$)/.test(f.url()));
    if(process.env.KART_LOAD_DEBUG)console.log('PRELOADS',await Promise.all(page.frames().map(f=>f.evaluate(()=>({url:location.href,links:[...document.querySelectorAll('link[rel=modulepreload]')].map(l=>l.href),caches:[...(window.top.__giggleKartDownloads||new Map()).keys()]})))));
    if(process.env.KART_LOAD_WAIT)await page.waitForTimeout(Number(process.env.KART_LOAD_WAIT));
    if(process.env.KART_LOAD_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
    const before=receivedBytes,play=Date.now();
    console.log('Pressing Play');
    await host.locator('#howtoGo:not([disabled])').click();
    let timedOut=false;
    await host.waitForFunction(()=>window.__loadProbe.ready>0,null,{timeout:90000}).catch(()=>{timedOut=true;});
    const hostReadyMs=Date.now()-play;
    if(process.env.KART_LOAD_PROFILE){const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(out+'/cpu.json',JSON.stringify(profile));}
    await Promise.all(page.frames().filter(f=>/[?&]seat=/.test(f.url())).map(f=>f.waitForFunction(()=>window.__loadProbe.ready>0,null,{timeout:60000}))).catch(()=>{timedOut=true;});
    const allReadyMs=Date.now()-play,bytesAtReady=receivedBytes;
    await host.waitForFunction(()=>document.getElementById('gbody')?.getAttribute('aria-busy')==='false',null,{timeout:10000}).catch(()=>{timedOut=true;});
    const usableMs=Date.now()-play;
    const seats=await Promise.all(page.frames().filter(f=>/[?&]seat=/.test(f.url())).map(f=>f.evaluate(()=>({url:location.href,probe:window.__loadProbe,body:document.body.innerText.slice(-1000),webgl:!!document.querySelector('.pk-stage canvas,.pke-stage canvas')?.getContext('webgl2'),resources:performance.getEntriesByType('resource').map(r=>({url:r.name,decoded:r.decodedBodySize,encoded:r.encodedBodySize,start:r.startTime,end:r.responseEnd}))}))));
    await page.screenshot({path:out+'/ready.png'});
    const result={perSeatLink:process.env.KART_LOAD_PER_SEAT==='1',timedOut,hostReadyMs,playToReadyMs:allReadyMs,usableMs,wireBodyBytesAfterPlay:bytesAtReady-before,wireBodyBytesAtReady:bytesAtReady,navigationToReadyMs:Date.now()-nav,encodedBytesBeforePlay:before,encodedBytesTotal:Array.from(requests.values()).reduce((a,r)=>a+r.encoded,0),decodedBytesTotal:Array.from(requests.values()).reduce((a,r)=>a+r.decoded,0),requests:Array.from(requests.values()),seats,errors};
    fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify({...result,requests:result.requests.length,seats:seats.map(s=>({...s,resources:s.resources.length}))},null,2));
    if(timedOut||errors.length||seats.some(seat=>!seat.webgl||!seat.probe.streams||/Top-down view|couldn.t load/.test(seat.body)))process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
