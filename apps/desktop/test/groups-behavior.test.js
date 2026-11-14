const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function harness(adapter, props={}) {
  const slots=[], effects=[], polls=new Set(), routes=[];
  let cursor=0, dirty=false, tree;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const hooks={
    useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},
    useRef(value){return slots[cursor++]??={current:value};},
    useMemo(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const jsx=(type,props)=>({type,props}), router={push:path=>routes.push(path)};
  const stubs={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>router},'./GroupDirectory':{EMPTY_GROUP_FILTERS:{search:'',mode:'',publicTopic:'',community:'',language:'',mine:false},GroupDirectory:'Directory',groupLabel:(_type,value)=>value},'./GroupComposer':{GroupComposer:'Composer'},'@/components/Modal':{Modal:'Modal'},'@/lib/poll':{pollWhileVisible:fn=>{polls.add(fn);return()=>polls.delete(fn);}},'@/lib/gameIntent':{readGameIntent:()=>null,readGamesIntent:()=>true,withGameIntent:path=>path+(path.includes('?')?'&':'?')+'games=1'},'./GroupDetail.module.css':{default:{}},'./Groups.module.css':{default:{}}};
  const module={exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/groups/GroupPages.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports','window','navigator',js)(name=>stubs[name]||{},module,module.exports,{location:{search:'?games=1',hash:'',origin:'https://meet.test'}},{clipboard:{writeText:async()=>{}}});
  function render(){cursor=0;dirty=false;tree=module.exports.GroupPages({adapter,...props});for(const fn of effects.splice(0))fn();}
  const all=node=>!node||typeof node!=='object'?[]:[node,...[].concat(node.props?.children??[]).flatMap(all)];
  async function settle(){for(let i=0;i<15;i++){if(dirty)render();await Promise.resolve();}}
  render();
  return {get tree(){return tree;},routes,settle,poll:async()=>{await Promise.all([...polls].map(fn=>fn()));await settle();},find:text=>all(tree).find(node=>node.props?.children===text),findAll:text=>all(tree).filter(node=>node.props?.children===text),findType:type=>all(tree).find(node=>node.type===type),unmount:()=>slots.forEach(slot=>slot?.cleanup?.())};
}
const detail=title=>({group:{id:'group',title,mode:'chat',memberCount:1,onlineCount:0,capacity:6,joinPolicy:'open'},status:'owner',members:[{id:'owner',alias:'Bluebird',owner:true}],requests:[],bans:[]});
test('two same-turn create taps send one request and retain chosen Games intent',async()=>{
 const pending=deferred();let creates=0;
 const h=harness({create:async()=>{creates++;return pending.promise;}},{creating:true});
 const one=h.tree.props.onSubmit({title:'Words'}),two=h.tree.props.onSubmit({title:'Words'});
 assert.equal(creates,1);pending.resolve('created');await Promise.all([one,two]);await h.settle();assert.deepEqual(h.routes,['/groups/created?games=1']);h.unmount();
});
test('late pre-mutation poll cannot overwrite the post-mutation group',async()=>{
 let calls=0;const old=deferred(),fresh=deferred();
 const h=harness({get:async()=>++calls===1?detail('Before'):calls===2?old.promise:fresh.promise,invite:async()=> 'a'.repeat(64)},{id:'group'});
 await h.settle();const polling=h.poll();await Promise.resolve();
 h.find('Invite').props.onClick();await h.settle();assert.equal(calls,3);fresh.resolve(detail('After'));await h.settle();old.resolve(detail('Stale'));await polling;await h.settle();assert.ok(h.find('After'));assert.equal(h.find('Stale'),undefined);h.unmount();
});
test('revoked group clears cached owner actions rather than showing stale management',async()=>{
 let revoked=false;const h=harness({get:async()=>{if(revoked)throw Object.assign(new Error('Group unavailable'),{status:403});return detail('Words');}},{id:'group'});
 await h.settle();assert.ok(h.find('Manage group'));revoked=true;await h.poll();assert.equal(h.find('Manage group'),undefined);assert.equal(h.find('Open room'),undefined);assert.ok(h.find('Group unavailable'));h.unmount();
});

test('directory sends only the latest search after the 250 ms pause',async()=>{
 const searches=[];const h=harness({list:async filters=>{searches.push(filters.search);return [];}},{});await h.settle();
 h.tree.props.onFilters({...h.tree.props.filters,search:'wo'});await h.settle();h.tree.props.onFilters({...h.tree.props.filters,search:'words'});await h.settle();assert.deepEqual(searches,['']);
 await new Promise(resolve=>setTimeout(resolve,280));await h.settle();assert.deepEqual(searches,['','words']);h.unmount();
});


test('managed owner chooses an actual successor before the group leave request',async()=>{
 const left=[];const value=detail('Words');value.group.memberCount=2;value.members.push({id:'public-peer',alias:'Calm Owl',owner:false});
 const h=harness({get:async()=>value,leave:async(id,successor)=>{left.push({id,successor});}},{id:'group'});
 await h.settle();h.find('Leave group').props.onClick();await h.settle();
 assert.deepEqual(left,[]);assert.equal(h.findAll('Leave group').at(-1).props.disabled,true);
 const select=h.findType('select');assert(select);select.props.onChange({target:{value:'public-peer'}});await h.settle();
 assert.equal(h.findAll('Leave group').at(-1).props.disabled,false);h.findAll('Leave group').at(-1).props.onClick();await h.settle();
 assert.deepEqual(left,[{id:'group',successor:'public-peer'}]);assert.deepEqual(h.routes,['/discover?games=1']);h.unmount();
});
