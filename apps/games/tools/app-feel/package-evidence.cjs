/* Compress task-owned recordings and retain readable paths in the reports.
 * Run after review/actions scripts have finished writing their videos. */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../../artifacts/app-feel');
fs.mkdirSync(path.join(root,'video'),{recursive:true});
for(const [file,name]of [['after/review.json','boards'],['after/review-4p.json','ludo-four-players'],['after/review-8p.json','eight-players'],['action-checks.json','actions'],['shell-checks.json','shared-shells'],['other-menu-checks.json','other-menus']]){
 const json=path.join(root,file),data=JSON.parse(fs.readFileSync(json));
 if(!data.pass)throw Error('Do not package a failed review: '+file);
 const source=path.resolve(root,data.video.endsWith('.mp4')?data.video:path.join('after',data.video)),target=path.join(root,'video',name+'.mp4');
 if(source!==target){const r=spawnSync('ffmpeg',['-y','-loglevel','error','-i',source,'-vf','fps=15','-c:v','libx264','-preset','fast','-crf','28','-pix_fmt','yuv420p','-movflags','+faststart',target],{stdio:'inherit'});if(r.status)throw Error('Video conversion failed: '+name);}
 data.video=path.relative(root,target);data.videoPathBase='artifacts/app-feel';fs.writeFileSync(json,JSON.stringify(data,null,2));
}
fs.rmSync(path.join(root,'after/video'),{recursive:true,force:true});
console.log('APP_FEEL_EVIDENCE_PACKAGED: six compressed videos; temporary raw recordings removed');
