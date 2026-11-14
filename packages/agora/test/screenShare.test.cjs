const test = require('node:test');
const assert = require('node:assert/strict');
const token={appId:'test',channelName:'first-room',rtcToken:'test',uid:1};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}
function track(kind,name){const handlers=new Map();return{kind,name,closed:0,plays:0,enabled:true,ended:false,on(event,fn){handlers.set(event,fn);},end(){this.ended=true;handlers.get('track-ended')?.();},getMediaStreamTrack(){return{readyState:this.ended?'ended':'live'};},stop(){},close(){this.closed++;this.ended=true;},play(){this.plays++;},async setEnabled(on){this.enabled=on;},async setMuted(){}};}
function fixture(){
  const audio=track('audio','microphone'),camera=track('video','camera'),screen=track('video','screen'),calls={camera:0,screen:0,join:0},published=new Set(),events=[];
  const handlers=new Map();
  const rtc={on(event,fn){handlers.set(event,fn);},removeAllListeners(){handlers.clear();},async join(){calls.join++;},async leave(){published.clear();},async publish(tracks){
    for(const t of tracks)if(t.kind==='video'&&[...published].some(old=>old.kind==='video'&&old!==t))throw Error('Only one outgoing video is allowed');
    tracks.forEach(t=>published.add(t));
  },async unpublish(tracks){tracks.forEach(t=>published.delete(t));},async renewToken(){},async subscribe(){}};
  const sdk={createClient:()=>rtc,async createMicrophoneAudioTrack(){return audio;},async createCameraVideoTrack(){calls.camera++;return camera;},createScreenVideoTrack(config,withAudio){calls.screen++;events.push({config,withAudio});return Promise.resolve(screen);}};
  return{audio,camera,screen,calls,published,rtc,sdk,events,handlers};
}
async function joined(f,devices={audio:true,video:true}){const {createVideoClient}=await import('../src/web.ts');const client=createVideoClient(async()=>f.sdk),states=[];client.onCaptureState(s=>states.push(s));await client.join(token,devices);return{client,states};}

