
'use strict';
// Run the original full-suite commands after a stopped command, preserving
// all arguments and recording each exit. A separate npm test must also pass.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../../artifacts/kart-arenas'),pkg=require('../package.json');
function expand(s){return s.replace(/npm run ([\w:-]+)/g,(_,key)=>expand(pkg.scripts[key]||''));}
const commands=expand(pkg.scripts.test).split('&&').map(s=>s.trim()),start=commands.indexOf(process.env.ARENA_AFTER||'node test/pocket-karts-release.js'),reports=[];
if(start<0)throw new Error('Unknown starting command');
for(const cmd of commands.slice(start)){
 const at=Date.now(),r=cp.spawnSync(cmd,{shell:true,cwd:ROOT,env:process.env,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024});
 reports.push({cmd,status:r.status,ms:Date.now()-at,output:(r.stdout||'')+(r.stderr||''),...(r.error?{error:r.error.message}:{})});
 fs.writeFileSync(path.join(OUT,'continued-suite-results.json'),JSON.stringify({scope:'Individual full-suite commands from '+commands[start]+'. This does not replace a successful npm test.',reports},null,2));
 console.log(r.status===0?'PASS':'FAIL',cmd,Date.now()-at+'ms');
}
const failures=reports.filter(r=>r.status!==0);console.log(JSON.stringify({commands:reports.length,failures:failures.map(r=>({cmd:r.cmd,output:r.output.slice(-2000)}))}));if(failures.length)process.exitCode=1;
