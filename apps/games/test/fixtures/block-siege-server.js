'use strict';
/* Focused native-CUA acceptance server: actual Room owns every mutation.
 * Fixture-only controls advance its configured clock or drive rival seats. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{WebSocketServer}=require('ws');
const {Room}=require('../../server/room'),castle=require('../../games/castle-clash/server'),{actionWindow}=require('../../games/_sdk');
const clockRules=require('../../games/engines/block-siege').createBlockSiege(castle.CASTLE_CONFIG);
const root=path.resolve(__dirname,'../../public'),rooms=new Map();
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');let file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/fixtures/castle-blocks.html':url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);res.end('Missing');}else{res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);}});});
const wss=new WebSocketServer({server});
function fake(){return{readyState:1,send(){},close(){this.readyState=3;}};}
function seed(room){const s=room.game.state,ctx=room.ctx();for(const c of s.castles){let n=0;for(const[x,z]of [[-2,0],[2,0],[0,-2],[0,2]]){for(let level=0;level<3;level++)castle.onAction(s,ctx,c.pid,{place:{card:'cube',x,y:.5+level,z,rotation:0,nonce:'seed-'+s.round+'-'+n++}});}for(const[x,z]of [[-1.5,-2],[1.5,-2],[-1.5,2],[1.5,2]])castle.onAction(s,ctx,c.pid,{place:{card:'beam',x,y:0,z,rotation:0,nonce:'beam-'+s.round+'-'+n++}});}room.broadcastState();}
function start(entry,built){const r=entry.room.startGame(castle,{settings:{buildSeconds:60,siegeSeconds:90,rounds:3}},entry.room.hostId);if(r.error)throw new Error(r.error);if(built)seed(entry.room);}
wss.on('connection',(ws,req)=>{const url=new URL(req.url,'http://localhost'),key=url.searchParams.get('room')||'castle',count=Math.max(2,Math.min(4,Number(url.searchParams.get('players'))||4)),seat=Math.max(0,Math.min(count-1,Number(url.searchParams.get('seat'))||0));let entry=rooms.get(key);if(!entry){const room=new Room(key,{'castle-clash':{}}),players=[];for(let i=0;i<count;i++)players.push(room.addPlayer(['Coral Keep','Mint Spire','Sunstone','Violet Vale'][i],fake()).player);entry={room,players};rooms.set(key,entry);start(entry,url.searchParams.get('scenario')!=='empty');}const room=entry.room,p=entry.players[seat];p.socket=ws;p.connected=true;
const originalSend=ws.send.bind(ws);ws.send=text=>{const o=JSON.parse(text);if(o.t==='state')o.host=room.hostId;originalSend(JSON.stringify(o));};room.broadcastState();
ws.on('message',data=>{let m;try{m=JSON.parse(data);}catch{return;}if(m.t==='action'){room.onAction(ws,m.a,{i:m.i,w:m.w});return;}if(m.t==='ready-all'){for(const q of entry.players.filter(q=>q.id!==p.id))room.onAction(q.socket,{ready:{value:true,nonce:'fixture-'+Date.now()+q.id}},{i:room.game.instanceId,w:actionWindow(room.game.state)});}
else if(m.t==='siege'){for(const q of entry.players)room.onAction(q.socket,{ready:{value:true,nonce:'fixture-'+Date.now()+q.id}},{i:room.game.instanceId,w:actionWindow(room.game.state)});}
else if(m.t==='finish'){const s=room.game.state;if(s.phase==='build'){for(const q of entry.players)room.onAction(q.socket,{ready:{value:true,nonce:'ready'+Date.now()+q.id}});}else if(s.phase==='siege'){s.endsAt=Date.now()-1;clockRules.advance(s,room.ctx());}room.broadcastState();}
else if(m.t==='rematch'||m.t==='reset')start(entry,m.t==='reset');else if(m.t==='leave') {room.endGameToLobby(room.hostId);originalSend(JSON.stringify({t:'lobby'}));}});
ws.on('close',()=>{if(p.socket===ws){p.socket=fake();p.connected=true;}});
});
server.listen(8177,'127.0.0.1',()=>process.stdout.write('Castle acceptance fixture at http://127.0.0.1:8177/fixtures/castle-blocks.html\n'));
