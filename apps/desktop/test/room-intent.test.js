const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(name){const exports={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);return exports;}
const {readRoomCreateIntent}=load('roomIntent'),{authContinuationHref,referralSignInHref}=load('authLinks');
test('only explicit new-room intent chooses a validated communication mode',()=>{
 for(const communicationMode of ['video','voice','chat'])assert.deepEqual(readRoomCreateIntent('?create=1&mode='+communicationMode),{requested:true,communicationMode,matching:false});
 assert.deepEqual(readRoomCreateIntent('?create=1&mode=unknown'),{requested:true,communicationMode:'video',matching:false});
 assert.deepEqual(readRoomCreateIntent('?mode=voice&squad=old-room'),{requested:false,communicationMode:'video',matching:false});
 assert.deepEqual(readRoomCreateIntent(''),{requested:false,communicationMode:'video',matching:false});
});
test('mode, selected game, chooser and referral survive sign-in as a local continuation',()=>{
 const call=new URL(referralSignInHref('?create=1&mode=voice&game=warm-words&ref=friend'),'https://meet.test');
 assert.equal(call.searchParams.get('ref'),'FRIEND');assert.equal(call.searchParams.get('next'),'/home?create=1&mode=voice&game=warm-words');
 const chooser=new URL(authContinuationHref('/home?create=1&mode=chat&games=1&ref=friend'),'https://meet.test');
 assert.equal(chooser.searchParams.get('ref'),'FRIEND');assert.equal(chooser.searchParams.get('next'),'/home?create=1&mode=chat&games=1&ref=friend');
});
test('groups/new is a valid internal return and an external destination is never accepted',()=>{
 assert.equal(new URL(authContinuationHref('/groups/new'),'https://meet.test').searchParams.get('next'),'/groups/new');
 for(const path of ['https://other.test','//other.test','/\\other.test','/\nother.test'])assert.equal(new URL(authContinuationHref(path),'https://meet.test').searchParams.get('next'),'/home');
});


test('matching needs explicit creation intent and always uses video',()=>{
 for(const mode of ['video','voice','chat','unknown'])assert.deepEqual(readRoomCreateIntent('?create=1&match=1&mode='+mode),{requested:true,matching:true,communicationMode:'video'});
 for(const search of ['?match=1','?mode=voice&match=1&squad=existing','?create=0&match=1'])assert.deepEqual(readRoomCreateIntent(search),{requested:false,matching:false,communicationMode:'video'});
 for(const match of ['true','0','unknown'])assert.deepEqual(readRoomCreateIntent('?create=1&mode=voice&match='+match),{requested:true,matching:false,communicationMode:'voice'});
});

test('matching, referral and game intent survive both sign-in entry paths safely',()=>{
 const href=new URL(referralSignInHref('?create=1&mode=voice&match=1&ref=friend&games=1'),'https://meet.test');
 assert.equal(href.searchParams.get('ref'),'FRIEND');
 const next=new URL(href.searchParams.get('next'),'https://meet.test');
 assert.equal(next.pathname,'/home');assert.equal(next.searchParams.get('match'),'1');assert.equal(next.searchParams.get('mode'),'video');assert.equal(next.searchParams.get('games'),'1');
 assert.equal(new URL(authContinuationHref('/home?create=1&mode=video&match=1'),'https://meet.test').searchParams.get('next'),'/home?create=1&mode=video&match=1');
 assert.equal(new URL(referralSignInHref('?match=1&ref=friend'),'https://meet.test').searchParams.has('next'),false);
});
