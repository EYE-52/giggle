'use strict';
// Portable renderer contract. Real SVG bounds/hit tests live in ludo-shared-browser.cjs.
const assert=require('node:assert/strict'),{rig}=require('./ludo-fleet-view');
let checks=0;
const coords=n=>n.getAttribute('transform').match(/translate\(([-.\d]+) ([-.\d]+)\)/).slice(1).map(Number);
function boxes(r,ids){return ids.map(id=>{const n=r.el.querySelector('#'+id),glyph=n.children[0].children.at(-1),scale=Number(glyph.getAttribute('transform').match(/scale\(([^)]+)\)/)[1]),[x,y]=coords(n),motion=n.querySelector('animateMotion');let mx=0,my=0;if(motion){const points=[...motion.getAttribute('path').matchAll(/[ML]([-.\d]+) ([-.\d]+)/g)];[mx,my]=points.at(-1).slice(1).map(Number);}
const legal=n.classList.contains('is-legal'),extent=legal?[-23.5,-33,24,30.5]:[-15,-22,24,27];if(legal){assert.equal(n.children[0].children[0].getAttribute('pointer-events'),'none','legal decoration cannot intercept adjacent pawn');checks++;}
return{id,left:x+mx+extent[0]*scale,top:y+my+extent[1]*scale,right:x+mx+extent[2]*scale,bottom:y+my+extent[3]*scale};});}
function separate(rows,label){for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];assert(a.right<b.left||b.right<a.left||a.bottom<b.top||b.bottom<a.top,label+' '+a.id+'/'+b.id);checks++;}}
for(const count of [2,4,8,16]){const r=rig('ludo'),s={...r.state,seats:['a','b','c','d'],lanes:[0,1,2,3],phase:'move',die:1,pawns:Array.from({length:4},()=>[-1,-1,-1,-1])},ids=[];let n=0;for(let pawn=0;pawn<4;pawn++)for(let side=0;side<4;side++)if(n++<count){s.pawns[side][pawn]=(13-side*13+52)%52;ids.push('ld-pawn-'+side+'-'+pawn);}r.setState(s);r.render();separate(boxes(r,ids),'shared glyph/decorative extents');
const button=r.el.querySelector('[data-choice="0"]');assert.equal(button.getAttribute('aria-disabled'),'false');button.focus();button.dispatch('keydown',{key:'ArrowRight'});assert.equal(r.document.activeElement.getAttribute('data-choice'),'1');checks+=2;
r.el.querySelector('#ld-pawn-0-0').dispatch('click');assert.equal(r.sent.length,1);assert.equal(r.sent[0].move,0);checks+=2;r.action(r.sent[0]);r.render();const mover=r.el.querySelector('#ld-pawn-0-0'),path=mover.querySelector('animateMotion').getAttribute('path'),last=[...path.matchAll(/[ML]([-.\d]+) ([-.\d]+)/g)].at(-1).slice(1).map(Number);assert.deepEqual(last,[0,0],'frozen SVG motion ends at placed grouped destination');checks++;r.advance(550);separate(boxes(r,ids),'after active pawn leaves');r.view.dispose(r.el);}
{
 // Exact natural Gold/Jade safe landing, expressed as a declared renderer unit.
 const r=rig('ludo'),s={...r.state,seats:['a','b','c','d'],lanes:[0,1,2,3],pawns:[[-1,-1,-1,-1],[24,0,-1,-1],[-1,-1,-1,-1],[25,-1,-1,-1]],phase:'move',turn:3,die:1,rev:53};r.setState(s);r.render('d');r.action({move:0},'d');r.render('d');assert.deepEqual(s.lastMove.captured,[]);assert.equal(s.pawns[1][1],0);checks+=2;r.advance(550);separate(boxes(r,['ld-pawn-1-1','ld-pawn-3-0']),'actual public landing');r.view.dispose(r.el);
}
console.log('LUDO_SHARED_PAWNS_PASS: '+checks+' portable renderer/authority assertions; browser geometry remains separately scoped');
