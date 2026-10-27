'use strict';
// Actual fixture WS lifecycle regression. Native painting is a separate gate.
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createServer } = require('./skill-scenes-hud-browser');
const ids = ['word-chain','typing-race','reaction-tap','charades','pose-party','show-and-go','countdown-word','scattergories','number-hunt','warm-words'];
async function run() {
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const sockets = [];
  try {
    for (const id of ids) {
      let ws, state; const acks = [];
      const until = async fn => { const end = Date.now()+5000; while (!fn()) { assert(Date.now()<end,'Timed out: '+id); await new Promise(resolve=>setImmediate(resolve)); } };
      async function connect(message) {
        ws = new WebSocket('ws://127.0.0.1:'+server.address().port+'/socket'); sockets.push(ws); state = null;
        ws.on('message',raw=>{const m=JSON.parse(raw);if(m.t==='state'){state=m;if(m.preparing)ws.send(JSON.stringify({t:'game-ready',i:m.instanceId,w:m.w}));}if(m.t==='qa-error')acks.push({error:m.error});if(m.t==='qa-ack')acks.push(m);});
        await new Promise(resolve=>ws.once('open',resolve));ws.send(JSON.stringify(message));
        await until(()=>state&&!state.preparing&&(id!=='reaction-tap'||message.t==='resume'||state.phase==='go'));
      }
      async function command(command) {const n=acks.length;ws.send(JSON.stringify({t:'match-command',command}));await until(()=>acks.length>n&&!state.preparing);assert(!acks.at(-1).error,acks.at(-1).error);return acks.at(-1);}
      await connect({t:'prepare',id});const original=state.instanceId;
      const action=id==='countdown-word'?{word:'late',lock:true}:id==='scattergories'?{answers:state.categories.map(()=>state.letter+'omething'),lock:true}:id==='number-hunt'?{guess:(await command('solution')).word}:id==='warm-words'?{guess:(await command('solution')).word}:id==='word-chain'?{word:state.current==='apple'?'fruit':'apple'}:id==='typing-race'?{typed:state.target}:id==='reaction-tap'?{tap:true}:id==='charades'?{guess:(await command('solution')).word}:{ready:true};
      const n=acks.length;ws.send(JSON.stringify({t:'action',i:state.instanceId,w:state.w,a:action}));await until(()=>acks.length>n);assert(acks.at(-1).changed,id+' legal action accepted');
      await command('others');if(id==='pose-party'||id==='show-and-go'){await command('deadline');await command('others');}
      for(let i=0;i<12&&state.phase!=='done';i++)await command('deadline');assert.equal(state.phase,'done');
      const scores=JSON.stringify(state.scores);await command('spectator');assert(state.spectator);assert.equal(JSON.stringify(state.scores),scores);await command('participant');assert(!state.spectator);
      const key=(await command('retain')).key;await new Promise(resolve=>{ws.once('close',resolve);ws.close();});await connect({t:'resume',key});assert.equal(state.instanceId,original);assert.equal(JSON.stringify(state.scores),scores);
      await command('rematch');assert.notEqual(state.instanceId,original);assert(!state.preparing);ws.close();
      console.log('PASS '+id+' actual WS complete match, spectator, finished reconnect, ready rematch, stale rejection');
    }
  } finally {for(const socket of sockets)socket.close();await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
