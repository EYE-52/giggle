'use strict';
// Native-browser CSS regression. Shipping telemetry markup/fonts/styles in
// five iframe viewports; no GPU or synthetic gameplay is needed for layout.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public');
const source=fs.readFileSync(path.join(root,'js/engines/kart-view.js'),'utf8');
const readout=source.slice(source.indexOf('<div class="pk-readout"'),source.indexOf('<canvas id="pk-radar"'));
const sizes=[[1366,768],[320,640],[390,844],[568,320],[844,390]];
const frame=`<!doctype html><html><head><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/kart-arena.css"><style>html,body,#gbody{margin:0;padding:0}.pk{width:100%}</style></head><body class="game-immersive"><main id="gbody" data-layout="immersive"><div class="pk">${readout}</div></main></body></html>`;
const page=`<!doctype html><html><body><h1>Kart telemetry layout</h1><button id="run">Run desktop and phone checks</button><pre id="result" role="status">Ready</pre>${sizes.map(([w,h])=>`<iframe title="${w}x${h}" width="${w}" height="${h}" src="/frame"></iframe>`).join('')}<script>
document.querySelector('#run').onclick=async()=>{const report={pass:true,cases:[],checks:0};try{
 for(const frame of document.querySelectorAll('iframe')){const d=frame.contentDocument,w=frame.contentWindow;await d.fonts.ready;
  const pk=d.querySelector('.pk'),readout=d.querySelector('.pk-readout'),meter=d.querySelector('.pk-nitrometer'),label=d.querySelector('#pk-nitrolabel'),map=d.querySelector('#pk-map'),handling=d.querySelector('#pk-handling');
  const check=(ok,msg)=>{report.checks++;if(!ok)throw Error(frame.title+' '+msg);};
  const widths=[];for(const touch of [false,true]){pk.classList.toggle('pk-touch-enabled',touch);const stateWidths=[];
   for(const [name,status,nitro]of [['Neon Yard','Reversing','Nitro 100%'],['Garden Circuit','','Nitro 0%'],['A very long arena name beyond the telemetry width','Release for turbo!','Charging 100%'],['Rookie Ring','Nitro!','Nitro!']]){
    map.textContent=name;handling.textContent=status;handling.hidden=!status;label.textContent=nitro;
    const r=readout.getBoundingClientRect(),m=meter.getBoundingClientRect(),range=d.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();
    check(r.left>=0&&r.right<=w.innerWidth,'readout stays in viewport');check(readout.scrollWidth<=readout.clientWidth,'readout has no horizontal overflow');
    check(m.width>=88,'nitro reserves readable width');check(text.left>=m.left+1&&text.right<=m.right-1,'full nitro text fits pill');
    check(text.top>=m.top&&text.bottom<=m.bottom,'single-line nitro text fits pill height');check(range.getClientRects().length===1,'nitro text does not wrap');
    const help=d.querySelector('.pk-help summary').getBoundingClientRect();check(help.width>=44&&help.height>=44,'help keeps touch target');
    stateWidths.push(r.width);report.cases.push({viewport:frame.title,touch,name,status,nitro,width:r.width,meterWidth:m.width,textWidth:text.width});
   }check(Math.max(...stateWidths)-Math.min(...stateWidths)<.1,'labels do not resize readout');widths.push(stateWidths[0]);
  }
 }
}catch(e){report.pass=false;report.error=e.message;}document.querySelector('#result').textContent=JSON.stringify(report,null,2);await fetch('/result',{method:'POST',body:JSON.stringify(report)});};
</script></body></html>`;
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/result'){let raw='';for await(const chunk of req)raw+=chunk;const report=JSON.parse(raw);fs.writeFileSync('/tmp/kart-hud-layout.json',JSON.stringify(report,null,2));console.log(report.pass?'KART_HUD_LAYOUT_PASS '+report.checks+' checks':'KART_HUD_LAYOUT_FAIL '+report.error);return res.end('saved');}
 if(url.pathname==='/'||url.pathname==='/frame'){res.setHeader('Content-Type','text/html');return res.end(url.pathname==='/'?page:frame);}
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
server.listen(Number(process.env.PORT||8189),'127.0.0.1',()=>console.log('KART_HUD_QA http://127.0.0.1:'+(process.env.PORT||8189)));
