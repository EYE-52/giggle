'use strict';
// Development-only, loopback-only HUD fixture. No game/server integration.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const fixture=__dirname,publicRoot=path.resolve(fixture,'../../../public');
const {config}=require('../../../games/engines/kart-combat-config.js');
const mime={'.html':'text/html; charset=utf-8','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);}catch{response.writeHead(400).end();return;}
  if(pathname==='/inventory.json'){
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify(Object.fromEntries(Object.entries(config.weapons).map(([kind,rule])=>[kind,rule.ammo||1]))));return;
  }
  const local=pathname==='/'?'index.html':pathname==='/frame'?'frame.html':pathname==='/frame.mjs'?'frame.mjs':null;
  const file=local?path.join(fixture,local):path.resolve(publicRoot,'.'+pathname);
  if((!local&&!file.startsWith(publicRoot+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    response.writeHead(404).end();return;
  }
  response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  if(request.method==='HEAD'){response.end();return;}
  fs.createReadStream(file).pipe(response);
});
server.listen(8801,'127.0.0.1',()=>console.log('HUD-only review http://127.0.0.1:8801 · PID '+process.pid));