test('screen replaces one published video, retains microphone/UID/client and restores the same camera',async()=>{
  const f=fixture(),{client,states}=await joined(f);
  try{
    const start=client.startScreenShare();assert.equal(f.calls.screen,1,'picker starts before the returned promise is awaited');await start;
    assert.deepEqual([...f.published],[f.audio,f.screen]);assert.equal(states.at(-1).video,'active');assert.equal(states.at(-1).screen,'active');assert.equal(states.at(-1).videoSource,'screen');assert.equal(f.events[0].withAudio,'disable','sharing does not capture private system audio');
    const host={};client.playLocal(host);client.playLocal(host);assert.equal(f.screen.plays,1);
    await client.startScreenShare();assert.equal(f.calls.screen,1,'double start keeps the current source');
    await client.stopScreenShare();await client.stopScreenShare();assert.deepEqual([...f.published],[f.audio,f.camera]);assert.equal(states.at(-1).screen,'off');assert.equal(states.at(-1).videoSource,'camera');assert.equal(f.calls.camera,1);assert.equal(f.calls.join,1);assert(f.screen.closed>0);assert.equal(f.audio.closed,0);
  }finally{await client.leave();}
});
test('a camera-off caller shares and stops without starting a camera',async()=>{
  const f=fixture(),{client,states}=await joined(f,{audio:true,video:false});try{await client.startScreenShare();assert.equal(states.at(-1).video,'off');await client.stopScreenShare();assert.deepEqual([...f.published],[f.audio]);assert.equal(f.calls.camera,0);}finally{await client.leave();}
});
for(const name of ['NotAllowedError','AbortError'])test(`${name} leaves the camera and microphone unchanged`,async()=>{
  const f=fixture(),{client,states}=await joined(f);f.sdk.createScreenVideoTrack=()=>Promise.reject(new DOMException('Picker cancelled or denied',name));try{await assert.rejects(client.startScreenShare());assert.deepEqual([...f.published],[f.audio,f.camera]);assert.equal(states.at(-1).video,'active');assert.equal(states.at(-1).videoSource,'camera');assert.equal(f.camera.closed,0);}finally{await client.leave();}
});
test('failed screen publication rolls back the camera and closes the selected display',async()=>{
  const f=fixture(),{client,states}=await joined(f),publish=f.rtc.publish;f.rtc.publish=async tracks=>{if(tracks.includes(f.screen))throw Error('Synthetic publish failure');return publish(tracks);};
  try{await assert.rejects(client.startScreenShare(),/publish failure/);assert.deepEqual([...f.published],[f.audio,f.camera]);assert(f.screen.closed>0);assert.equal(states.at(-1).screen,'unavailable');assert.equal(states.at(-1).video,'active');}finally{await client.leave();}
});
test('browser Stop sharing restores the camera once',async()=>{
  const f=fixture(),{client,states}=await joined(f);try{await client.startScreenShare();f.screen.end();await flush();assert.deepEqual([...f.published],[f.audio,f.camera]);assert.equal(states.at(-1).screen,'off');assert.equal(f.calls.camera,1);}finally{await client.leave();}
});
test('a selected track that already ended cannot be reported active',async()=>{
  const f=fixture(),{client,states}=await joined(f);f.screen.ended=true;try{await assert.rejects(client.startScreenShare(),/no longer available/);assert.notEqual(states.at(-1).screen,'active');assert.deepEqual([...f.published],[f.audio,f.camera]);}finally{await client.leave();}
});
test('camera restoration failure leaves display off, reports camera error and preserves the microphone',async()=>{
  const f=fixture(),{client,states}=await joined(f);try{await client.startScreenShare();f.rtc.publish=async tracks=>{if(tracks.includes(f.camera))throw new DOMException('Camera denied','NotAllowedError');};await assert.rejects(client.stopScreenShare(),/Camera denied/);assert.equal(states.at(-1).screen,'off');assert.equal(states.at(-1).video,'denied');assert(f.camera.closed>0);assert(f.screen.closed>0);assert(f.published.has(f.audio));assert.equal(f.audio.closed,0);}finally{await client.leave();}
});
for(const stop of ['leave','stop','move'])test(`a picker completing after ${stop} is closed and never published`,async()=>{
  const f=fixture(),{client,states}=await joined(f),picker=deferred();f.sdk.createScreenVideoTrack=()=>picker.promise;
  const start=client.startScreenShare().catch(e=>e);await flush();
  if(stop==='leave')await client.leave();else if(stop==='stop')await client.stopScreenShare();else await client.moveToChannel({...token,channelName:'second-room'});
  picker.resolve(f.screen);assert.match((await start).message,/cancelled/);assert(f.screen.closed>0);assert(!f.published.has(f.screen));assert.notEqual(states.at(-1).screen,'active');await client.leave();
});
test('leaving during screen publish closes display immediately and late completion cannot revive it',async()=>{
  const f=fixture(),{client,states}=await joined(f),gate=deferred(),reached=deferred(),publish=f.rtc.publish;f.rtc.publish=async tracks=>{await publish(tracks);if(tracks.includes(f.screen)){reached.resolve();await gate.promise;}};
  const start=client.startScreenShare().catch(e=>e);await reached.promise;await client.leave();assert(f.screen.closed>0);gate.resolve();assert.match((await start).message,/cancelled/);assert.notEqual(states.at(-1).screen,'active');assert(!f.published.has(f.screen));
});
test('room transfer stops screen sharing and keeps original microphone and camera choices',async()=>{
  const f=fixture(),{client,states}=await joined(f);try{await client.startScreenShare();await client.moveToChannel({...token,channelName:'second-room'});assert(f.screen.closed>0);assert.deepEqual([...f.published],[f.audio,f.camera]);assert.equal(states.at(-1).videoSource,'camera');assert.equal(f.calls.camera,1);assert.equal(f.audio.closed,0);}finally{await client.leave();}
});
test('camera enabled during a pending capture stays unpublished behind a shared screen',async()=>{
  const f=fixture(),{client,states}=await joined(f,{audio:true,video:false}),camera=deferred();f.sdk.createCameraVideoTrack=()=>camera.promise;
  try{const enable=client.setCamEnabled(true);await client.startScreenShare();camera.resolve(f.camera);await enable;assert.deepEqual([...f.published],[f.audio,f.screen]);assert.equal(states.at(-1).video,'active');await client.stopScreenShare();assert.deepEqual([...f.published],[f.audio,f.camera]);}finally{await client.leave();}
});
test('camera off during an in-flight screen publish stays off when sharing stops',async()=>{
  const f=fixture(),{client,states}=await joined(f),gate=deferred(),reached=deferred(),publish=f.rtc.publish;f.rtc.publish=async tracks=>{await publish(tracks);if(tracks.includes(f.screen)){reached.resolve();await gate.promise;}};
  try{const start=client.startScreenShare().catch(e=>e);await reached.promise;const off=client.setCamEnabled(false),stop=client.stopScreenShare();assert(f.screen.closed>0);gate.resolve();await start;await off;await stop;assert.equal(states.at(-1).video,'off');assert.deepEqual([...f.published],[f.audio]);}finally{gate.resolve();await client.leave();}
});
test('call-session starts the picker in the click stack and a stopped session cannot be revived',async()=>{
  const {createCallSession}=await import('../src/callSession.ts');let pickerCalls=0;const picker=deferred(),states=new Set();
  const client={supportsScreenShare:true,remotes:[],async join(){},async leave(){},onRemoteChange(){return()=>{};},onCaptureState(fn){states.add(fn);return()=>states.delete(fn);},startScreenShare(){pickerCalls++;return picker.promise;},async stopScreenShare(){}};
  const session=createCallSession({createClient:()=>client,getToken:async()=>token,setPresence:async()=>{}});await session.connect('squad');const start=session.startScreenShare('squad');assert.equal(pickerCalls,1);await session.stop();picker.resolve();await assert.rejects(start,/cancelled/);assert.equal(session.getSnapshot().joined,false);assert.equal(session.getSnapshot().client,null);
});

