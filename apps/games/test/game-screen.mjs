import assert from 'node:assert/strict';
import { createGameScreen } from '../public/js/toolkit/game-screen.mjs';

function fixture({ fullscreen = true, lock = true, shouldRotate = () => true } = {}) {
  const doc = new EventTarget();
  doc.fullscreenEnabled = fullscreen;
  doc.fullscreenElement = null;
  const calls = [], messages = [], paints = [];
  doc.documentElement = { async requestFullscreen() {
    calls.push('enter'); doc.fullscreenElement = this; doc.dispatchEvent(new Event('fullscreenchange'));
  } };
  doc.exitFullscreen = async () => { calls.push('exit'); doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); };
  const orientation = { unlock() { calls.push('unlock'); } };
  if (lock) orientation.lock = async value => { calls.push(value); };
  const controller = createGameScreen({ doc, orientation, isPortrait:()=>true, shouldRotate,
    beforeChange:()=>calls.push('neutral'), notify:v=>messages.push(v), paint:v=>paints.push(v) });
  return { controller, doc, orientation, calls, messages, paints };
}
// A narrow portrait laptop still enters full screen, without a phone
// rotation instruction or an orientation lock on its user's display.
for (const fullscreen of [true, false]) {
  const f = fixture({ fullscreen, shouldRotate: () => false });
  await f.controller.toggle();
  assert(!f.calls.includes('landscape'));
  assert(!f.messages.some(message => message.includes('phone')));
  assert.equal(f.controller.state().fullscreen, fullscreen);
  f.controller.dispose();
}
{
  const f=fixture(); await f.controller.toggle();
  assert(f.calls.indexOf('neutral') < f.calls.indexOf('enter'));
  assert(f.calls.indexOf('enter') < f.calls.indexOf('landscape'));
  assert.equal(f.controller.state().fullscreen,true); assert.equal(f.messages.length,0);
  const start=f.calls.length; await f.controller.toggle();
  assert.deepEqual(f.calls.slice(start),['neutral','unlock','exit','neutral']);
  assert.equal(f.controller.state().fullscreen,false); f.controller.dispose();
}
for (const fullscreen of [false,true]) {
  const f=fixture({fullscreen,lock:false}); await f.controller.toggle();
  assert.equal(f.messages.length,1,'unsupported lock has a useful manual rotation fallback');
  f.controller.dispose(); assert.equal(f.calls.includes('unlock'),false);
}
{
  const f=fixture(); f.orientation.lock=async()=>{throw new Error('not supported');};
  await f.controller.toggle(); assert.equal(f.messages.length,1); assert.equal(f.controller.state().busy,false);
  f.controller.dispose(); assert(f.calls.includes('exit'));
}
{
  const f=fixture(); f.doc.documentElement.requestFullscreen=async()=>{throw new Error('denied');};
  await f.controller.toggle(); assert.equal(f.messages.length,1); assert(!f.calls.includes('landscape'));
  f.controller.dispose();
}
{
  const f=fixture(); await f.controller.toggle();
  f.doc.fullscreenElement=null; f.doc.dispatchEvent(new Event('fullscreenchange'));
  assert(f.calls.includes('unlock'),'system exit releases acquired orientation');
  assert.equal(f.controller.state().fullscreen,false); f.controller.dispose();
}
{
  const f=fixture(); const foreign={}; f.doc.fullscreenElement=foreign;
  await f.controller.toggle(); f.controller.dispose();
  assert.equal(f.doc.fullscreenElement,foreign); assert(!f.calls.includes('exit')); assert(!f.calls.includes('landscape'));
}
for (const delayed of ['enter','lock']) {
  const f=fixture(); let resolve;
  if(delayed==='enter') f.doc.documentElement.requestFullscreen=()=>new Promise(r=>{resolve=()=>{f.doc.fullscreenElement=f.doc.documentElement;r();};});
  else f.orientation.lock=()=>new Promise(r=>{resolve=r;});
  const pending=f.controller.toggle();
  if(delayed==='lock') await Promise.resolve();
  await f.controller.toggle(); assert.equal(f.calls.filter(c=>c==='enter').length,delayed==='enter'?0:1,'double tap cannot start a second request');
  f.controller.dispose(); resolve(); await pending;
  assert.equal(f.doc.fullscreenElement,null,'leaving the game during a pending request unwinds the late screen result');
  if(delayed==='lock') assert(f.calls.includes('unlock'));
}
console.log('GAME_SCREEN_PASS: gesture order, failure fallback, system exit, foreign ownership, double tap, late request cleanup');
