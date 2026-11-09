import battle from '../../games/engines/kart-rules-battle.js';
import {WEAPONS} from '../../public/js/engines/kart-weapon-contract.mjs';
export function fixture(){
 const k=(pid,x,z)=>({pid,x,z,angle:0,speed:0,slip:0,...battle.blankKart(),shield:0,input:{boost:false}});
 const a=k('a',0,-10),b=k('b',0,0),s={phase:'drive',karts:[a,b],scores:{a:0,b:0},bound:100,blocks:[],crates:[],zaps:[],zapSeq:0,mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,volleyHits:new Map(),lastTick:0,targetHits:99};
 const connected=new Set(['a','b']);return {a,b,s,connected,step(dt=1/60){s.lastTick+=dt*1000;battle.tick(s,connected,dt,new Map(s.karts.map(k=>[k.pid,structuredClone(k)])),null,new Map());},arm(kind){a.weapon=kind;a.ammo=WEAPONS[kind]?.ammo||1;a.volley='pickup-'+(s.volleySeq=(s.volleySeq||0)+1);a.pendingFire=true;}};
}
