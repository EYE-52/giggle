// Exercise production customizer callbacks and native-number validation with
// a small DOM/clock double. Real WebSocket acknowledgement is configure-ack.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import GAME from '../games/pocket-karts/server.js';
const read=name=>fs.readFileSync(new URL('../public/js/'+name,import.meta.url),'utf8');
const util='data:text/javascript;base64,'+Buffer.from(read('util.js')).toString('base64');
const setup=await import('data:text/javascript;base64,'+Buffer.from(read('kart-setup.js').replace("'./util.js'",JSON.stringify(util))).toString('base64'));
const source=read('customize.js').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const g={id:'pocket-karts',name:'Pocket Karts',schema:{settings:GAME.manifest.settings,packs:[]}};
const defaults=Object.fromEntries(g.schema.settings.map(s=>[s.key,s.def]));
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
function rig({detached=false,connected=true}={}){
 const nodes=new Map(),timers=new Map(),requests=[],toasts=[],sync=[],listeners=new Map();let sequence=0;
 const document={activeElement:null,html:{tagName:'HTML'},getElementById:id=>nodes.get(id),contains:node=>!!node?.connected,
  querySelector:selector=>selector===`[data-how="${g.id}"]`?card:null,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 function node(id,attributes={}){
  const n={id,connected:true,value:attributes.value||'',type:attributes.type||'',checked:'checked'in attributes,hidden:'hidden'in attributes,textContent:'',tabIndex:0,attributes,
   focus(){document.activeElement=n;},addEventListener(){},reportValidity(){n.reported=true;},
   checkValidity(){const v=Number(n.value);return n.value===''||Number.isFinite(v)&&Number.isInteger(v)&&v>=Number(attributes.min)&&v<=Number(attributes.max);}};
  Object.defineProperty(n,'disabled',{get:()=>n.off||false,set:value=>{n.off=value;if(value&&document.activeElement===n)document.activeElement=document.html;}});
  n.disabled='disabled'in attributes;nodes.set(id,n);return n;
 }
 const opener=node('original-opener'),card=node('live-game-card');opener.connected=!detached;
 const root=node('dlg-root');
 Object.defineProperty(root,'innerHTML',{get:()=>root.markup||'',set:html=>{
  for(const[id,n]of nodes)if(n.dialog){n.connected=false;nodes.delete(id);}root.markup=html;
  for(const match of html.matchAll(/<(\w+)\b([^>]*\bid="[^"]+"[^>]*)>/g)){
   const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]??'']));
   const n=node(attrs.id,attrs);n.tagName=match[1].toUpperCase();n.dialog=true;n.textContent=html.slice(match.index+match[0].length).split('<')[0];
  }
 }});
 root.querySelectorAll=selector=>[...nodes.values()].filter(n=>n.dialog&&(selector==='input[type="number"]'?n.type==='number':selector==='[data-hostonly]'?'data-hostonly'in n.attributes:false));
 root.contains=node=>!!node?.dialog&&node.connected;
 document.querySelectorAll=selector=>root.querySelectorAll(selector.replace('#dlg-root ',''));
 root.querySelector=selector=>selector.includes('.dlg input')?[...nodes.values()].find(n=>n.dialog&&n.tagName==='INPUT'&&!n.disabled):null;
 const context={document,Date,esc:String,store:{get:()=>null,set(){}},kartSetupHtml:setup.kartSetupHtml,wireKartSetup(){},syncKartSetup:(...args)=>sync.push(args),
  setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source+'\nglobalThis.qa={openCustomizer,closeCustomizer,customizerResult,refreshCustomizer,isCustomizerOpen};',context);
 context.qa.openCustomizer({game:g,config:{},host:true,opener,toast:m=>toasts.push(m),onSave:(game,settings,pack,requestId)=>{requests.push({game,settings,pack,requestId});return connected;},onReset:(game,requestId)=>{requests.push({game,requestId});return connected;},onClearPack(){}});
 const save=()=>{const b=nodes.get('dlgSave');b.focus();b.onclick();return requests.at(-1);};
 const reset=()=>{nodes.get('dlgReset').onclick();return requests.at(-1);};
 const ack=request=>context.qa.customizerResult({game:request.game,requestId:request.requestId});
 return {...context.qa,document,nodes,timers,requests,toasts,sync,opener,card,root,save,reset,ack};
}
for(const detached of [false,true]){
 const r=rig({detached});r.nodes.get('df-pocket-karts-map').value='Alpine Courtyard';const request=r.save();
 eq(request.settings.map,'Alpine Courtyard','Save collects the selected elevated map');
 eq(JSON.parse(JSON.stringify(request.settings)),{...defaults,map:'Alpine Courtyard'},'Save preserves complete replacement settings including inactive targets');
 eq(r.nodes.get('dlgSave').textContent,'Saving…','pending Save has visible progress');ok(r.nodes.get('dlgSave').disabled,'pending Save cannot double-submit');
 ok(r.nodes.get('df-pocket-karts-roundSeconds').disabled&&r.nodes.get('dlgReset').disabled,'pending request prevents newer edits being discarded by its acknowledgement');
 r.customizerResult({game:'trivia',requestId:request.requestId});r.customizerResult({game:g.id,requestId:'other'});
 r.refreshCustomizer({'pocket-karts':{settings:request.settings,packs:{}}},true);
 ok(r.isCustomizerOpen()&&r.nodes.get('dlgSave').disabled,'unrelated acknowledgements and lobby repaint cannot claim success');
 r.ack(request);ok(!r.isCustomizerOpen(),'matching confirmed Save closes the dialog');eq(r.timers.size,0,'confirmed Save retires timeout');
 eq(r.document.activeElement,detached?r.card:r.opener,'confirmed Save restores surviving opener or current game card');eq(r.toasts,['Settings saved'],'successful Save has one confirmation');
 r.ack(request);eq(r.toasts.length,1,'duplicate acknowledgement is inert');
}
{
 const r=rig(),request=r.reset();r.ack(request);ok(r.isCustomizerOpen(),'Reset stays open');eq(r.nodes.get('dlgStatus').textContent,'Reset to defaults','Reset has inline confirmation');ok(!r.nodes.get('dlgStatus').hidden&&!r.nodes.get('dlgSave').disabled,'Reset confirmation is visible and editing is available');eq(r.timers.size,0,'Reset retires pending timeout');
}
{
 const r=rig();r.nodes.get('df-pocket-karts-targetHits').value='0';r.save();eq(r.requests.length,0,'invalid native number blocks transport');ok(r.nodes.get('df-pocket-karts-targetHits').reported,'invalid number reports its validity');eq(r.nodes.get('dlgSave').textContent,'Save settings','invalid number does not claim Saving');
}
{
 const r=rig();r.nodes.get('df-pocket-karts-map').value='Alpine Courtyard';const old=r.save();[...r.timers.values()][0]();
 ok(r.isCustomizerOpen()&&!r.nodes.get('dlgSave').disabled,'unconfirmed Save retains dialog and enables retry');eq(r.nodes.get('dlgErr').textContent,'Saving was not confirmed. Reconnect and try again.','timeout explains the failure');eq(r.nodes.get('df-pocket-karts-map').value,'Alpine Courtyard','timeout preserves selected map draft');
 ok(!r.nodes.get('df-pocket-karts-roundSeconds').disabled&&!r.nodes.get('dlgReset').disabled,'timeout restores host field and reset controls');
 eq(r.document.activeElement,r.nodes.get('dlgSave'),'timeout restores keyboard focus to retry');
 const current=r.save();ok(current.requestId!==old.requestId,'retry owns a fresh request');r.ack(old);ok(r.isCustomizerOpen()&&r.nodes.get('dlgSave').disabled,'late old acknowledgement cannot close retry');r.ack(current);ok(!r.isCustomizerOpen(),'matching retry completes');
}
{
 const r=rig({connected:false});r.save();ok(r.isCustomizerOpen()&&!r.nodes.get('dlgSave').disabled,'disconnected send keeps editable draft');eq(r.nodes.get('dlgErr').textContent,'Reconnect before saving settings.','failed transport is visible');eq(r.timers.size,0,'failed transport cancels timeout');
 eq(r.document.activeElement,r.nodes.get('dlgSave'),'failed transport keeps keyboard retry accessible');
}
{
 const r=rig(),request=r.save();r.customizerResult({...request,msg:'Only the host can change settings.'});ok(r.isCustomizerOpen()&&!r.nodes.get('dlgErr').hidden,'correlated server error stays visible in dialog');eq(r.timers.size,0,'server rejection retires timer');
 r.customizerResult({game:g.id});ok(r.isCustomizerOpen(),'unsolicited result with no pending request is inert');
}
{
 const r=rig(),request=r.save();r.refreshCustomizer({},false);r.ack(request);ok(r.isCustomizerOpen(),'losing host authority retires pending Save before late confirmation');ok(r.nodes.get('dlgSave').disabled,'read-only guest cannot retry saving');eq(r.toasts,[],'retired host request cannot announce success');
 eq(r.document.activeElement,r.nodes.get('dlgClose'),'lost host authority restores focus to usable Close');
}
console.log('CUSTOMIZER_SAVE_PASS: '+checks+' checks; production callbacks, DOM/clock double; native layout separate');
