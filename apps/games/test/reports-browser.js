'use strict';
// Actual browser DOM contract for the report modal. Native browser QA opens
// /fixture directly or the framed size selector. No production routes ship it.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/issues.css"><title>Issue report browser QA</title></head><body style="padding:20px;box-sizing:border-box"><h1>Issue reporting</h1><p>Native dialog, draft and retry checks.</p><button id="open">Report an issue</button><button id="run">Run dialog regression checks</button><pre id="result" role="status"></pre><script type="module">
import {openIssueReport,isReportOpen} from '/js/report-issue.js';
import {sanitizeRunLog} from '/js/toolkit/run-log-schema.mjs';
const games=[{id:'doodle-guess',name:'Doodle Guess'},{id:'pocket-karts',name:'Pocket Karts'}];
let opener=document.getElementById('open');const result=document.getElementById('result');
const logA=sanitizeRunLog({schema:1,game:'doodle-guess',durationMs:120,readyMs:25,frameCount:4,rendererSampleCount:0,counts:{'runtime-error':1},events:[{type:'runtime-error',atMs:50}],token:'PRIVATE_TOKEN',room:'PRIVATE_ROOM',message:'<'+ '/textarea><script>bad()<'+ '/script>'});
const logB=sanitizeRunLog({schema:1,game:'doodle-guess',durationMs:480,readyMs:10,frameCount:20,rendererSampleCount:0,counts:{'socket-close':1},events:[{type:'socket-close',atMs:420}]});
const options={games,game:'doodle-guess',phase:'draw',theme:'day',embedded:false,runLog:logA};
let mode='success',requests=[],pending=[],count=0,downloads=[];
// Observe the exact Blob created by the real download handler, while still
// returning the browser's native object URL and keeping native revocation.
const nativeObjectURL=URL.createObjectURL.bind(URL);
URL.createObjectURL=blob=>{downloads.push(blob);return nativeObjectURL(blob);};
window.fetch=(url,options)=>{const packet=JSON.parse(options.body);requests.push(packet);if(mode==='pending')return new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>({ok:true,id:packet.id})})));return Promise.resolve({ok:mode!=='failure',json:async()=>mode==='failure'?{error:'Test connection failed.'}:{ok:true,id:packet.id}});};
function ok(value,message){if(!value)throw Error(message);count++;}
const dialog=()=>document.querySelector('dialog[open]');
const close=()=>dialog()?.querySelector('.issue-close').click();
const input=(text)=>{const el=dialog().querySelector('[name=description]');el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));};
const submit=async()=>{dialog().querySelector('form').requestSubmit();await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const download=async()=>{const before=downloads.length;dialog().querySelector('.issue-download').click();ok(downloads.length===before+1,'actual download handler creates a native Blob URL');return JSON.parse(await downloads.at(-1).text());};
opener.onclick=()=>openIssueReport(options,opener);
document.getElementById('run').onclick=async()=>{try{
count=0;requests=[];pending=[];downloads=[];mode='success';close();openIssueReport(options,opener);
ok(logA?.readyMs===25&&logA.counts['runtime-error']===1&&logB?.readyMs===10&&logB.counts['socket-close']===1&&!same(logA,logB),'production sanitizer produces distinct known diagnostic logs');
const preview=()=>dialog().querySelector('.issue-diagnostics textarea');
ok(!dialog().querySelector('.issue-diagnostics').open,'run diagnostics starts collapsed');ok(preview().readOnly&&!preview().name,'diagnostics preview is read-only and excluded from form fields');ok(same(JSON.parse(preview().value),logA),'visible preview is exactly the sanitized attachment');ok(!preview().value.includes('PRIVATE_')&&!preview().value.includes('<script>'),'sanitizer excludes private fields and arbitrary text from preview');ok(same(await download(),JSON.parse(preview().value)),'preview JSON equals actual downloaded JSON');
ok(isReportOpen(),'dialog opens');ok(document.activeElement.className==='issue-close','initial focus avoids phone keyboard');
let bubbled=0;const leak=()=>bubbled++;window.addEventListener('keydown',leak);dialog().querySelector('.issue-close').dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));window.removeEventListener('keydown',leak);ok(bubbled===0,'Space does not leak into game keyboard');
input('Canvas moved while drawing.');close();ok(!isReportOpen(),'close clears modal');ok(document.activeElement===opener,'close restores opener');openIssueReport(options,opener);ok(dialog().querySelector('[name=description]').value==='Canvas moved while drawing.','draft survives close');
mode='failure';await submit();ok(!dialog().querySelector('.issue-error').hidden,'failed request visible');ok(!dialog().querySelector('.issue-send').disabled,'retry available');ok(dialog().querySelector('[name=description]').value==='Canvas moved while drawing.','failure preserves text');const failedId=requests.at(-1).id;
ok(same(requests.at(-1).context.run,logA),'submitted diagnostic attachment is sanitized log A');
dialog().querySelector('.issue-cancel').click();ok(!isReportOpen()&&document.activeElement===opener,'failed Cancel retains draft and restores opener');openIssueReport({...options,runLog:logB},opener);
ok(same(JSON.parse(preview().value),logA),'reopened retry preview retains attached log A');
ok(same(await download(),logA),'reopened retry downloads its attached log A, despite newer log B');
mode='success';await submit();ok(requests.at(-1).id===failedId,'retry keeps idempotency key');ok(same(requests.at(-1).context.run,logA),'reopened retry packet retains attached log A');ok(!dialog().querySelector('.issue-success').hidden,'saved receipt shown');ok(dialog().querySelector('.issue-send').hidden,'saved report cannot be sent twice');ok(!('room' in requests.at(-1).context)&&!('url' in requests.at(-1).context),'no room or URL collected');
ok(document.activeElement===dialog().querySelector('.issue-cancel')&&document.activeElement.textContent==='Done','successful receipt moves focus to visible Done');dialog().querySelector('.issue-cancel').click();ok(document.activeElement===opener,'Done restores Report opener');
openIssueReport({...options,runLog:logB},opener);ok(dialog().querySelector('[name=description]').value==='','saved draft cleared');ok(same(await download(),logB),'new draft refreshes its downloaded diagnostic to log B');input('A new report after the confirmed receipt.');await submit();ok(requests.at(-1).id!==failedId&&same(requests.at(-1).context.run,logB),'new report sends a fresh packet with log B');close();openIssueReport(options,opener);
input('Report acknowledged before new edit.');mode='pending';await submit();close();openIssueReport(options,opener);pending.shift()();await Promise.resolve();await Promise.resolve();await Promise.resolve();input('New edit after older confirmation.');close();openIssueReport(options,opener);ok(dialog().querySelector('[name=description]').value==='New edit after older confirmation.','ack before new edit cannot unmap active draft');mode='success';await submit();close();openIssueReport(options,opener);
input('First report awaiting confirmation.');mode='pending';await submit();const pendingId=requests.at(-1).id;ok(dialog().querySelector('[name=description]').disabled,'inflight fields locked');close();openIssueReport(options,opener);input('Second report edited after closing.');pending.shift()();await Promise.resolve();await Promise.resolve();await Promise.resolve();close();openIssueReport(options,opener);ok(dialog().querySelector('[name=description]').value==='Second report edited after closing.','late ack cannot delete an edited reopened draft');mode='success';await submit();ok(requests.at(-1).id!==pendingId,'edited draft gets new key');close();
openIssueReport({...options,game:'platform'},opener);ok(dialog().querySelector('[name=game]').value==='platform','platform selectable');input('Room menu closed unexpectedly.');await submit();ok(requests.at(-1).game==='platform','platform report submitted');close();
openIssueReport(options,opener);input('Doodle retry across close works.');mode='pending';await submit();const closeId=requests.at(-1).id;close();openIssueReport(options,opener);mode='success';await submit();ok(requests.at(-1).id===closeId,'close and reopen retries same pending report');pending.shift()();await Promise.resolve();await Promise.resolve();close();
openIssueReport(options,opener);const hiddenDraft=dialog().querySelector('[name=description]').value;ok(hiddenDraft==='','acknowledged retry cleared draft');close();
openIssueReport({...options,runLog:logB},opener);input('Unsent draft while the room header changes.');const retired=opener,replacement=opener.cloneNode(true);replacement.className='report-icon';replacement.setAttribute('data-report','');replacement.setAttribute('aria-label','Report an issue in the current game');replacement.textContent='!';retired.replaceWith(replacement);opener=replacement;opener.onclick=()=>openIssueReport({...options,runLog:logB},opener);close();ok(!retired.isConnected&&document.activeElement===replacement,'retired room/game opener returns focus to the current header Report icon');
replacement.click();ok(dialog().querySelector('[name=description]').value==='Unsent draft while the room header changes.','replacement Report click reopens the preserved unsent draft');input('');close();ok(document.activeElement===replacement,'replacement Report icon remains a usable opener');
// Match the actual Room entry: the connected drawer opener becomes hidden
// when the delegated app handler closes its native details before reporting.
const drawer=document.createElement('details');drawer.innerHTML='<summary>Room controls</summary><button type="button" data-report>Report an issue</button>';document.body.appendChild(drawer);
try{
 const drawerOpener=drawer.querySelector('[data-report]');drawer.open=true;
 ok(drawerOpener.isConnected&&drawerOpener.getClientRects().length>0,'Room Report entry is mounted and rendered before selection');
 drawerOpener.onclick=()=>{drawer.open=false;openIssueReport({...options,runLog:logB},drawerOpener);};
 drawerOpener.focus();drawerOpener.click();
 ok(isReportOpen()&&drawerOpener.isConnected&&!drawer.open&&drawerOpener.closest('details:not([open])')===drawer,'Room Report opens the actual dialog after hiding its still-connected drawer opener');
 input('Private report draft from the Room drawer.');close();
 ok(document.activeElement===replacement,'hidden connected Room opener returns focus to the visible external Report icon');
 replacement.click();ok(dialog().querySelector('[name=description]').value==='Private report draft from the Room drawer.','external Report preserves the unsent draft opened from Room');
 input('');close();ok(document.activeElement===replacement,'Room-entry recovery leaves the external Report icon usable');
}finally{drawer.remove();}
result.textContent='PASS '+count+' actual DOM report checks';result.dataset.pass='true';result.dataset.checks=String(count);
}catch(error){close();result.textContent='FAIL '+error.message;result.dataset.pass='false';}};
const query=new URLSearchParams(location.search);document.documentElement.dataset.theme=query.get('theme')||'day';
</script></body></html>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://qa');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  if(url.pathname==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><title>Report responsive QA</title><style>body{background:#ddd;font:16px system-ui;margin:12px}iframe{border:0;display:block;margin-top:12px}a{margin-right:12px}</style><nav>${[[1280,800],[1024,600],[390,844],[320,640],[844,390],[568,320]].map(([w,h])=>`<a href="/?w=${w}&h=${h}">${w}×${h}</a>`).join('')}<a href="/?w=390&h=844&theme=night">Phone Night</a></nav><iframe id="player" width="${Number(url.searchParams.get('w'))||390}" height="${Number(url.searchParams.get('h'))||844}" src="/fixture?theme=${url.searchParams.get('theme')==='night'?'night':'day'}"></iframe>`);return;
  }
  const file=path.resolve(ROOT,'public','.'+url.pathname);if(!file.startsWith(path.join(ROOT,'public')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  const type={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)];res.setHeader('Content-Type',type||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.REPORT_QA_PORT||8551),'127.0.0.1',()=>console.log('Report dialog browser QA http://127.0.0.1:'+server.address().port));
