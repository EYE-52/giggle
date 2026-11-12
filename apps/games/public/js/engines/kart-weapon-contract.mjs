// Shared by both authorities and both presentations. +Z is the barrel axis.
export const WEAPONS = Object.freeze(Object.fromEntries(Object.entries({
 machinegun:{tier:'common',damage:5,ammo:30,projectiles:30,range:38,halfAngle:180,cooldown:1/12,speed:140,ttl:1.25},
 trishot:{tier:'common',damage:150/9,ammo:9,projectiles:9,cooldown:.28,speed:95,ttl:1.2},
 mine:{tier:'common',damage:90,ammo:3,splashRadius:4,triggerRadius:2.2,armTime:.7,lifetime:12,bodyRadius:.41,dropInterval:.24,spacing:2.6},
 proximity:{tier:'common',damage:90,ammo:1,splashRadius:5.5,triggerRadius:3,armTime:.7,lifetime:16,bodyRadius:.41},
 fakecrate:{tier:'uncommon',damage:100,ammo:1,triggerRadius:1.8,armTime:.7,lifetime:20,bodyRadius:.41},
 missile:{tier:'uncommon',damage:65,ammo:1,speed:60,ttl:2.4,splashRadius:3,range:60,halfAngle:30,turnRate:1.5,lockDelay:.18},
 cannon:{tier:'uncommon',damage:50,ammo:3,projectiles:3,cooldown:.34,speed:55,ttl:2.2,splashRadius:2.8,launchY:0,gravity:0,knockback:10},
 blades:{tier:'uncommon',damage:100,ammo:1,duration:6,radius:2.2,bladeRadius:.55,turnRate:7,knockback:7},
 frost:{tier:'uncommon',damage:45,ammo:1,splashRadius:4.5,fuse:.9,slowTime:2,slowFactor:.55},
 ram:{tier:'uncommon',damage:100,ammo:1,duration:3,reach:3.4,speedFactor:1.5},
 supernova:{tier:'rare',damage:90,ammo:1,duration:3,contactRadius:2.7,contactDamage:100,splashRadius:9},
 nuke:{tier:'rare',damage:120,ammo:1,splashRadius:14},
}).map(([id,rule])=>[id,Object.freeze(rule)])));
export const WEAPON_DISPLAY=Object.freeze({
 machinegun:{label:'Tracking Blaster',action:'Start tracking fire',short:'FIRE',hint:'Fires 30 light shots at the nearest visible rival in any direction.'},
 trishot:{label:'Burst Blaster',action:'Fire three bursts',short:'FIRE',hint:'Aim three bursts straight ahead. Six hits score a knockout.'},
 cannon:{label:'Triple Rockets',action:'Launch three rockets',short:'FIRE',hint:'Steer between rockets. Two direct hits score a knockout.'},
 missile:{label:'Homing Missile',action:'Launch homing missile',short:'FIRE',hint:'Locks onto one rival ahead and turns toward them.'},
 mine:{label:'Trail Mines',action:'Lay a mine trail',short:'DROP',hint:'Keep driving to drop three mines along your path.'},
 proximity:{label:'Proximity Trap',action:'Drop proximity trap',short:'DROP',hint:'Drops one trap that bursts when a rival comes near.'},
 fakecrate:{label:'Fake Crate',action:'Drop fake crate',short:'DROP',hint:'A rival who touches the armed crate gets knocked out.'},
 blades:{label:'Spinning Bumper',action:'Spin the bumper',short:'SPIN',hint:'For six seconds, brush rivals with the spinning bumper.'},
 frost:{label:'Frost Bomb',action:'Throw frost bomb',short:'THROW',hint:'Slows rivals caught in the burst.'},
 ram:{label:'Turbo Ram',action:'Start turbo ram',short:'RAM',hint:'Charge into rivals for three seconds.'},
 supernova:{label:'Supernova',action:'Start supernova',short:'USE',hint:'For three seconds, take no damage and knock out rivals on contact.'},
 nuke:{label:'Nuke',action:'Throw nuke',short:'THROW',hint:'Bursts on contact or after a delay. The center scores a knockout.'},
});
export const WEAPON_IDS=Object.freeze(Object.keys(WEAPONS));
export const WEAPON_ALIASES=Object.freeze({pulse:'machinegun',scatter:'trishot',rocket:'cannon',seeker:'missile',shield:'supernova',laser:'machinegun',cluster:'frost'});
export const normalizeWeapon=id=>WEAPON_ALIASES[id]||id;
// A timed contact power occupies the pickup slot until the server ends it.
export function activeKartPower(kart){
  if(kart?.supernovaT>0)return 'supernova';
  if(kart?.bladesT>0)return 'blades';
  if(kart?.rammingT>0)return 'ram';
  return null;
}
export const TRI_FAN=Object.freeze([-2.5*Math.PI/180,0,2.5*Math.PI/180]);
export const CURATED_MUZZLE=Object.freeze({x:1.03,y:0.47,z:1.63});
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
 return d>1e-6&&d<=range&&n>0&&(halfAngle===180||(dx*forward.x+dy*(forward.y||0)+dz*forward.z)/(d*n)>=Math.cos(halfAngle*Math.PI/180));
}
// Shared weight cues: only the authority applies kick; recoil is cosmetic.
export const WEAPON_FEEL=Object.freeze(Object.fromEntries(Object.entries({
 machinegun:[.65,.045],trishot:[1.5,.10],missile:[6,.15],cannon:[10,.25],
 blades:[7,.12],supernova:[9,.12],mine:[5,.10],proximity:[5,.10],fakecrate:[3,.08],frost:[2,.11],
 ram:[8,.18],nuke:[14,.23],
}).map(([id,[kick,recoil]])=>[id,Object.freeze({kick,recoil})])));

// Smooth radial damage. Fractional HP is retained by the server.
export function blastDamage(kind,distance,radius=WEAPONS[kind]?.splashRadius){
 const rule=WEAPONS[kind];if(!rule||!(radius>0)||!Number.isFinite(distance))return 0;
 const t=Math.max(0,Math.min(1,distance/radius));return rule.damage*(1-t*t*(3-2*t));
}
