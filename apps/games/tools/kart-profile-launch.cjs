'use strict';
// Repeat the existing production browser path, one task-owned server at a time.
const cp=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../../artifacts/kart-arenas');
for(const [name,count,dir]of[['Skyport Split',32,'skyport-32'],['Garden Crown',16,'garden-16'],['Frostbite Crescent',16,'frost-16'],['Neon Switchyard',24,'neon-24'],['Harbor Fork',32,'harbor-32'],['Foundry Wheel',32,'foundry-32']]){
 const r=cp.spawnSync(process.execPath,['test/kart-launch-browser.cjs'],{cwd:root,env:{...process.env,KART32_MAP:name,KART32_DRIVERS:String(count),KART32_OUT:path.join(out,dir),KART32_PORT:'8356'},stdio:'inherit',timeout:180000});if(r.status!==0)throw new Error(name+' browser failed: '+r.status);
}
