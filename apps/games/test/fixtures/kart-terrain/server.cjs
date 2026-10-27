'use strict';
// Development-only asset/material inspection. This renderer uses the shipped
// terrain loader/world/vendor modules; it has no simulation or Room state.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const publicRoot=path.resolve(__dirname,'../../../public');const fixtureRoot=__dirname;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.webp':'image/webp','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png'};
let failTextures=false;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/qa/fault'&&req.method==='POST'){failTextures=url.searchParams.get('enabled')==='1';res.writeHead(200,{'Content-Type':'text/plain'});return res.end(failTextures?'Texture transport failure armed':'Texture transport restored');}
  // A fresh path per load forces ImageLoader to exercise transport instead of
  // reusing Chrome's decoded image cache. All paths serve the same real files.
  const asset=url.pathname.match(/^\/qa-terrain\/\d+\/([^/]+\.webp)$/);
  if(failTextures&&(asset||url.pathname.startsWith('/assets/karts/terrain/'))){res.writeHead(503,{'Cache-Control':'no-store'});return res.end('Deliberate development texture fault');}
  const root=!asset&&(url.pathname==='/'||url.pathname.startsWith('/qa/'))?fixtureRoot:publicRoot;
  const requested=asset?'/assets/karts/terrain/'+asset[1]:url.pathname==='/'?'/index.html':url.pathname.startsWith('/qa/')?url.pathname.slice(3):url.pathname;
  let file=path.resolve(root,'.'+requested);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('not found');}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.QA_PORT||8467),'127.0.0.1',()=>console.log('KART_TERRAIN_QA http://localhost:'+server.address().port));
process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
