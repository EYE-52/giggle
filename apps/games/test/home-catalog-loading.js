'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/js/app.js'),'utf8');
const nodes=new Map(['shelfGames','shelfCount','browseWrap'].map(id=>[id,{textContent:'',innerHTML:'',hidden:false,setAttribute(k,v){this[k]=v}}]));
const ctx={document:{getElementById:id=>nodes.get(id)},catalogLoaded:false,connLost:false,games:[],query:'',homeFiltered:()=>false,browseAll:false,homeGames:()=>ctx.games,wireGameCards(){},catalogRowHtml:g=>`<button>${g.name}</button>`,esc:s=>s};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function paintHomeCatalog()'),source.indexOf('function featuredHtml()')),ctx);
ctx.paintHomeCatalog();assert.equal(nodes.get('shelfCount').textContent,'Loading games…');assert.equal(nodes.get('shelfGames')['aria-busy'],'true');assert(!nodes.get('shelfGames').innerHTML.includes('No games match'));assert(nodes.get('browseWrap').hidden);
ctx.connLost=true;ctx.paintHomeCatalog();assert.equal(nodes.get('shelfCount').textContent,'Games unavailable');assert(nodes.get('shelfGames').innerHTML.includes('role="alert"'));assert.equal(nodes.get('shelfGames')['aria-busy'],'false');
ctx.connLost=false;ctx.paintHomeCatalog();assert.equal(nodes.get('shelfCount').textContent,'Loading games…');
ctx.catalogLoaded=true;ctx.games=[{name:'Chess'}];ctx.paintHomeCatalog();assert.equal(nodes.get('shelfCount').textContent,'1 of 1 games');assert(nodes.get('shelfGames').innerHTML.includes('Chess'));assert(!nodes.get('browseWrap').hidden);
ctx.games=[];ctx.paintHomeCatalog();assert.equal(nodes.get('shelfCount').textContent,'0 of 0 games');assert(nodes.get('shelfGames').innerHTML.includes('No games match'));
ctx.query='missing';ctx.paintHomeCatalog();assert(nodes.get('shelfGames').innerHTML.includes('“missing”'));
console.log('HOME_CATALOG_LOADING_PASS: delayed, failure, retry, settled and true empty results');
// Mount the real home renderer: delayed catalogue repaint must retain drafts,
// focus/caret even when search was previously focused.
Object.assign(ctx,{EMBED:{enabled:false},myName:'',roomCode:'',queryFocus:true,topbar:()=>'',heroPosters:()=>'<img data-art="unchanged">',pickGames:()=>[],pickHtml:()=>'',HOME_GROUPS:[],sortOptions:()=>'',catChipsHtml:()=>'',staggerIn(){},customOnly:false,sortMode:'shelf',catFilter:'all',homeGroup:'any'});
function input(id,value=''){return {id,value,selectionStart:0,selectionEnd:0,addEventListener(){},focus(){ctx.document.activeElement=this},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}}}
ctx.app={querySelectorAll:()=>[],querySelector:()=>null};Object.defineProperty(ctx.app,'innerHTML',{set(html){this.html=html;for(const m of html.matchAll(/id="([^"]+)"/g))nodes.set(m[1],input(m[1]));nodes.get('shelfGames').setAttribute=function(k,v){this[k]=v};}});
vm.runInContext(source.slice(source.indexOf('function renderHome()'),source.indexOf('/* Shared invite-link copy')),ctx);
nodes.set('nm',input('nm','Draft Host'));nodes.set('jc',input('jc','ABCD'));ctx.document.activeElement=nodes.get('nm');nodes.get('nm').setSelectionRange(4,7);ctx.catalogLoaded=true;ctx.renderHome();
assert.equal(nodes.get('nm').value,'Draft Host');assert.equal(nodes.get('jc').value,'ABCD');assert.equal(ctx.document.activeElement,nodes.get('nm'));assert.equal(nodes.get('nm').selectionStart,4);assert.equal(nodes.get('nm').selectionEnd,7);assert(ctx.app.html.includes('<img data-art="unchanged">'));
console.log('HOME_DRAFT_PASS: production renderer retains ticket values, selected range, focus and artwork');
