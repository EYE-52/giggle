/* Development-only transparent proxy for native responsive acceptance.
 * The iframe runs the real app and real Room WS protocol; no game state,
 * pose, grants or actions are injected. A companion joins as a neutral seat.
 */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {WebSocket,WebSocketServer}=require('ws');
const port=Number(process.env.QA_PORT||8463),upstream=Number(process.env.QA_APP_PORT||8461);
const peers=new Set(),companions=new Set(),ledger=[];let lastRoom='';
function note(direction,data){try{const m=JSON.parse(data);if(m.t==='hello')lastRoom=m.code;
  if(m.t==='action'||m.t==='hello'||m.t==='error')ledger.push({at:Date.now(),direction,message:m});
  if(m.t==='state')ledger.push({at:Date.now(),direction,state:{instanceId:m.instanceId,profile:m.profile,phase:m.phase,you:m.you,inputAck:m.inputAck,karts:m.karts?.map(k=>({id:k.id,alive:k.alive,spawnSeq:k.spawnSeq,controlEpoch:k.controlEpoch,position:k.pose?.position,speed:k.pose?.speed}))}});
  if(ledger.length>2400)ledger.splice(0,ledger.length-2400);
}catch{}}
const server=http.createServer((req,res)=>{
  if(req.url==='/__qa'){res.writeHead(200,{'Content-Type':'text/html'});return fs.createReadStream(path.join(__dirname,'wrapper.html')).pipe(res);}
  if(req.url==='/__qa/evidence'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({upstream,lastRoom,ledger}));}
  if(req.url==='/__qa/leave-companions'&&req.method==='POST'){for(const ws of companions)ws.close();res.writeHead(200);return res.end('Neutral witnesses disconnected using their real sockets.');}
  if(req.url==='/__qa/companion'&&req.method==='POST'){
    if(!lastRoom){res.writeHead(409);return res.end('Create a room in the app first.');}
    const ws=new WebSocket('ws://127.0.0.1:'+upstream);companions.add(ws);ws.on('open',()=>ws.send(JSON.stringify({t:'join',code:lastRoom,name:'QA neutral witness'})));
    ws.on('message',data=>{let m;try{m=JSON.parse(data);}catch{return;}if(m.t==='hello'){res.writeHead(200);res.end('Neutral witness joined '+m.code);}});
    ws.on('error',()=>{if(!res.writableEnded){res.writeHead(502);res.end('Companion connection failed');}});ws.on('close',()=>companions.delete(ws));return;
  }
  const proxy=http.request({hostname:'127.0.0.1',port:upstream,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  proxy.on('error',()=>{res.writeHead(502);res.end('Real app unavailable');});req.pipe(proxy);
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>wss.handleUpgrade(req,socket,head,client=>{
  const remote=new WebSocket('ws://127.0.0.1:'+upstream, {headers:{Host:req.headers.host,Origin:req.headers.origin||'http://localhost:'+port}});const queued=[];peers.add(client);peers.add(remote);
  client.on('message',data=>{note('browser→server',data);if(remote.readyState===WebSocket.OPEN)remote.send(data,{binary:false});else queued.push(data);});
  remote.on('open',()=>{for(const data of queued)remote.send(data,{binary:false});});remote.on('message',data=>{note('server→browser',data);if(client.readyState===WebSocket.OPEN)client.send(data,{binary:false});});
  for(const[a,b]of[[client,remote],[remote,client]]){a.on('close',()=>{peers.delete(a);b.close();});a.on('error',()=>b.close());}
}));
server.listen(port,'127.0.0.1',()=>console.log(`PRODUCTION_KART_QA http://localhost:${port}/__qa → actual ${upstream}`));
function dispose(){for(const ws of [...peers,...companions])ws.close();wss.close();server.close();}
process.on('SIGINT',dispose);process.on('SIGTERM',dispose);
