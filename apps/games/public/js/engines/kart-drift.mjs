// Shared by the authority, prediction and HUD. Charge stays normalized 0..1.
export const DRIFT_SECONDS = 1.6;
export const DRIFT_TIERS = Object.freeze([
  Object.freeze({seconds:.35,boost:.45,color:0x36bfff,css:'#36bfff',label:'Blue'}),
  Object.freeze({seconds:.9,boost:.9,color:0xff962e,css:'#ff962e',label:'Orange'}),
  Object.freeze({seconds:1.6,boost:1.4,color:0xc76bff,css:'#c76bff',label:'Purple'}),
]);
export function driftTier(charge=0) {
  const seconds=charge*DRIFT_SECONDS+1e-8;
  return seconds>=1.6?3:seconds>=.9?2:seconds>=.35?1:0;
}
// No timers or random input. Loss of ground/speed cancels without a reward.
// The initial steering sign locks the slide; counter steering opens its radius.
export function stepDrift(k,dt,grounded=true,ease=1,input=k.input||{}) {
  const was=k._driftHeld===true;
  const active=input.drift===true&&grounded&&k.speed>6&&(input.throttle||0)>=0&&(was||Math.abs(input.steer||0)>.15);
  k.driftHop=Math.max(0,(k.driftHop||0)-dt);
  if(active) {
    if(!was){k.driftDirection=Math.sign(input.steer);k.driftHop=.24;}
    k.driftCharge=Math.min(1,(k.driftCharge||0)+dt*Math.min(1.3,ease)/DRIFT_SECONDS);
  } else {
    const tier=driftTier(k.driftCharge);
    if(was&&!input.drift&&grounded&&k.speed>6&&tier) {
      k.turbo=Math.max(k.turbo||0,DRIFT_TIERS[tier-1].boost);
    }
    k.driftCharge=0;k.driftDirection=0;
  }
  k.driftTier=driftTier(k.driftCharge);k._driftHeld=active;
  return active;
}
