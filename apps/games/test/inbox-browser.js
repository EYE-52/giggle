'use strict';
// Actual browser DOM regressions for the production inbox. Responses and their
// ordering are isolated test fixtures; this is not physical-device evidence.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../public');
const script = String.raw`<script>
const pending=[];let calls=0;
window.fetch=(url,options={})=>new Promise(resolve=>{calls++;pending.push({url,options,resolve});});
const $=id=>document.getElementById(id);
const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
const rows=(n,status='new',top=250)=>Array.from({length:n},(_,i)=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(top-i).padStart(12,'0'),seq:top-i,createdAt:1700000000000,game:'platform',category:'controls',impact:'problem',version:'test',description:'<img src=x onerror=alert(1)> Report stays literal.',steps:'<script>alert(1)<\/script>',context:{browser:'<svg onload=alert(1)>'},status}));
const receipt=(request,data,status=200)=>request.resolve({ok:status<400,status,json:async()=>data});
const page=(n,status='new',top=250)=>({items:rows(n,status,top),games:[{id:'test-game',name:'<img src=x> Test game'}],before:n?top-n+1:null});
const query=request=>new URL(request.url,location.origin).searchParams;
const login=(key='isolated-inbox-test-key-000000000001')=>{$('access').value=key;$('login').requestSubmit();return pending.shift();};
document.getElementById('run-inbox').onclick=async()=>{
let checks=0;const ok=(value,message)=>{if(!value)throw Error(message);checks++;};
$('run-inbox').disabled=true;
try{
$('logout').click();$('status').value='new';$('game').value='all';pending.length=0;calls=0;
const first=login();ok(first&&query(first).get('status')==='new','login loads first New page');receipt(first,page(50));await settle();
ok($('items').children.length===50&&!$('more').hidden,'full first page has paging');
ok(!$('items').querySelector('img,script,svg')&&$('items').textContent.includes('<img src=x onerror=alert(1)>'),'report HTML remains literal text');
ok($('game').options[$('game').options.length-1].textContent==='<img src=x> Test game','catalog names remain literal');
$('status').value='triaged';$('status').dispatchEvent(new Event('change',{bubbles:true}));const filter=pending.shift();
ok(query(filter).get('status')==='triaged'&&!query(filter).has('before'),'filter change starts a fresh cursor');
ok($('status').disabled&&$('game').disabled&&$('more').disabled,'filter cannot drift while loading');receipt(filter,page(50,'triaged',350));await settle();
$('more').click();const older=pending.shift();ok(query(older).get('status')==='triaged'&&query(older).get('before')==='301','older page belongs to loaded filter');receipt(older,page(1,'triaged',300));await settle();
ok($('items').children.length===51,'older page appends once');
let states=$('items').querySelector('.inbox-state');states.children[2].click();const patch=pending.shift(),atPatch=calls;
ok(patch.options.method==='PATCH'&&$('more').disabled&&$('status').disabled,'moderation locks competing loads');
$('filters').querySelector('button').click();$('more').click();ok(calls===atPatch&&!pending.length,'refresh and paging cannot race status save');
receipt(patch,{ok:true,status:'resolved'});await settle();ok(states.children[2].getAttribute('aria-pressed')==='true'&&!$('status').disabled,'saved status shown and controls released');
$('filters').querySelector('button').click();const refresh=pending.shift(),atRefresh=calls;states.children[0].click();ok(calls===atRefresh&&!pending.length,'moderation cannot race a pending list');receipt(refresh,page(1,'resolved'));await settle();
states=$('items').querySelector('.inbox-state');states.children[1].click();const stale=pending.shift();$('logout').click();const second=login('isolated-inbox-test-key-000000000002');receipt(second,page(1));await settle();
receipt(stale,{error:'Previous test session expired.'},401);await settle();ok(!$('inbox').hidden&&$('login').hidden,'old 401 cannot lock a newer session');
ok(!$('status').disabled&&!$('more').disabled,'old completion cannot keep new session locked');
$('result').textContent='PASS '+checks+' actual DOM inbox checks';$('result').dataset.pass='true';
}catch(error){$('result').textContent='FAIL '+error.message;$('result').dataset.pass='false';}
finally{$('run-inbox').disabled=false;}
};
</script><script type="module">import '/js/report-inbox.js';document.getElementById('run-inbox').disabled=false;</script>`;
const html = fs.readFileSync(path.join(ROOT, 'reports/index.html'), 'utf8')
  .replace(/<body[^>]*>/, '$&<button id="run-inbox" disabled>Run inbox regression checks</button><pre id="result" role="status">Ready</pre>')
  .replace('<script type="module" src="/js/report-inbox.js"></script>', script);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://qa');
  if (url.pathname === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (url.pathname === '/') {
    const sizes = [[1024,600],[390,844],[844,390]];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>Inbox browser QA</title><style>body{margin:12px;font:16px system-ui}iframe{display:block;border:0;margin-top:12px}a{margin-right:12px}</style>${sizes.map(([w,h])=>`<a href="/?w=${w}&h=${h}">${w}×${h}</a>`).join('')}<iframe id="player" title="Actual inbox viewport" width="${Number(url.searchParams.get('w'))||390}" height="${Number(url.searchParams.get('h'))||844}" src="/fixture"></iframe>`); return;
  }
  const file = path.resolve(ROOT, '.' + url.pathname);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.INBOX_QA_PORT)||8556, '127.0.0.1', () => console.log('Inbox browser QA http://127.0.0.1:' + server.address().port));
