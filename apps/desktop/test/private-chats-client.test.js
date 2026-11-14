const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function harness(adapter, props={source:"group"}) {
  const slots=[], effects=[], polls=new Set(), routes=[];
  let cursor=0, dirty=false, tree;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const hooks={
    useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},
    useRef(value){return slots[cursor++]??={current:value};},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const jsx=(type,props)=>({type,props}), router={push:path=>routes.push(path)};
  const stubs={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>router},'./GroupComposer':{GroupComposer:'Composer'},'@/components/Modal':{Modal:'Modal'},'@/lib/poll':{pollWhileVisible:fn=>{polls.add(fn);return()=>polls.delete(fn);}},'@/lib/gameIntent':{readGameIntent:()=>null,readGamesIntent:()=>true,withGameIntent:path=>path+(path.includes('?')?'&':'?')+'games=1'},'./GroupDetail.module.css':{default:{}},'./Groups.module.css':{default:{}}};
  const module={exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/groups/PrivateChats.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports','window','navigator',js)(name=>stubs[name]||{},module,module.exports,{location:{search:'?games=1',hash:'',origin:'https://meet.test'}},{clipboard:{writeText:async()=>{}}});
  function render(){cursor=0;dirty=false;tree=module.exports.usePrivateChats(props.source,adapter);for(const fn of effects.splice(0))fn();}
  const all=node=>!node||typeof node!=='object'?[]:[node,...[].concat(node.props?.children??[]).flatMap(all)];
  async function settle(){for(let i=0;i<15;i++){if(dirty)render();await Promise.resolve();}}
  render();
  return {get tree(){return tree;},routes,settle,poll:async()=>{await Promise.all([...polls].map(fn=>fn()));await settle();},find:text=>all(tree.panel).find(node=>node.props?.children===text),unmount:()=>slots.forEach(slot=>slot?.cleanup?.())};
}
test('private invitation catches failures in its panel and blocks same-turn duplicate taps',async()=>{
 const pending=deferred();let sent=0;
 const h=harness({list:async()=>[],invite:async()=>{sent++;return pending.promise;}});await h.settle();
 const one=h.tree.invite('peer'),two=h.tree.invite('peer');assert.equal(sent,1);
 pending.reject(new Error('Invitation unavailable'));await Promise.all([one,two]);await h.settle();
 assert.ok(h.tree.panel);assert.ok(h.find('Invitation unavailable'));assert.equal(h.tree.count,0);h.unmount();
});
