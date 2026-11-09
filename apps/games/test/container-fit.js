'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {observeGameContainer,frameResize}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(__dirname+'/../public/js/container-fit.js','utf8')).toString('base64'));
 const jobs=new Map(),listeners=new Map();let seq=0,writes=0,disconnected=false,notify;
 const doc={body:{},addEventListener(){},removeEventListener(){}};
 const panel={parentElement:doc.body,getBoundingClientRect:()=>({bottom:700})};
 const root={ownerDocument:doc,parentElement:panel,isConnected:true,offsetWidth:420,getBoundingClientRect:()=>({top:60,width:420}),style:{setProperty(k,v){writes++;root[k]=v}}};
 const win={innerHeight:900,scrollY:0,requestAnimationFrame:f=>{jobs.set(++seq,f);return seq},cancelAnimationFrame:id=>jobs.delete(id),getComputedStyle:()=>({overflowY:'auto',paddingBottom:'0'}),addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 class Observer{constructor(f){notify=f}observe(){}disconnect(){disconnected=true}}
 const flush=()=>{const list=[...jobs.values()];jobs.clear();list.forEach(f=>f())};
 const dispose=observeGameContainer(root,{win,Observer});
 assert.equal(root['--game-viewport-height'],'640px','bounded panel height, not window height');
 for(let i=0;i<100;i++){notify();listeners.get('resize')()}
 assert.equal(jobs.size,1,'observer and resize coalesce into one frame');flush();assert.equal(writes,1,'unchanged geometry makes no style writes');
 win.scrollY=100;root.getBoundingClientRect=()=>({top:-40,width:420});panel.getBoundingClientRect=()=>({bottom:600});notify();flush();assert.equal(writes,1,'scrolling never changes the height budget');
 panel.scrollTop=120;root.getBoundingClientRect=()=>({top:-160,width:420});notify();flush();assert.equal(writes,1,'nested scrolling never grows the height budget');
 notify();dispose();assert.equal(jobs.size,0);assert(disconnected);assert.equal(listeners.size,0,'all listeners released');
 let calls=0;const resize=frameResize(()=>calls++,win);for(let i=0;i<100;i++)resize();assert.equal(jobs.size,1);flush();assert.equal(calls,1);resize();resize.cancel();flush();assert.equal(calls,1,'disposed drawing cannot resize');
 console.log('CONTAINER_FIT_PASS: actual bounds, scroll stability, one job per frame, no repeated writes, complete cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
