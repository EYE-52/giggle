// Test-only local driving planner. It predicts ordinary steering/throttle
// paths against the audited road grid; it never moves an authority body.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wrap=n=>Math.atan2(Math.sin(n),Math.cos(n));
export function createArenaBotPlanner(nav){
 const columns=new Map();
 for(const n of nav.nodes){const key=n.x+':'+n.z;if(!columns.has(key))columns.set(key,[]);columns.get(key).push(n);}
 function attach(x,y,z){
  let best=null,score=Infinity;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const n of columns.get((Math.round(x)+dx)+':'+(Math.round(z)+dz))||[]){
   const d=Math.hypot(n.x-x,n.z-z);
   if(Math.abs(n.y-y)<1&&d<score){best=n;score=d;}
  }
  return score<.75?best:null;
 }
 function drive(pose,node,home){
  const yaw=Math.atan2(2*(pose.rotation.w*pose.rotation.y+pose.rotation.x*pose.rotation.z),1-2*(pose.rotation.y**2+pose.rotation.x**2));
  let best=null;
  for(const wanted of [3,6,11,-4])for(const steer of [-1,-.75,-.5,-.25,0,.25,.5,.75,1]){
   let arrived=false;let x=pose.position.x,z=pose.position.z,y=node.y,a=yaw,v=pose.speed,last=node,valid=true;
   const direction=Math.sign(wanted);
   for(let step=0;step<12;step++){
    v+=clamp(wanted-v,-2,2);a-=v/2*Math.tan(steer*.43/(1+Math.abs(v)*.055))*.12;
    x+=Math.sin(a)*v*.12;z+=Math.cos(a)*v*.12;
    const n=attach(x,y,z);if(!n||!Number.isFinite(home.field.distance[n.index])){valid=false;break;}
    y=n.y;last=n;
    if(Math.hypot(home.x-x,home.z-z)<1.8&&Math.abs(home.y-y)<.3){arrived=true;break;}
   }
   if(!valid)continue;
   const next=nav.nodes[home.field.parents[last.index]],heading=next?Math.atan2(next.x-last.x,next.z-last.z):Math.atan2(home.x-x,home.z-z);
   const score=(arrived?-5:home.field.distance[last.index]+Math.hypot(x-last.x,z-last.z)+Math.abs(wrap(a-heading-(direction<0?Math.PI:0)))*.5)+(direction<0?3:0);
   if(!best||score<best.score)best={score,steer,wanted};
  }
  if(!best)return null;
  return {steer:best.steer,throttle:best.wanted<0?-.6:clamp((best.wanted-pose.speed)*.3,0,.8),brake:best.wanted>0&&pose.speed>best.wanted+1?.3:0};
 }
 return {drive,attach};
}
