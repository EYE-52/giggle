// Shared by both authorities and both presentations. +Z is the barrel axis.
export const WEAPONS = Object.freeze(Object.fromEntries(Object.entries({
 machinegun:{tier:'common',damage:1,ammo:30,cooldown:1/12,hitCooldown:1,speed:140,ttl:1.25},
 trishot:{tier:'common',damage:1,ammo:9,cooldown:.28,hitCooldown:1,speed:95,ttl:1.2},
 mine:{tier:'common',damage:1,ammo:3,triggerRadius:2.2,armTime:.7,lifetime:12,bodyRadius:.41,dropInterval:.24},
 oil:{tier:'common',damage:1,ammo:2,triggerRadius:2.4,armTime:.5,lifetime:12,bodyRadius:.41,dropInterval:.3,spinTime:1.2},
 boomerang:{tier:'common',damage:1,ammo:2,speed:30,outTime:.62,curveRate:1.4,returnTurn:7,ttl:3.2,catchRadius:2.2},
 missile:{tier:'uncommon',damage:2,ammo:1,speed:60,ttl:2.4,splashRadius:3,range:60,halfAngle:30,turnRate:1.5,lockDelay:.18},
 cannon:{tier:'uncommon',damage:2,ammo:1,speed:44,ttl:2.2,splashRadius:2.8,splashDamage:1,launchY:4,gravity:12,knockback:10},
 blades:{tier:'uncommon',damage:1,ammo:1,duration:6,hitCooldown:2,radius:2.2,bladeRadius:.55,turnRate:7,knockback:7},
 frost:{tier:'uncommon',damage:1,ammo:1,splashRadius:4.5,fuse:.9,slowTime:2,slowFactor:.55},
 thunder:{tier:'uncommon',damage:1,ammo:1,range:35,halfAngle:15},
 ram:{tier:'uncommon',damage:1,ammo:1,duration:3,reach:4.6,speedFactor:1.5},
 supernova:{tier:'rare',damage:2,ammo:1,duration:3,splashRadius:9},
 nuke:{tier:'rare',damage:3,ammo:1,splashRadius:14},
}).map(([id,rule])=>[id,Object.freeze(rule)])));
export const WEAPON_IDS=Object.freeze(Object.keys(WEAPONS));
export const WEAPON_ALIASES=Object.freeze({pulse:'machinegun',scatter:'trishot',rocket:'missile',seeker:'missile',shield:'supernova',proximity:'mine',laser:'machinegun',cluster:'frost',bouncer:'boomerang'});
export const normalizeWeapon=id=>WEAPON_ALIASES[id]||id;
export const TRI_FAN=Object.freeze([-8*Math.PI/180,0,8*Math.PI/180]);
export const CURATED_MUZZLE=Object.freeze({x:0,y:.5,z:1.9});
// Rotation comes from the physical body, never the eased visual pose or slip.
export function weaponForward(q,spread=0){
 const x=Math.sin(spread),z=Math.cos(spread),tx=2*q.y*z,ty=2*(q.z*x-q.x*z),tz=-2*q.y*x;
 return {x:x+q.w*tx+q.y*tz-q.z*ty,y:q.w*ty+q.z*tx-q.x*tz,z:z+q.w*tz+q.x*ty-q.y*tx};
}
export function launchVelocity(direction,speed,velocity={x:0,y:0,z:0},lift=0){
 return {x:direction.x*speed+(velocity.x||0),y:direction.y*speed+(velocity.y||0)+lift,z:direction.z*speed+(velocity.z||0)};
}

// All cones are full 3D cones; halfAngle is half the advertised width.
export function inWeaponCone(from,forward,to,range,halfAngle){
 const dx=to.x-from.x,dy=(to.y||0)-(from.y||0),dz=to.z-from.z,d=Math.hypot(dx,dy,dz),n=Math.hypot(forward.x,forward.y||0,forward.z);
 return d>1e-6&&d<=range&&n>0&&(dx*forward.x+dy*(forward.y||0)+dz*forward.z)/(d*n)>=Math.cos(halfAngle*Math.PI/180);
}
// Shared weight cues: only the authority applies kick; recoil is cosmetic.
export const WEAPON_FEEL=Object.freeze(Object.fromEntries(Object.entries({
 machinegun:[.65,.045],trishot:[1.5,.10],missile:[6,.15],cannon:[10,.25],
 blades:[7,.12],supernova:[9,.12],mine:[5,.10],oil:[1.5,.07],frost:[2,.11],
 thunder:[4,.13],boomerang:[2,.09],ram:[8,.18],nuke:[14,.23],
}).map(([id,[kick,recoil]])=>[id,Object.freeze({kick,recoil})])));
