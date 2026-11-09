'use strict';
// Repeatable art review with production world, lighting, GLBs and structures.
// Camera controls belong only to this review fixture, never the shipping view.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const PAGE=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#183749}canvas{display:block}#label{position:absolute;top:16px;left:20px;color:white;font:700 20px sans-serif;text-shadow:0 2px 3px #123}</style><div id="label"></div><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/"}}</script><script type="module">
import * as THREE from '/vendor/three/three.module.js';
import {createKartWorld} from '/js/engines/kart-world.mjs';
import {createKartLighting} from '/js/engines/kart-lighting.mjs';
import {loadKartAssets} from '/js/engines/kart-assets.mjs';
import {createKartModel} from '/js/engines/kart-model.mjs';
import {createKartArenaStructures} from '/js/engines/kart-arena-structure-art.mjs';
import {createKartArenaFeatures} from '/js/engines/kart-arena-features-art.mjs';
const q=new URLSearchParams(location.search),id=q.get('map')||'ring',palette=q.get('night')==='1'?'Starlight':'Daybreak';
const map=await fetch('/qa/map/'+id).then(r=>r.json()),scene=new THREE.Scene();
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const assets=await loadKartAssets(THREE,scene),world=createKartWorld(THREE,{scene,map,assets,palette});world.syncMap(map);
const structures=createKartArenaStructures(THREE,scene,{groundAt:world.groundAt});structures.sync(map);
const features=createKartArenaFeatures(THREE,scene,{groundAt:world.groundAt});features.sync(map);
const lighting=createKartLighting(THREE,renderer,scene,world.palette,{half:map.half});await lighting.ready;
const kart=createKartModel(THREE,{assets,color:0xf45367});kart.userData.kart.inner.position.y=-.7;scene.add(kart);
// Pickup art is from the shipping crate template, using the exact socket pool.
for(const [x,z]of map.spots){const c=assets.crate.clone(true);c.scale.setScalar(.65);c.position.set(x,world.groundAt(x,z)+.7,z);scene.add(c);}
let camera;window.view=(kind,x,z,angle=0)=>{if(kind==='top'){const h=map.half+4;camera=new THREE.OrthographicCamera(-h*innerWidth/innerHeight,h*innerWidth/innerHeight,h,-h,.1,600);camera.position.set(0,180,.01);camera.lookAt(0,0,0);kart.visible=false;}
else{camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.1,600);const y=world.groundAt(x,z);kart.visible=true;kart.position.set(x,y+.75,z);kart.rotation.y=angle;const cx=x-Math.sin(angle)*8.8,cz=z-Math.cos(angle)*8.8,lx=x+Math.sin(angle)*5,lz=z+Math.cos(angle)*5;camera.position.set(cx,Math.max(y+3.2,world.groundAt(cx,cz)+1.2),cz);camera.lookAt(lx,Math.max(y+1.6,world.groundAt(lx,lz)+.8),lz);}
window.camera=camera;};
window.view(q.get('view')||'top',0,-18);window.label=kind=>document.querySelector('#label').textContent=map.label+' · '+palette+' · '+kind;window.label(q.get('view')||'top');
let frames=0;function tick(t){world.animate(1/60,t/1000,null);features.animate(1/60,t/1000,{karts:[]},new Map());lighting.update(world.palette);renderer.render(scene,camera);frames++;requestAnimationFrame(tick);}requestAnimationFrame(tick);
window.qa={map,world,renderer,scene,features,structures,get frames(){return frames}};window.ready=true;
</script>`;
async function run(){
 const out=process.env.MAP_REVIEW_OUT||path.join(ROOT,'../../artifacts/kart-maps/after');fs.mkdirSync(out,{recursive:true});
 const defs=process.env.MAP_REVIEW_BEFORE?JSON.parse(fs.readFileSync(process.env.MAP_REVIEW_BEFORE)):require('../games/engines/kart-maps').MAPS;
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(PAGE);}if(u.pathname.startsWith('/qa/map/')){const id=u.pathname.split('/').pop();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id,...defs[id]}));}const file=path.resolve(ROOT,'public','.'+u.pathname);if(!file.startsWith(path.join(ROOT,'public')+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
 let browser;const errors=[],report=[];
 try{await new Promise(r=>server.listen(8310,'127.0.0.1',r));const {chromium}=require('playwright');browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:process.env.MAP_REVIEW_SOFTWARE?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
 const chase={ring:[0,-20,0],blocks:[-20,-7,Math.PI/2],garden:[0,-23,0],frost:[-27,0,Math.PI/2],neon:[0,-25,0]};
 for(const id of Object.keys(defs))for(const night of [0,1]){const context=await browser.newContext({viewport:{width:1280,height:800},recordVideo:process.env.MAP_REVIEW_VIDEO?{dir:out,size:{width:1280,height:800}}:undefined});const page=await context.newPage();page.on('pageerror',e=>{errors.push(id+': '+e.message);console.error(e.message)});page.on('console',m=>{if(m.type()==='error')console.error(m.text())});await page.goto('http://127.0.0.1:8310/?map='+id+'&night='+night);await page.waitForFunction(()=>window.ready,{},{timeout:90000});await page.waitForTimeout(500);await page.screenshot({path:path.join(out,id+'-'+(night?'night':'day')+'-top.png')});await page.evaluate(([x,z,a])=>(window.view('chase',x,z,a),window.label('chase')),chase[id]);await page.waitForTimeout(500);await page.screenshot({path:path.join(out,id+'-'+(night?'night':'day')+'-chase.png')});report.push(await page.evaluate(()=>({id:qa.map.id,palette:qa.world.palette.name,world:qa.world.stats(),render:{calls:qa.renderer.info.render.calls,triangles:qa.renderer.info.render.triangles}})));await context.close();console.log(id,night?'night':'day');}
 fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({errors,report},null,2));if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify(report));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
