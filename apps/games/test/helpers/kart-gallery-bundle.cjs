'use strict';
// Instrument source before using the production bundler. The gallery keeps
// the shipped module graph, streamed physics and shared asset cache intact.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const esbuild=require('esbuild'),{options}=require('../../scripts/build-kart-runtime');
async function installKartGalleryBundle(context,filename,transform){
 const transforms=typeof filename==='string'?{[filename]:transform}:filename;
 const result=await esbuild.build({...options(false),plugins:[{name:'declared-kart-gallery',setup(build){
  build.onLoad({filter:/(?:kart-(?:elevated-)?view|three-view)\.js$/},args=>{
   const name=path.basename(args.path),apply=transforms[name];if(!apply)return;
   const code=fs.readFileSync(args.path,'utf8'),contents=apply(code);
   assert.notEqual(code,contents,'Gallery instrumentation matched '+name);
   return {contents,loader:'js',resolveDir:path.dirname(args.path)};
  });
 }}]});
 const body=result.outputFiles.find(f=>f.path.endsWith('kart-runtime.mjs')).text;
 await context.route('**/js/engines/kart-runtime.mjs*',route=>route.fulfill({status:200,contentType:'text/javascript',body}));
}
function writeKartGalleryReport(file,report,merge=false){
 if(merge&&fs.existsSync(file)){
  const previous=JSON.parse(fs.readFileSync(file)),replaced=new Set(report.shots.map(s=>s.file));
  report.shots=[...previous.shots.filter(s=>!replaced.has(s.file)),...report.shots];
 }
 fs.writeFileSync(file,JSON.stringify(report,null,2));
}
const {galleryInventory}=require('../fixtures/kart-weapon-hud/inventory.mjs');
// Runs inside a gallery seat to inspect the actual, visible HUD text.
function readGalleryHud(selector){
 const el=document.querySelector(selector),r=el.getBoundingClientRect(),name=el.querySelector('strong'),copy=name.parentElement;
 const range=document.createRange();range.selectNodeContents(name);
 const label=range.getBoundingClientRect(),mounts=[];
 const fits=rect=>rect.left>=r.left-1&&rect.right<=r.right+1&&rect.top>=r.top-1&&rect.bottom<=r.bottom+1;
 const lines=[...el.querySelectorAll('strong, small, .kart-item-count')].filter(node=>node.textContent);
 const contentFits=lines.every(node=>{range.selectNodeContents(node);return fits(range.getBoundingClientRect());});
 const scene=globalThis.__kartWeaponScene||globalThis.__raisedWeaponScene;
 for(const kart of scene.children.filter(o=>o.name==='GiggleKart')){
  kart.traverseVisible(rig=>{
    const gear=rig.userData.combat;
    if(gear?.type!=='weapon')return;
    let meshes=0,triangles=0;
    rig.traverseVisible(part=>{if(part.isMesh){meshes++;triangles+=(part.geometry.index?.count??part.geometry.attributes.position.count)/3;}});
    mounts.push({kind:gear.kind,meshes,triangles,authored:!!rig.getObjectByName('Gear_'+gear.kind)});
  });
 }
 return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,
  mounts,contentFits,state:el.dataset.state,label:name.textContent,count:el.querySelector('.kart-item-count').textContent,aria:el.getAttribute('aria-label'),
  visibleLabel:getComputedStyle(copy).clipPath==='none'&&label.width>0&&label.height>0&&fits(label),
  thumbnail:el.querySelector('img')?.naturalWidth===96,scroll:document.documentElement.scrollWidth>innerWidth};
}
function assertGalleryHud(shot,display){
 const r=shot.layout,context=shot.file;
 assert(!r.scroll&&r.x>=0&&r.y>=0&&r.y+r.height<=r.viewportHeight+1,context+' fits its viewport');
 assert(r.width>0&&r.width<=202&&r.height>0&&r.height<=62&&r.x+r.width<r.viewportWidth*.5,context+' keeps the left dock clear of the driving line');
 assert(r.visibleLabel&&r.label===display.label&&r.aria.startsWith(r.label),context+' shows a readable, named loadout');
 assert(r.contentFits,context+' keeps the title, status and count inside the card');
 assert.equal(r.state,display.state,context+' shows the accepted inventory state');
 assert.equal(r.count,display.count,context+' shows remaining ammo or active time');
 if(display.kind!=='crate')assert(r.thumbnail,context+' shows the loaded weapon image');
 if(!shot.fire)assert(r.mounts.some(m=>m.kind===shot.kind&&m.authored&&m.triangles>0),context+' displays the authored mount on a kart');

}
module.exports={installKartGalleryBundle,writeKartGalleryReport,readGalleryHud,assertGalleryHud,galleryInventory};
