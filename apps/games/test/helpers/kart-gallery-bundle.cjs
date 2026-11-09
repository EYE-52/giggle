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
module.exports={installKartGalleryBundle,writeKartGalleryReport};
