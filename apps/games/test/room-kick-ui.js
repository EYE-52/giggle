'use strict';
// Mounted production moderation helper with DOM doubles, not a browser test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/js/app.js'),'utf8');
const code=source.slice(source.indexOf('let kickConfirmation ='),source.indexOf('/* The room is a utility drawer'));
const sent=[],toasts=[],timers=new Map();let writes=0,sequence=0;
const document={activeElement:null,getElementById:id=>id==='roomMembers'?el:null};
let html='',nodes=[];
function matches(n,selector){const m=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&n.hasAttribute(m[1])&&(m[2]===undefined||n.attrs[m[1]]===m[2]);}
const el={
  get innerHTML(){return html;},set innerHTML(value){html=value;writes++;nodes=[...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(m=>{const attrs=Object.fromEntries([...m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]??'']));const n={attrs,dataset:{kick:attrs['data-kick']},textContent:m[2],disabled:Object.hasOwn(attrs,'disabled'),hasAttribute:key=>Object.hasOwn(attrs,key),focus(){document.activeElement=n;},addEventListener(type,fn){if(type==='click')n.clickHandler=fn;},click(){if(!n.disabled)(n.onclick||n.clickHandler)?.call(n);}};return n;});},
  contains:n=>nodes.includes(n),querySelector:s=>nodes.find(n=>matches(n,s)),querySelectorAll:s=>nodes.filter(n=>matches(n,s)),
};
const ctx={room:{game:'chess',instanceId:'one',hostId:'p00000001',players:[{id:'p00000001',name:'Host',connected:true},{id:'p00000002',name:'<img onerror=bad>',connected:true},{id:'p00000003',name:'Watcher',connected:true}],participants:[{id:'p00000001',connected:true},{id:'p00000002',connected:true}]},you:'p00000001',document,ws:{readyState:1},esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),isHost:()=>ctx.room.hostId===ctx.you,send:m=>sent.push(m),toast:m=>toasts.push(m),setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
ctx.lastState=null;
vm.createContext(ctx);vm.runInContext(code+'\nglobalThis.qa={renderRoomMembers,roomKickResult};',ctx);
const button=s=>el.querySelector(s),render=ctx.qa.renderRoomMembers;
render();assert(!button('[data-kick="p00000001"]'),'Host cannot remove own seat');assert(!html.includes('<img'),'Untrusted player name remains escaped');
button('[data-kick="p00000002"]').click();assert(html.includes('Current match will end.'),'Active stable-order removal explains match end inline');
ctx.lastState={instanceId:'one',phase:'done'};render();assert(html.includes('The room will return to the lobby.')&&!html.includes('Current match will end.'),'Finished-match removal explains the lobby transition');
ctx.lastState={instanceId:'retired',phase:'done'};render();assert(html.includes('Current match will end.'),'Retired results cannot hide a current live-match warning');ctx.lastState=null;render();
const confirm=button('[data-kick-confirm]');assert.equal(document.activeElement,confirm,'Inline confirmation receives keyboard focus');
const before=writes;render();assert.equal(writes,before,'Identical snapshot preserves confirmation node');assert.equal(button('[data-kick-confirm]'),confirm);
button('[data-kick-cancel]').click();assert.equal(sent.length,0,'Cancel sends no authority request');assert.equal(document.activeElement,button('[data-kick="p00000002"]'));
button('[data-kick="p00000003"]').click();assert(!html.includes('Current match will end.'),'Watcher removal does not misstate match end');button('[data-kick-confirm]').click();
assert.equal(JSON.stringify(sent),JSON.stringify([{t:'kick',pid:'p00000003',i:'one',requestId:'kick-1'}]),'Confirmed request includes target and exact instance');button('[data-kick-confirm]').click();assert.equal(sent.length,1,'Pending request deduplicates repeat input');
ctx.qa.roomKickResult({error:'Rejected',requestId:'kick-1'});assert.equal(timers.size,0,'Rejection clears retry watchdog');button('[data-kick-confirm]').click();assert.equal(sent.length,2,'Rejected request can retry explicitly');
assert.equal(ctx.qa.roomKickResult({pid:'p00000003',requestId:'kick-1'}),false,'Retired reply cannot dismiss newer removal');assert.equal(timers.size,1,'Retired reply preserves newer request watchdog');
ctx.room.instanceId='two';render();assert(!button('[data-kick-confirm]'),'Rematch retires old confirmation');assert.equal(timers.size,0,'Rematch retires old removal timeout');
ctx.room.game='pocket-karts';ctx.room.participants=[...ctx.room.players];button('[data-kick="p00000002"]').click();assert(!html.includes('Current match will end.'),'Three-driver karts can continue');
ctx.room.participants[2].connected=false;render();assert(html.includes('Current match will end.'),'Karts with one remaining connected driver warns about match end');
ctx.ws.readyState=3;render();assert(button('[data-kick="p00000002"]').disabled,'Offline host cannot start another removal');ctx.ws.readyState=1;
ctx.you='p00000003';render();assert.equal(html,'','Migrated/nonhost client has no removal controls');
assert(source.includes('id="roomMembers" class="room-members"'),'All game Room menus include shared moderation slot');
assert(source.includes('class="room-manage"'),'Lobby exposes collapsed management');
console.log('ROOM_KICK_UI_PASS: host/watcher/self gates, inline match warning, cancellation, exact instance, stable focus, duplicate/retry and rematch cleanup');
