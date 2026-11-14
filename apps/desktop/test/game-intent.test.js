const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(name){const exports={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);return exports;}
const {readGameIntent,readGamesIntent,withGameIntent,gameMeetPath}=load('gameIntent');
test('game intent is a bounded slug and never a destination or identity',()=>{
 assert.equal(readGameIntent('?game=charades'),'charades');assert.equal(readGameIntent('?game=ad-love-map'),'ad-love-map');
 for(const value of ['https://other.test','//other.test','../room','x&room=secret','x'.repeat(49),''])assert.equal(readGameIntent('?game='+encodeURIComponent(value)),null);
 assert.equal(gameMeetPath('charades'),'/home?game=charades');assert.equal(gameMeetPath('ad-closer',true),'/adult/create?game=ad-closer');
});
test('intent keeps squad context, room mode, referrals and private invite fragments',()=>{
 assert.equal(withGameIntent('/lobby?squad=sq-1&ref=ABC','charades'),'/lobby?squad=sq-1&ref=ABC&game=charades');
 assert.equal(withGameIntent('/adult/join/'+'a'.repeat(32)+'#invite='+'b'.repeat(32),'ad-closer'),'/adult/join/'+'a'.repeat(32)+'?game=ad-closer#invite='+'b'.repeat(32));
 assert.equal(withGameIntent('/adult/create?mode=voice','ad-closer'),'/adult/create?mode=voice&game=ad-closer');
 assert.equal(withGameIntent('//other.test','charades'),'/home');assert.equal(withGameIntent('/\\other.test','charades'),'/home');
});
test('landing sign-in retains the selected game and referral without accepting external next',()=>{
 const {referralSignInHref}=load('authLinks'),url=new URL(referralSignInHref('?game=charades&ref=abc&next=https://other.test'),'https://meet.test');
 assert.equal(url.searchParams.get('ref'),'ABC');assert.equal(url.searchParams.get('next'),'/home?game=charades');
});

test('neutral chooser stays separate from an ordinary call and a game wins over the chooser',()=>{
 assert.equal(gameMeetPath(null),'/home?games=1');assert.equal(gameMeetPath(null,true),'/adult/create?games=1');
 assert.equal(readGamesIntent('?games=1'),true);assert.equal(readGamesIntent(''),false);
 assert.equal(withGameIntent('/lobby?squad=room',null,true),'/lobby?squad=room&games=1');
 assert.equal(withGameIntent('/home?games=1','charades',true),'/home?game=charades');
 const url=new URL(load('authLinks').referralSignInHref('?games=1&ref=friend'),'https://meet.test');
 assert.equal(url.searchParams.get('next'),'/home?games=1');assert.equal(url.searchParams.get('ref'),'FRIEND');
});
