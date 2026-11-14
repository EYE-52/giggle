const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../../packages/core/src/groupIdentity.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loaded={};new Function('exports',js)(loaded);const {groupViewerId,isOwnGroupMember}=loaded;
test('anonymous member and leader detection uses only the server self handle',()=>{
 const group={identityMode:'aliases',selfUserId:'anon_self',selfMemberId:'anon_self'};
 assert.equal(groupViewerId(group,'private-account'),'anon_self');assert(isOwnGroupMember(group,{userId:'anon_self',memberId:'anon_self'},'private-account'));
 assert(!isOwnGroupMember(group,{userId:'private-account',memberId:'anon_other'},'private-account'));
 assert.equal(groupViewerId({identityMode:'aliases'},'private-account'),'');assert(!isOwnGroupMember({identityMode:'aliases'},{userId:'private-account'},'private-account'));
});
test('named memberships and unavailable squad detail keep their own correct viewer identity',()=>{
 const account='private-account';assert.equal(groupViewerId(undefined,account),account);assert(isOwnGroupMember({identityMode:'names'},{userId:account,memberId:'member'},account));
 const encounter={identityMode:'aliases',selfUserId:'anon_self',selfMemberId:'anon_self'};const own=[{userId:'anon_self',memberId:'anon_self',role:'leader'},{userId:'anon_other',memberId:'anon_other',role:'member'}].find(m=>m.userId===groupViewerId(undefined||encounter,account));assert.equal(own.role,'leader');
});
