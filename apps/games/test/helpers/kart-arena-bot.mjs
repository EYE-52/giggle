// Test-only planning world. Candidate controls start from a COPY of the public
// pose and use the same suspension/collision code. The real authority receives
// ordinary inputs only; no authority pose, inventory or clock is modified.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function createArenaBotPlanner(nav,query){
 const columns=new Map();
 for(const n of nav.nodes){const key=n.x+':'+n.z;if(!columns.has(key))columns.set(key,[]);columns.get(key).push(n);}
 function attach(x,y,z){
  let best=null,score=Infinity;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const n of columns.get((Math.round(x)+dx)+':'+(Math.round(z)+dz))||[]){
   const d=Math.hypot(n.x-x,n.z-z);
   if(Math.abs(n.y-y)<1&&d<score){best=n;score=d;}
  }
  return score<.9?best:null;
 }
 let added=false;
 function controls(steer,wanted,speed){return {steer,throttle:wanted<0?-.65:clamp((wanted-speed)*.3,0,.8),brake:wanted>0&&speed>wanted+.8?.3:0};}
 function drive(pose,node,home,brain,at){
  if(brain.planGoal===home.id&&at<brain.planUntil&&!brain.recoveryNeeded)return controls(brain.planSteer,brain.planSpeed,pose.speed);
  if(!added){query.addKart('planning-copy',pose);added=true;}
  let best=null;
  for(const [steer,wanted] of [[-1,5],[-.5,8],[0,11],[.5,8],[1,5],[-1,-4],[0,-4],[1,-4]]){
   query.resetKart('planning-copy',pose);query.restoreKart('planning-copy',pose);
   let p=pose,valid=true,arrived=false,elapsed=0;
   for(let j=0;j<20;j++){
    query.applyIntent('planning-copy',controls(steer,wanted,p.speed));query.step(3);p=query.pose('planning-copy');elapsed+=.05;
    if((p.position.y<pose.position.y-1&&!p.grounded)||1-2*(p.rotation.x**2+p.rotation.z**2)<.65){valid=false;break;}
    if(Math.hypot(home.x-p.position.x,home.z-p.position.z)<2.1&&Math.abs(home.y-p.position.y+.65)<.4&&p.grounded){arrived=true;break;}
   }
   if(!valid||p.wheels.filter(w=>w.contact).length<3)continue;
   const n=attach(p.position.x,p.position.y-.65,p.position.z);if(!n||!Number.isFinite(home.field.distance[n.index]))continue;
   const moved=Math.hypot(p.position.x-pose.position.x,p.position.z-pose.position.z);
   const score=(arrived?-10+elapsed:home.metres[n.index]+Math.hypot(p.position.x-n.x,p.position.z-n.z))+(wanted<0?1:0)+(moved<.3?5:0);
   if(!best||score<best.score)best={score,steer,wanted};
  }
  query.drainImpacts();brain.recoveryNeeded=false;
  if(!best){brain.planUntil=at;return null;}
  brain.planGoal=home.id;brain.planUntil=at+200;brain.planSteer=best.steer;brain.planSpeed=best.wanted;
  return controls(best.steer,best.wanted,pose.speed);
 }
 return {drive,attach};
}
