import assert from 'node:assert/strict';
import {readInputCapabilities,touchControlsFor} from '../public/js/toolkit/input-capabilities.mjs';
function device({fine=false,coarse=false,hover=false,points=0,any=coarse}={}){return readInputCapabilities({navigator:{maxTouchPoints:points},matchMedia:q=>({matches:{'(pointer: fine)':fine,'(pointer: coarse)':coarse,'(hover: hover)':hover,'(any-pointer: coarse)':any}[q]||false})});}
for(const width of [320,568,844,1280]){
 const mouse=device({fine:true,hover:true});assert.equal(mouse.supported.touch,false);assert.equal(touchControlsFor('auto',mouse),false,`${width}px mouse laptop remains keyboard`);assert.equal(mouse.supported.keyboard,true);
 const hybrid=device({fine:true,hover:true,points:10,any:true});assert.equal(hybrid.supported.touch,true);assert.equal(hybrid.preferred.touch,false,`${width}px touch laptop is not forced into touch mode`);
 const phone=device({coarse:true,points:5});assert.equal(phone.preferred.touch,true);assert.equal(phone.supported.keyboard,true,`${width}px phone can still use keyboard`);
 for(const caps of [mouse,hybrid,phone]){assert.equal(touchControlsFor('keyboard',caps),false);assert.equal(touchControlsFor('touch',caps),true);}
}
assert.equal(device({fine:true,coarse:true,hover:true}).preferred.touch,false,'hybrid fine/coarse with hover prefers keyboard');
assert.equal(device({fine:true,coarse:true,hover:false}).preferred.touch,true,'coarse without hover prefers touch');
assert.equal(device({fine:true,points:2}).preferred.touch,false,'stylus/fine primary does not imply touch preference');
assert.equal(readInputCapabilities({navigator:{},matchMedia:()=>{throw Error('unavailable');}}).preferred.touch,false,'missing media capability safely defaults keyboard');
assert.equal(touchControlsFor('garbage',device({coarse:true})),true,'unknown preference safely acts as Auto');
console.log('INPUT_CAPABILITIES_PASS: small/large mouse, hybrid, coarse phone, explicit controls overrides and safe fallback');
