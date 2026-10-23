import assert from 'node:assert/strict';
import fs from 'node:fs';
const requests=[];
globalThis.Image=class {
  decode(){return new Promise((resolve,reject)=>requests.push({url:this.src,resolve,reject}));}
};
const thumbnails=await import('../public/js/engines/kart-assets.mjs?thumbnail-readiness');
let completed=false;
const ready=thumbnails.loadKartWeaponThumbnails().then(()=>{completed=true;});
assert.equal(requests.length,14,'Every selectable weapon has a decoded thumbnail barrier');
assert.equal(thumbnails.weaponThumbnailArt('pulse','fallback'),'fallback','Legacy direct render retains fallback before decode');
for(const request of requests.slice(0,-1))request.resolve();
await Promise.resolve();await Promise.resolve();
assert.equal(completed,false,'Thirteen images cannot release the fourteen-image barrier');
requests.at(-1).resolve();await ready;
assert.equal(completed,true,'The final image releases the barrier');
assert.ok(thumbnails.weaponThumbnailArt('pulse').includes('/pulse.png'),'Decoded actual weapon image replaces fallback');
assert.equal(thumbnails.weaponThumbnailArt('not-a-weapon','fallback'),'fallback','Unknown identifiers cannot construct asset URLs');
await thumbnails.loadKartWeaponThumbnails();assert.equal(requests.length,14,'Repeated loads reuse decoded local assets');
for(const request of requests){
  const bytes=fs.readFileSync(new URL('../public'+request.url,import.meta.url));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Asset is a PNG, not a renamed screenshot');
  assert.equal(bytes.readUInt32BE(16),96);assert.equal(bytes.readUInt32BE(20),96);
}
const retry=await import('../public/js/engines/kart-assets.mjs?thumbnail-retry');
const failed=retry.loadKartWeaponThumbnails();
const failedResult=assert.rejects(failed,/decode failed/);
requests[14].reject(new Error('decode failed'));
for(const request of requests.slice(15))request.resolve();
await failedResult;
const next=retry.loadKartWeaponThumbnails();assert.equal(requests.length,42,'Failed image load allows a real retry');
for(const request of requests.slice(28))request.resolve();await next;
assert.ok(retry.weaponThumbnailArt('shield').includes('/shield.png'),'Protocol-compatible shield identifier retains its actual image');
delete globalThis.Image;
console.log('KART_WEAPON_THUMBNAILS_PASS: all-image decode barrier, fallback, local PNG identity, cached success and real error retry');
