'use strict';
// Shipping Five Second control on the existing DOM stub; controlled-fixture
// clock regression, not native input or natural five-second timing acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixtureNow}=require('./party-native-browser');
const {makeDocument,surface}=require('./party-mobile');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
(async()=>{
 const util=data(fs.readFileSync(path.join(__dirname,'../public/js/util.js'),'utf8'));
 const source=fs.readFileSync(path.join(__dirname,'../public/js/games/five-second.js'),'utf8').replace("'../util.js'",JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
 const view=(await import(data(source))).default,doc=makeDocument(),el=surface(doc),sent=[],virtual=100000,wall=virtual+15000;
 const previous=global.document;global.document=doc;
 try{
  let S={instanceId:'qa-round-two',round:2,rounds:2,phase:'answer',me:'b',performer:'b',players:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],spectator:false,preparing:false,category:'Foods',endsAt:virtual+5000,gameNow:virtual,serverNow:wall};
  const api={now:()=>wall,send:a=>{sent.push(a);return true;}};
  view.render(el,S,api);el.querySelector('#fAns').value='one, two, three';el.querySelector('#fSend').click();assert.equal(sent.length,0,'old wall-clock fixture API reproduces declined round2 control');
  api.now=()=>fixtureNow(S,()=>wall);view.render(el,S,api);el.querySelector('#fSend').click();
  assert.equal(sent.length,1,'round2 performer submits before virtual deadline despite wall geometry delay');assert.deepEqual(sent[0],{answers:'one, two, three'});
  S={...S,gameNow:S.endsAt};view.render(el,S,api);el.querySelector('#fSend').click();assert.equal(sent.length,1,'explicit authority-time expiry still rejects late control');
  assert.equal(fixtureNow({preparing:true,gameNow:virtual},()=>wall),virtual);assert.equal(fixtureNow({preparing:false,gameNow:virtual},()=>wall),virtual);assert.equal(fixtureNow({},()=>wall),wall);
  console.log('PARTY_NATIVE_CLOCK_PASS: shipping round2 performer sends with controlled gameNow; explicit5s expiry rejects; preparing/released clock domains agree; no native/natural-clock verdict');
 }finally{view.dispose?.();global.document=previous;}
})().catch(e=>{console.error(e);process.exitCode=1;});
