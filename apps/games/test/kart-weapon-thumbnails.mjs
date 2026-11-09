import assert from 'node:assert/strict';
import fs from 'node:fs';
const requests=[];
globalThis.Image=class {
  decode(){return new Promise((resolve,reject)=>requests.push({url:this.src,resolve,reject}));}
};
const thumbnails=await import('../public/js/engines/kart-assets.mjs?thumbnail-readiness');
let completed=false;
const ready=thumbnails.loadKartWeaponThumbnails().then(()=>{completed=true;});
const KEPT=['machinegun','trishot','missile','cannon','blades','supernova','mine','frost','ram','nuke'];
const N=KEPT.length;
assert.equal(requests.length,N,'Every selectable weapon has a decoded thumbnail barrier');
assert.deepEqual(requests.map(r=>r.url.match(/\/(\w+)\.(?:png|svg)$/)[1]).sort(),[...KEPT].sort(),'Exactly the sixteen kept weapons have thumbnails');
assert.equal(thumbnails.weaponThumbnailArt('machinegun','fallback'),'fallback','Legacy direct render retains fallback before decode');
for(const request of requests.slice(0,-1))request.resolve();
await Promise.resolve();await Promise.resolve();
assert.equal(completed,false,'Fifteen images cannot release the sixteen-image barrier');
requests.at(-1).resolve();await ready;
assert.equal(completed,true,'The final image releases the barrier');
assert.ok(thumbnails.weaponThumbnailArt('machinegun').includes('/machinegun.svg'),'Decoded actual weapon image replaces fallback');
assert.equal(thumbnails.weaponThumbnailArt('not-a-weapon','fallback'),'fallback','Unknown identifiers cannot construct asset URLs');
for(const retired of ['rail','grenade','emp','bomb','sentry','spikes']){
  assert.equal(thumbnails.weaponThumbnailArt(retired,'fallback'),'fallback',`Retired ${retired} never points at a deleted image`);
  assert.equal(fs.existsSync(new URL(`../public/assets/karts/weapon-thumbnails/${retired}.png`,import.meta.url)),false,`Retired ${retired}.png is not shipped`);
}
await thumbnails.loadKartWeaponThumbnails();assert.equal(requests.length,N,'Repeated loads reuse decoded local assets');
for(const request of requests.slice(0,N)){
  const bytes=fs.readFileSync(new URL('../public'+request.url,import.meta.url));
  if(request.url.endsWith('.svg')){assert.match(bytes.toString(),/<svg/);assert.match(bytes.toString(),/viewBox="0 0 96 96"/);}else{
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Asset is a PNG, not a renamed screenshot');
  assert.equal(bytes.readUInt32BE(16),96);assert.equal(bytes.readUInt32BE(20),96);
  }
}
const retry=await import('../public/js/engines/kart-assets.mjs?thumbnail-retry');
const failed=retry.loadKartWeaponThumbnails();
const failedResult=assert.rejects(failed,/decode failed/);
requests[N].reject(new Error('decode failed'));
for(const request of requests.slice(N+1))request.resolve();
await failedResult;
const next=retry.loadKartWeaponThumbnails();assert.equal(requests.length,3*N,'Failed image load allows a real retry');
for(const request of requests.slice(2*N))request.resolve();await next;
assert.ok(retry.weaponThumbnailArt('supernova').includes('/supernova.svg'),'Protocol-compatible shield identifier retains its actual image');
delete globalThis.Image;
console.log('KART_WEAPON_THUMBNAILS_PASS: all-image decode barrier, fallback, local PNG identity, cached success and real error retry');