async function metadataSession(setScreenPresence){
  const {createVideoClient}=await import('../src/web.ts'),{createCallSession}=await import('../src/callSession.ts'),clients=[];
  const session=createCallSession({createClient(){const f=fixture(),client=createVideoClient(async()=>f.sdk);Object.defineProperty(client,'supportsScreenShare',{value:true});clients.push({...f,client});return client;},getToken:async()=>token,setPresence:async()=>{},setScreenPresence});
  await session.connect('squad',null,{audio:true,video:true});return{session,clients};
}
test('metadata awaits true publication, renews only the owned share and clears after browser stop',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const messages=[],{session,clients}=await metadataSession(async(s,e,on,context)=>{messages.push({s,e,on,id:context.shareId});});
  try{await session.startScreenShare('squad');assert.equal(messages.length,1);assert.equal(messages[0].on,true);t.mock.timers.tick(10000);await flush();assert.equal(messages.length,2);assert.equal(messages[1].id,messages[0].id);clients[0].screen.end();await flush();assert.equal(messages.at(-1).on,false);assert.equal(messages.at(-1).id,messages[0].id);const count=messages.length;t.mock.timers.tick(20000);await flush();assert.equal(messages.length,count);}finally{await session.stop();t.mock.timers.reset();}
});
for(const failure of ['initial','heartbeat'])test(`${failure} metadata rejection stops display and restores camera without leaving the call`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let trues=0;const {session,clients}=await metadataSession(async(s,e,on)=>{if(on&&++trues===(failure==='initial'?1:2))throw Error('Metadata unavailable');});
  try{if(failure==='initial')await assert.rejects(session.startScreenShare('squad'),/Metadata unavailable/);else{await session.startScreenShare('squad');t.mock.timers.tick(10000);await flush();}assert.equal(session.getSnapshot().joined,true);assert.equal(session.getSnapshot().capture.screen,'off');assert.equal(session.getSnapshot().error.message,'Metadata unavailable');assert.deepEqual([...clients[0].published],[clients[0].audio,clients[0].camera]);}finally{await session.stop();t.mock.timers.reset();}
});
test('late old metadata cleanup cannot clear a replacement share in the same room',async()=>{
  const old=deferred(),messages=[],bindings=new Map();let generation=1,active=null;
  const {session}=await metadataSession(async(s,e,on,{shareId})=>{
    if(on){if(!bindings.has(shareId))bindings.set(shareId,generation);const owned=bindings.get(shareId);messages.push({on,shareId,owned});if(owned===1)await old.promise;if(owned===generation)active=shareId;}
    else{const owned=bindings.get(shareId);messages.push({on,shareId,owned});if(owned===generation&&active===shareId)active=null;}
  });
  const first=session.startScreenShare('squad').catch(error=>error);await flush();await session.stop();generation=2;await session.connect('squad',null,{audio:true,video:true});
  try{await session.startScreenShare('squad');const replacement=active;assert(replacement);old.resolve();await first;await flush();assert.equal(active,replacement);assert.equal(session.getSnapshot().capture.screen,'active');const retired=messages.find(m=>m.on&&m.owned===1);assert(messages.some(m=>!m.on&&m.shareId===retired.shareId&&m.owned===1));assert.notEqual(retired.shareId,replacement);}finally{old.resolve();await session.stop();}
});
test('network reconnect retires screen metadata and never automatically reopens the picker',async()=>{
  const messages=[],{session,clients}=await metadataSession(async(s,e,on)=>{messages.push(on);});
  try{await session.startScreenShare('squad');clients[0].handlers.get('connection-state-change')('RECONNECTING');await flush();assert.equal(session.getSnapshot().capture.screen,'off');assert.equal(messages.at(-1),false);clients[0].handlers.get('connection-state-change')('CONNECTED');await flush();assert.equal(clients[0].calls.screen,1);assert.equal(session.getSnapshot().capture.screen,'off');}finally{await session.stop();}
});

