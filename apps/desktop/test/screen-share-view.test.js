const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
function load(file, imports) {
  const module = {exports:{}};
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',js)(name => imports[name] ?? (name.endsWith('.css') ? {} : {}),module,module.exports);
  return module.exports;
}
const helpers = load('lib/screenShareView.ts', {react:{}});
function fixture(file, initial = [], extraImports = {}) {
  const states = [...initial], refs=[]; let cursor=0, refCursor=0;
  const hooks = {useState(value){const i=cursor++; if(states[i]===undefined)states[i]=typeof value==='function'?value():value;return [states[i],value=>{states[i]=value;}];},useRef(value){const i=refCursor++;return refs[i]??(refs[i]={current:value});},useEffect(){},useLayoutEffect(){},useMemo:fn=>fn(),useCallback:fn=>fn};
  const imports = {react:hooks,'react/jsx-runtime':jsx,'./Icons':{Icon:new Proxy({},{get:()=>()=>null})},'@/lib/screenShareView':helpers,...extraImports};
  const exports=load(file,imports);
  return props=>{cursor=0;refCursor=0; return (exports.ScreenShareButton ?? exports.ParticipantVideoTile ?? exports.FocusVideoStage)(props);};
}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('share control uses the original click, locks duplicate requests and shows truthful labels', async()=>{
  const render=fixture('components/ScreenShareButton.tsx'),errors=[];let calls=0,resolve;
  const props={client:{supportsScreenShare:true},capture:{audio:'active',video:'off'},onStart:()=>{calls++;return new Promise(done=>resolve=done);},onStop:async()=>{},onError:e=>errors.push(e)};
  let button=render(props);assert.equal(button.props['aria-label'],'Share screen');button.props.onClick();assert.equal(calls,1,'native capture begins before the click returns');
  button=render(props);assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(calls,1);
  resolve();await tick();button=render({...props,capture:{...props.capture,screen:'active'}});assert.equal(button.props['aria-label'],'Stop sharing');assert.equal(button.props['aria-pressed'],true);
  assert.equal(render({...props,client:{supportsScreenShare:false}}),null);
  assert.equal(render({...props,capture:{...props.capture,screen:'pending'}}).props.disabled,true);
});
test('picker cancel stays quiet and real capture failures give a recovery message',async()=>{
  for(const [error,expected] of [[new DOMException('Denied','NotAllowedError'),''],[new Error('Publisher failed'),"Couldn't share your screen."]]){
    const render=fixture('components/ScreenShareButton.tsx'),messages=[];
    render({client:{supportsScreenShare:true},capture:{audio:'off',video:'active'},onStart:()=>Promise.reject(error),onStop:async()=>{},onError:e=>messages.push(e)}).props.onClick();await tick();if(expected)assert(messages.at(-1).startsWith(expected));else assert.equal(messages.at(-1),"");
  }
});
test('remote framing needs explicit, unexpired server source data',()=>{
  assert.equal(helpers.isScreenSharing({screenSharing:true,screenSharingExpiresAt:101},100),true);
  for(const p of [{},{screenSharing:true},{screenSharing:false,screenSharingExpiresAt:101},{screenSharing:true,screenSharingExpiresAt:100}])assert.equal(helpers.isScreenSharing(p,100),false);
});
test('screens force exact framing without camera backdrop, zoom or private framing controls',()=>{
  const render=fixture('components/ParticipantVideoTile.tsx',['crop',2,'menu']);
  const screen=render({name:'Rowan',hasVideo:true,screenSharing:true,isLocal:true,colorIndex:0});
  assert.equal(screen.props['data-media-fit'],'fit');assert.equal(screen.props['data-video-source'],'screen');assert.equal(screen.props.style['--person-zoom'],1);
  assert(!nodes(screen).some(n=>n.props?.['data-media-backdrop']!==undefined));
  assert(nodes(screen).some(n=>n.props?.children==='Your screen'));
  const adjust=nodes(screen).find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='Adjust view');assert.equal(adjust.props.disabled,true);
  const remote=render({name:'Rowan',hasVideo:true,screenSharing:true,colorIndex:0});assert(nodes(remote).some(n=>n.props?.children==='Rowan · Screen'));
  const camera=render({name:'Rowan',hasVideo:true,colorIndex:0});assert.equal(camera.props['data-media-fit'],'crop');assert.equal(camera.props.style['--person-zoom'],2);
  const css=fs.readFileSync(path.join(__dirname,'../components/ParticipantVideoTile.module.css'),'utf8');assert.match(css,/\[data-video-source=screen\].*object-fit:contain !important; transform:none !important/);
});

test('screen spotlight reuses hosts, supports viewer choice and expansion, and restores gallery sizing',()=>{
  const core=load('../../packages/core/src/focusLayout.ts',{}), camera=load('lib/cameraStage.ts',{});
  const render=fixture('components/FocusVideoStage.tsx',[{}, {width:390,height:700}, {a:4}, null, false, {a:{width:200,height:200}}, false],{'@giggle/core':core,'@/lib/cameraStage':camera});
  let controls={};const props={mine:['a','b','c'],theirs:[],mineLabel:'People',theirsLabel:'',renderParticipant:(id,size)=>{controls[id]=size;return null;}};
  let stage=render({...props,screenShares:['a']});assert.equal(stage.props['data-screen-spotlight'],'a');
  const cells=()=>nodes(stage).filter(n=>n.props?.['data-participant-id']);
  const a=cells().find(n=>n.props['data-participant-id']==='a');assert.equal(a.props.style.width,390);assert(a.props.style.height>350);assert.equal(cells().length,3);
  controls.a.grow();stage=render({...props,screenShares:['a']});assert.equal(cells().find(n=>n.props['data-participant-id']==='a').props.style.height,700);assert(cells().find(n=>n.props['data-participant-id']==='b').props['data-screen-hidden']);
  controls.a.shrink();stage=render({...props,screenShares:['a','b']});controls.b.togglePin();stage=render({...props,screenShares:['a','b']});assert.equal(stage.props['data-screen-spotlight'],'b');
  stage=render({...props,screenShares:['b','a']});assert.equal(stage.props['data-screen-spotlight'],'b','manual choice survives roster updates');
  stage=render(props);assert.equal(stage.props['data-screen-spotlight'],undefined);assert.equal(controls.a.weight,4);assert.equal(controls.a.pinned,true);assert.equal(cells().length,3);
});

test('a synchronous capture failure unlocks the same control and reports a useful error',()=>{
  const render=fixture('components/ScreenShareButton.tsx'),errors=[];
  const props={client:{supportsScreenShare:true},capture:{audio:'off',video:'off'},onStart:()=>{throw Error('Capture failed');},onStop:async()=>{},onError:e=>errors.push(e)};
  render(props).props.onClick();assert(errors.at(-1).startsWith("Couldn't share your screen."));assert.equal(render(props).props.disabled,false);
});
