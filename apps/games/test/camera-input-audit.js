'use strict';
// Exercise the actual camera toolkit event callbacks with controlled state/time.
// No camera capture, physical pointer or production account is involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeDocument, surface } = require('./party-mobile');
const doc = makeDocument(), el = surface(doc), sent = [];
const source = fs.readFileSync(require.resolve('../public/js/toolkit/camera-party.js'), 'utf8');
const util = fs.readFileSync(require.resolve('../public/js/util.js'), 'utf8').replace(/^export /gm, '');
// Install DOM event support on queried nodes in the established minimal fixture.
const query = el.querySelector;
el.querySelector = selector => {
  const node = query(selector);
  if (node && !node.addEventListener) {
    node.listeners = new Map();
    node.addEventListener = (event, fn) => node.listeners.set(event, fn);
    node.removeEventListener = (event, fn) => { if(node.listeners.get(event) === fn)node.listeners.delete(event); };
  }
  return node;
};
const context = vm.createContext({document:doc, console, Date, setInterval:()=>1, clearInterval:()=>{}, window:undefined});
vm.runInContext(util + '\n' + source.replace(/^import[^;]+;\s*/m, '').replace(/^export /gm, '') + '\nthis.create = build; this.vote = castVote; this.clock = paintClock; this.dispose = disposeCameraParty;', context);
const api = {now:()=>1000,send:a=>sent.push(a)};
const d = context.create(el, api);
const state = {phase:'perform',round:1,instanceId:'one',you:'a',hostId:'a',actor:'a',mode:'spotlight',endsAt:2000,ready:{},myVotes:{},candidates:['b']};
const ready = d.refs.ready.listeners.get('click'), next = d.refs.next.listeners.get('click');
d.state = {...state,preparing:true}; context.clock(d); assert.equal(d.refs.clock.hidden,true,'preparing camera game has no countdown'); ready(); assert.equal(sent.length,0,'ready cannot send while preparing');
d.state = state; context.clock(d); assert.equal(d.refs.clock.hidden,false,'released camera clock is visible'); assert.equal(d.refs.clock.textContent,'1s'); d.refs.ready.disabled=false; ready(); assert.equal(sent.length,1,'released performer may ready');
d.state = {...state,actor:'b'}; ready(); assert.equal(sent.length,1,'waiting viewer cannot ready another actor');
d.state = {...state,endsAt:1000}; ready(); assert.equal(sent.length,1,'ready at deadline is ignored');
d.state = {...state,phase:'vote',preparing:true}; context.vote(d,true); assert.equal(sent.length,1,'ballot cannot send while preparing');
d.state = {...state,phase:'vote'}; context.vote(d,true); assert.equal(sent.length,2,'released legal ballot sends');
d.state = {...state,phase:'vote',myVotes:{b:true}}; context.vote(d,false); assert.equal(sent.length,2,'acknowledged ballot cannot send again');
d.state = {...state,phase:'reveal',you:'b'}; next(); assert.equal(sent.length,2,'nonhost next ignored');
d.state = {...state,phase:'reveal'}; d.refs.next.disabled=false; next(); assert.equal(sent.length,3,'host may advance reveal');
context.dispose(el); ready(); next(); assert.equal(sent.length,3,'disposed callbacks cannot submit into rematch');
console.log('CAMERA_INPUT_AUDIT_PASS: 10 production callback checks for preparation, performer eligibility, deadlines, ballots, host advance and disposal');

// Actual shipping wrapper rendering, not a generated-markup expectation.
for (const game of ['show-and-go','pose-party']) {
  const doc = makeDocument(), el = surface(doc);
  const query = el.querySelector;
  el.querySelector = selector => {
    const node = query(selector);
    if (node && !node.addEventListener) {
      node.addEventListener = () => {};
      node.removeEventListener = () => {};
    }
    if (node && !node.replaceChildren) node.replaceChildren = (...children) => { node.children = []; for (const child of children) node.appendChild(child); };
    return node;
  };
  const createElement = doc.createElement;
  doc.createElement = tag => { const node = createElement(tag); node.append = (...children) => children.forEach(child => node.appendChild(child)); return node; };
  const wrapper = fs.readFileSync(require.resolve(`../public/js/games/${game}.js`),'utf8');
  const context = vm.createContext({document:doc,console,Date,setInterval:()=>1,clearInterval:()=>{},window:undefined});
  vm.runInContext(util + '\n' + source.replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'') + '\n' + wrapper.replace(/^import[^;]+;\s*/gm,'').replace('export default','this.view ='),context);
  const api = {now:()=>1000,send:()=>true};
  const state = {phase:'done',round:1,rounds:1,instanceId:'final',you:'a',hostId:'a',mode:game==='pose-party'?'spotlight':'gallery',players:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],scores:{a:0,b:0},ready:{},myVotes:{},candidates:[]};
  function visibleLabels() {
    let count=0;
    function visit(node,hidden) {
      hidden=hidden || node.hidden;
      if(!hidden && node.nodeType===3 && node.textContent.trim()==='Final scores')count++;
      for(const child of node.children || [])visit(child,hidden);
    }
    visit(el,false);
    return count;
  }
  for(const you of ['a','watcher']) {
    context.view.render(el,{...state,you},api);
    assert.equal(visibleLabels(),1,`${game} ${you}: one visible final label`);
    const phase=el.querySelector('.cp-phase');
    assert.equal(el.querySelector('.cp-round').textContent,'1 round played');
    context.view.render(el,{...state,you},api);
    assert.equal(visibleLabels(),1,`${game}: reconnect retains single label`);
    context.view.render(el,{...state,you,phase:'perform',instanceId:'rematch',actor:'a',endsAt:2000},api);
    assert.equal(el.querySelector('.cp-phase'),phase,'incremental phase node retained');
    assert.equal(phase.hidden,false,'rematch restores phase badge');
    assert.equal(phase.textContent,'Showtime');
  }
  context.view.dispose(el);
}
console.log('CAMERA_FINAL_LABEL_PASS: both wrappers, host/watcher, reconnect and rematch');