test('server audio-only policy never captures camera or display, including a video-room transfer',async()=>{
 const {createVideoClient}=await import('../src/web.ts');
 const f=fixture(),client=createVideoClient(async()=>f.sdk),states=[];client.onCaptureState(s=>states.push(s));
 try{await client.join({...token,audioOnly:true},{audio:true,video:true});assert.equal(f.calls.camera,0);assert.equal(client.supportsScreenShare,false);await assert.rejects(client.setCamEnabled(true),/audio only/);await assert.rejects(client.startScreenShare(),/audio only/);assert.equal(f.calls.screen,0);assert.equal(states.at(-1).video,'off');}
 finally{await client.leave();}
 const g=fixture(),joinedCall=await joined(g);try{await joinedCall.client.moveToChannel({...token,channelName:'voice',audioOnly:true});assert(g.camera.closed>0);assert.equal(joinedCall.states.at(-1).video,'off');assert(!g.published.has(g.camera));assert(g.published.has(g.audio));await assert.rejects(joinedCall.client.startScreenShare(),/audio only/);}finally{await joinedCall.client.leave();}
});


test('authoritative receiving roster blocks unknown audio and retires late subscriptions before playback',async()=>{
 const {createVideoClient}=await import('../src/web.ts'),f=fixture(),waiting=deferred(),unsubscribed=[];
 const audio=track('audio','remote microphone');audio.setVolume=value=>{audio.volume=value;};audio.stop=()=>{audio.stops=(audio.stops||0)+1;};
 const user={uid:2,hasAudio:true,hasVideo:false,audioTrack:audio};f.rtc.subscribe=async()=>waiting.promise;f.rtc.unsubscribe=async(user,kind)=>unsubscribed.push([user.uid,kind]);
 const client=createVideoClient(async()=>f.sdk),remotes=[];client.onRemoteChange(list=>remotes.push(list));
 try{await client.join({...token,allowedRemoteUids:[]},{audio:false,video:false});f.handlers.get('user-joined')(user);await f.handlers.get('user-published')(user,'audio');assert.equal(audio.plays,0);assert.deepEqual(remotes.at(-1),[]);
  const allowed=client.setAllowedRemoteUids([2]);await flush();const retired=client.setAllowedRemoteUids([]);assert.equal(audio.volume,0);assert(audio.stops>0);waiting.resolve();await Promise.all([allowed,retired]);assert.equal(audio.plays,0);assert.deepEqual(remotes.at(-1),[]);assert(unsubscribed.some(([uid,kind])=>uid===2&&kind==='audio'));
  await client.setAllowedRemoteUids([2]);assert.equal(audio.plays,1);assert.equal(audio.volume,100);assert.equal(remotes.at(-1)[0].uid,2);
 }finally{await client.leave();}
});

test('a late unsubscribe finishes before the same authorized UID is subscribed again',async()=>{
 const {createVideoClient}=await import('../src/web.ts'),f=fixture(),gate=deferred(),events=[];
 const user={uid:2,hasAudio:true,hasVideo:false,audioTrack:{setVolume(){},stop(){},play(){events.push('play');}}};
 f.rtc.subscribe=async()=>{events.push('subscribe');};f.rtc.unsubscribe=async()=>{events.push('unsubscribe-start');await gate.promise;events.push('unsubscribe-end');};
 const client=createVideoClient(async()=>f.sdk);try{await client.join({...token,allowedRemoteUids:[2]},{audio:false,video:false});await f.handlers.get('user-published')(user,'audio');events.length=0;
  const removed=client.setAllowedRemoteUids([]);await flush();const returned=client.setAllowedRemoteUids([2]);await flush();assert(!events.includes('subscribe'));
  gate.resolve();await Promise.all([removed,returned]);assert(events.lastIndexOf('unsubscribe-end')<events.indexOf('subscribe'));assert.equal(events.at(-1),'play');
 }finally{await client.leave();}
});
