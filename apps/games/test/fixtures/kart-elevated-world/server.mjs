// Isolated development renderer/combat review. Never imported by production.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {WebSocketServer,WebSocket} from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../../../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../../../games/engines/kart-elevated-combat.js';
import {elevatedMap,elevatedMapIds} from '../../../public/js/engines/kart-elevated-maps.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const evidenceDir='/tmp/giggle-elevated-world-20261007';
await fs.mkdir(evidenceDir,{recursive:true});await RAPIER.init();
const epoch=Date.now(),origin=performance.now(),now=()=>epoch+performance.now()-origin;
const rooms=new Map(),controllers=new Map();let instance=0,retired=false;
const log=[];
function reset(id='garden',rematch=false){
  if(!elevatedMapIds.includes(id))throw new RangeError('unknown authored map');
  const options={instance:'review-'+id+'-'+(++instance),seed:42+instance,startAt:now(),countdownMs:3000,roundMs:120000,crates:6};
  const combat=rooms.get(id),next=rematch?combat.rematch(options):COMBAT.createElevatedCombat(RAPIER,CONFIG,elevatedMap(id),[{id:'driver',name:'Pippa'},{id:'rival',name:'Rowan'}],options);
  combat?.dispose();rooms.set(id,next);log.push({type:rematch?'rematch':'reset',mapId:id,instance:options.instance,at:options.startAt,retired:combat?.stats()||null});return next;
}
const room=id=>rooms.get(id)||reset(id);
const mime={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.glb':'model/gltf-binary','.wasm':'application/wasm','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
async function body(req){let text='';for await(const part of req){text+=part;if(text.length>2000000)throw new Error('bounded QA body exceeded');}return JSON.parse(text||'{}');}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(url.pathname==='/api/reset'&&req.method==='POST'){
      const value=await body(req),mapId=value.map||'garden',combat=reset(mapId,!!value.rematch);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({instance:combat.snapshot().instance,mapId}));return;
    }
    if(url.pathname==='/evidence'&&req.method==='POST'){
      const value=await body(req),name='evidence-'+Date.now()+'.json';await fs.writeFile(path.join(evidenceDir,name),JSON.stringify({...value,authorityLog:log.slice(-30),authorityStats:rooms.get(value.mapId)?.stats()||null},null,2));res.end(name);return;
    }
    if(url.pathname==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(room(url.searchParams.get('map')||'garden').snapshot(url.searchParams.get('seat')||'driver')));return;}
    const aliases={'/':'test/fixtures/kart-elevated-world/index.html','/scene':'test/fixtures/kart-elevated-world/scene.html'};
    const relative=aliases[url.pathname]||decodeURIComponent(url.pathname).slice(1),file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep))throw new Error('outside fixture root');
    const data=await fs.readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(data);
  }catch(error){res.statusCode=400;res.end(error.message);}
});
const websocket=new WebSocketServer({server,path:'/control',maxPayload:4096});
websocket.on('connection',(ws,req)=>{
  const url=new URL(req.url,'http://localhost'),seat=url.searchParams.get('seat')==='rival'?'rival':'driver',mapId=url.searchParams.get('map')||'garden';ws.seat=seat;ws.mapId=mapId;
  try{room(mapId);}catch(error){ws.close(1008,'unknown review map');return;}
  ws.controlKey=mapId+':'+seat;controllers.set(ws.controlKey,ws);room(mapId).setConnected(seat,false);room(mapId).setConnected(seat,true);
  ws.on('message',bytes=>{try{const message=JSON.parse(String(bytes));if(message.type==='input'&&controllers.get(ws.controlKey)===ws){const result=room(mapId).input(seat,message.value,now());if(!result.ok)ws.send(JSON.stringify({type:'rejected',result}));}}catch(error){ws.send(JSON.stringify({type:'error',message:error.message}));}});
  ws.send(JSON.stringify({type:'snapshot',value:room(mapId).snapshot(seat)}));
  ws.on('close',()=>{if(retired)return;if(controllers.get(ws.controlKey)===ws){controllers.delete(ws.controlKey);room(mapId).setConnected(seat,false);log.push({type:'socket-close',mapId,seat,at:now(),stats:room(mapId).stats()});}});
});
const pump=setInterval(()=>{if(retired)return;try{for(const combat of rooms.values())combat.advance(now());}catch(error){console.error(error);retired=true;}},1000/60);
const broadcast=setInterval(()=>{if(retired)return;for(const client of websocket.clients)if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify({type:'snapshot',value:room(client.mapId).snapshot(controllers.get(client.controlKey)===client?client.seat:null)}));},50);
server.listen(8455,'127.0.0.1',()=>console.log('Elevated world/combat review http://localhost:8455/ · isolated internal authority'));
function close(){retired=true;clearInterval(pump);clearInterval(broadcast);for(const combat of rooms.values())combat.dispose();console.log('Disposed review rooms',JSON.stringify([...rooms.values()].map(c=>c.stats())));for(const client of websocket.clients)client.terminate();websocket.close();server.close();}
process.on('SIGTERM',close);process.on('SIGINT',close);
