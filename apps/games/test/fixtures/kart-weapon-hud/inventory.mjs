// Sample the inventory just after the first accepted use.
export function galleryInventory(kind,rule,fire){
 const spent=fire?(kind==='trishot'?3:1):0;
 const ammo=rule.ammo-spent;
 return {weapon:ammo?kind:null,ammo,firing:fire&&ammo>0,
  bladesT:fire&&kind==='blades'?rule.duration:0,
  supernovaT:fire&&kind==='supernova'?rule.duration:0,
  rammingT:fire&&kind==='ram'?rule.duration:0};
}
