const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const publicRoot=path.resolve(__dirname,'../../../public');
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wav':'audio/wav','.json':'application/json'};
http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=pathname==='/'?path.join(__dirname,'index.html'):path.resolve(publicRoot,'.'+pathname);
  if(pathname!=='/'&&!file.startsWith(publicRoot+path.sep)){res.writeHead(403);res.end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT)||8481,'127.0.0.1',()=>console.log('Native audio fixture: http://127.0.0.1:'+(process.env.PORT||8481)));
