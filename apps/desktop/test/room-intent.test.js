const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(name){const exports={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);return exports;}
const {readRoomCreateIntent}=load('roomIntent'),{authContinuationHref,referralSignInHref}=load('authLinks');
test('only explicit new-room intent chooses a validated communication mode',()=>{
 for(const communicationMode of ['video','voice','chat'])assert.deepEqual(readRoomCreateIntent('?create=1&mode='+communicationMode),{requested:true,communicationMode});
 assert.deepEqual(readRoomCreateIntent('?create=1&mode=unknown'),{requested:true,communicationMode:'video'});
 assert.deepEqual(readRoomCreateIntent('?mode=voice&squad=old-room'),{requested:false,communicationMode:'video'});
 assert.deepEqual(readRoomCreateIntent(''),{requested:false,communicationMode:'video'});
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
