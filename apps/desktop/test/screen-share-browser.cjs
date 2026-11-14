/* Normal Meet UI with the real shared engine and a development-only SDK stand-in.
 * The SDK/network is simulated. Native capture selects only a synthetic browser tab.
 * Start Next with NEXT_PUBLIC_GIGGLE_LOCAL_RTC_FIXTURE=1 on loopback. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {chromium,expect}=require('@playwright/test');
const base=process.env.MEET_WEB_TEST_URL||'http://localhost:4114',out=process.env.SCREEN_SHARE_EVIDENCE||'/tmp/giggle-normal-screen-share';
const source=fs.readFileSync(path.join(__dirname,'../e2e/encounter.spec.ts'),'utf8');
const section=source.slice(source.indexOf('const fixtureUserId ='),source.indexOf('test("an ended encounter'));
const js=ts.transpileModule(section,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const {installEncounterFixture,fixtureEncounter,fixtureMember}=new Function('Buffer',js+';return {installEncounterFixture,fixtureEncounter,fixtureMember};')(Buffer);
function sdkFixture(){
  const wrap=(track,timer)=>({trackMediaType:track.kind,getMediaStreamTrack:()=>track,on:(event,cb)=>{if(event==='track-ended')track.addEventListener('ended',cb);},setEnabled:async on=>{track.enabled=on;},setMuted:async muted=>{track.enabled=!muted;},setVolume(){},stop(){},close(){clearInterval(timer);track.stop();},play(host){if(!host)return;host.replaceChildren();const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.style.cssText='width:100%;height:100%;object-fit:cover';video.srcObject=new MediaStream([track]);host.appendChild(video);void video.play();}});
  function camera(name){const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');const draw=()=>{ctx.fillStyle='#1f5060';ctx.fillRect(0,0,640,360);ctx.fillStyle='#a7efe5';ctx.font='42px sans-serif';ctx.fillText(name,60,180);};draw();const timer=setInterval(draw,100);return wrap(canvas.captureStream(10).getVideoTracks()[0],timer);}
  let sdkClient;
  window.__GIGGLE_TEST_RTC__={setLogLevel(){},disableLogUpload(){},createClient(){console.log('SDK fixture creating client');const handlers=new Map(),published=new Set();const emit=(event,...args)=>handlers.get(event)?.forEach(fn=>fn(...args));const remotes=[101,200,201].map(uid=>({uid,hasVideo:true,hasAudio:false,videoTrack:camera('Synthetic peer '+uid)}));sdkClient={uid:100,remoteUsers:remotes,connectionState:'DISCONNECTED',on(event,fn){if(!handlers.has(event))handlers.set(event,[]);handlers.get(event).push(fn);},async join(_app,_channel,_token,uid){this.uid=uid;this.connectionState='CONNECTED';emit('connection-state-change','CONNECTED');remotes.forEach(user=>{emit('user-joined',user);emit('user-published',user,'video');});return uid;},async leave(){this.connectionState='DISCONNECTED';emit('connection-state-change','DISCONNECTED');},async publish(tracks){for(const track of [].concat(tracks)){if(track.trackMediaType==='video'&&[...published].some(p=>p.trackMediaType==='video'&&p!==track))throw Error('Only one video slot');published.add(track);}},async unpublish(tracks){[].concat(tracks).forEach(track=>published.delete(track));},async subscribe(){},enableAudioVolumeIndicator(){},async renewToken(){}};return sdkClient;},async createCameraVideoTrack(){return camera('Synthetic camera');},async createMicrophoneAudioTrack(){const c=new AudioContext(),source=c.createOscillator(),destination=c.createMediaStreamDestination();source.connect(destination);source.start();const track=destination.stream.getAudioTracks()[0];return wrap(track);},createScreenVideoTrack(){return navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).then(stream=>{const track=stream.getVideoTracks()[0];if(track.getSettings().displaySurface!=='browser'){stream.getTracks().forEach(t=>t.stop());throw Error('Fixture tab only');}return wrap(track);});}};
}
(async()=>{
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--enable-usermedia-screen-capturing','--allow-http-screen-capture','--auto-select-tab-capture-source-by-title=Giggle normal screen fixture']});
  const deadline=setTimeout(()=>void browser.close(),120000);
  try{
    const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Page error',e.message);});page.on('console',m=>{if(m.type()==='error'||m.text().startsWith('SDK'))console.log('Browser',m.text().slice(0,400));});page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)console.log('API',r.status(),new URL(r.url()).pathname);});
    await installEncounterFixture(page);await page.addInitScript(sdkFixture);
    let emit,localSharing=false,remoteUntil=0;
    await page.routeWebSocket(/socket\.io/,socket=>{emit=(name,payload)=>socket.send('42'+JSON.stringify([name,payload]));socket.send('0'+JSON.stringify({sid:'screen-engine',upgrades:[],pingInterval:60000,pingTimeout:60000}));socket.onMessage(message=>{const text=String(message);if(text.startsWith('40')){socket.send('40'+JSON.stringify({sid:'screen-socket'}));return;}if(text==='2'){socket.send('3');return;}const event=text.match(/^42(\d*)(\[[\s\S]*\])$/);if(!event)return;const [name,input]=JSON.parse(event[2]);if(name==='member_media'&&event[1]){if(input.action==='update')localSharing=input.screenSharing;if(input.action==='end')localSharing=false;socket.send('43'+event[1]+'['+JSON.stringify({ok:true,mediaSessionId:'screen-lease'})+']');emit('SQUAD_UPDATED',{});}});});
    const roster=()=>{const e=fixtureEncounter('fixture-2v2',2);e.squadAMembers[0].screenSharing=localSharing;e.squadAMembers[0].screenSharingExpiresAt=Date.now()+30000;e.squadAMembers[1].screenSharing=!!remoteUntil;e.squadAMembers[1].screenSharingExpiresAt=remoteUntil;return e;};
    await page.route('**/api/squads/fixture-squad/lobby-video',route=>route.fulfill({json:{ok:true,data:{memberId:'mine-member-1',inLobbyVideo:false}}}));
    await page.route('**/api/matchmaking/status/*',route=>route.fulfill({json:{ok:true,data:{state:'searching',match:null}}}));
    await page.route('**/api/me/wallet',route=>route.fulfill({json:{ok:true,data:{coins:0}}}));
    await page.route('**/api/encounters/token',route=>route.fulfill({json:{ok:true,data:{appId:'fixture',rtcToken:'fixture',channelName:'screen-room',uid:100,expiresAt:Date.now()+3600000}}}));
    await page.route('**/api/agora/lobby-token/*',route=>route.fulfill({json:{ok:true,data:{appId:'fixture',rtcToken:'fixture',channelName:'screen-lobby',uid:100,expiresAt:Date.now()+3600000}}}));
    await page.route('**/api/matchmaking/encounters/fixture-2v2',route=>route.fulfill({json:{ok:true,data:roster()}}));
    const tab=await context.newPage();await tab.route('**/__screen-fixture',route=>route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><title>Giggle normal screen fixture</title><body style="background:#123a50;color:white;font:clamp(18px,4vw,48px) sans-serif">NORMAL SCREEN TEST →</body>'}));await tab.goto(base+'/__screen-fixture');
    await page.goto(base+'/encounter?squad=fixture-squad&enc=fixture-2v2');await expect(page.locator('[data-screen-share]')).toBeEnabled({timeout:30000});await page.bringToFront();await page.getByRole('button',{name:'Share screen',exact:true}).click();await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toBeEnabled({timeout:20000});
    const local=page.locator('[data-local=true][data-video-source=screen]');await expect(local).toContainText('Your screen');await expect.poll(()=>local.locator('[data-media-host] video').evaluateAll(v=>v.some(v=>v.readyState>=2))).toBe(true);
    remoteUntil=Date.now()+3000;emit('SQUAD_UPDATED',{});const remote=page.locator('[data-video-source=screen][data-local=false]');await expect(remote).toHaveCount(1);await expect(remote).toContainText('Squadmate 2 · Screen');await expect(remote).toHaveCount(0,{timeout:10000});
    for(const [name,width,height] of [['desktop',1280,800],['phone',390,844]]){await page.setViewportSize({width,height});await local.scrollIntoViewIfNeeded();const fit=await local.locator('[data-media-host] video').evaluate(v=>({fit:getComputedStyle(v).objectFit,transform:getComputedStyle(v).transform}));assert.deepEqual(fit,{fit:'contain',transform:'none'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,name+'-encounter.png')});}
    await page.getByRole('button',{name:'Stop sharing',exact:true}).click();await expect(local).toHaveCount(0);
    await page.goto(base+'/lobby?squad=fixture-squad');
    await page.getByRole('button',{name:'Turn camera on',exact:true}).click();
    await expect(page.getByRole('button',{name:'Share screen',exact:true})).toBeEnabled();
    await page.bringToFront();await page.getByRole('button',{name:'Share screen',exact:true}).click();
    const lobbyScreen=page.locator('[data-testid=lobby-person][data-video-source=screen]');await expect(lobbyScreen).toContainText('Your screen');
    await expect.poll(()=>lobbyScreen.locator('video').evaluateAll(v=>v.some(v=>v.readyState>=2))).toBe(true);
    await page.screenshot({path:path.join(out,'phone-lobby.png')});
    await page.getByRole('button',{name:'Stop sharing',exact:true}).click();await expect(lobbyScreen).toHaveCount(0);
    await page.goto(base+'/matchmaking?squad=fixture-squad');await expect(page.getByTestId('search-squad-call')).toBeVisible();
    const connect=page.getByRole('button',{name:'Start squad call',exact:true});if(await connect.count())await connect.click();
    await expect(page.getByRole('button',{name:'Share screen',exact:true})).toBeEnabled();
    await page.bringToFront();await page.getByRole('button',{name:'Share screen',exact:true}).click();
    const searchScreen=page.getByTestId('search-squad-call').locator('[data-local=true][data-video-source=screen]');await expect(searchScreen).toContainText('Your screen');
    await page.screenshot({path:path.join(out,'phone-search.png')});await page.getByRole('button',{name:'Stop sharing',exact:true}).click();
    assert.deepEqual(errors,[]);console.log(JSON.stringify({provider:'simulated Agora SDK',nativeFixtureTabCapture:true,desktopAndPhone:true,remoteRosterRefreshAndExpiry:true,evidence:out}));
  }finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
