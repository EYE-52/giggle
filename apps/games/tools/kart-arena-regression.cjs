'use strict';
// Continue the full npm chain after its first known baseline failure. Each
// remaining command keeps its original arguments and gets its own exit code.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../../artifacts/kart-arenas'),pkg=require('../package.json');
function expand(s){return s.replace(/npm run ([\w:-]+)/g,(_,key)=>expand(pkg.scripts[key]||''));}
const commands=expand(pkg.scripts.test).split('&&').map(s=>s.trim()),failed=commands.indexOf('node test/word-rules.js');
const reports=commands.slice(0,failed).map(cmd=>({cmd,status:0,evidence:'Passed before npm test stopped at word-rules.js'}));
for(const cmd of commands.slice(failed)){
 const at=Date.now(),result=cp.spawnSync(cmd,{shell:true,cwd:ROOT,env:{...process.env,NODE_PATH:'/private/tmp/codex-driving-browser/node_modules'},encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});
 reports.push({cmd,status:result.status,ms:Date.now()-at,output:(result.stdout||'')+(result.stderr||''),...(result.error?{error:result.error.message}:{})});
 fs.writeFileSync(path.join(OUT,'full-suite-results.json'),JSON.stringify({scope:'Full npm test prefix plus individually continued remaining commands; original npm test itself failed.',reports},null,2));
 console.log(result.status===0?'PASS':'FAIL',cmd,Date.now()-at+'ms');
}
const failures=reports.filter(r=>r.status!==0);console.log(JSON.stringify({commands:reports.length,failures:failures.map(r=>({cmd:r.cmd,output:r.output.slice(-2000)}))}));if(failures.length)process.exitCode=1;
