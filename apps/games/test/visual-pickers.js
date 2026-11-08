'use strict';
// New player controls must opt into a visible picker. Internal fixtures and
// reports/admin tools are outside this gate; practice has its own picker shell.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../public');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?(['test','reports','fixtures','vendor','assets'].includes(d.name)?[]:files(path.join(dir,d.name))):/\.(html|js|mjs)$/.test(d.name)?[path.join(dir,d.name)]:[])}
function nativeControls(source){return [...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/<(select|input)\b[^>]*>/g)].map(m=>m[0]);}
function checkSelect(tag,file){assert(/\bhidden(?:\s|>)/.test(tag)&&/class="[^"]*\bpicker-native\b/.test(tag)&&/aria-hidden="true"/.test(tag)&&/tabindex="-1"/.test(tag),file+' has a select without a hidden picker backing field: '+tag);}
let selects=0,numbers=0;
for(const file of files(root)){
 if(file.endsWith('/js/practice.js')||file.endsWith('/practice/index.html'))continue;
 for(const tag of nativeControls(fs.readFileSync(file,'utf8'))){
  if(tag.startsWith('<select')){checkSelect(tag,path.relative(root,file));selects++;}
  if(/type="number"/.test(tag)){assert(/class="[^"]*\bpicker-value\b/.test(tag),file+' has a number without a visual stepper');numbers++;}
  if(/type="range"/.test(tag))assert(/class="[^"]*\bpicker-range\b/.test(tag),file+' has a plain range');
 }
}
assert.throws(()=>checkSelect('<select id="raw">','negative fixture'),'the gate catches a new raw select');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'js/pickers.js'),'utf8').replace(/^export /gm,'')+';this.controls=controlsPickerHtml;',context);
const html=context.controls('pk-controls','touch');
assert.match(html,/<select hidden[^>]*id="pk-controls"/);assert.equal((html.match(/<svg /g)||[]).length,3);assert.equal((html.match(/role="radio"/g)||[]).length,3);assert.match(html,/aria-checked="true" tabindex="0" data-value="touch"/);assert(!html.includes('data-hostonly'),'personal controls stay available to every player');
for(const file of ['kart-view.js','kart-elevated-view.js']){const s=fs.readFileSync(path.join(root,'js/engines',file),'utf8');assert.match(s,/controlsPickerHtml\(/);assert.match(s,/wirePickers\(/);assert.match(s,/syncPickers\(/);}
assert.match(fs.readFileSync(path.join(root,'js/games/number-hunt.js'),'utf8'),/nh-guess-picker/);
console.log('VISUAL_PICKERS_PASS: '+selects+' hidden selects, '+numbers+' number steppers, shared driving cards');
