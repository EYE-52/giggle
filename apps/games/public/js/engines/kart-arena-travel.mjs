// Road distances are compiled offline from the real support/hull graph.
// Respawns attach nearby enemies to a bay only along supported clear ground.
// No graph search or map raster runs in a live authority tick.
export function createArenaTravelScorer(physics,map){
 const atlas=map.travelAtlas,n=atlas?.ids?.length||0,byId=new Map((atlas?.ids||[]).map((id,i)=>[id,i])),poses=new Map((map.spawnCandidates||[]).map(p=>[p.id,p]));
 if(!n||n>64||atlas.version!==1||atlas.scale!==.5||atlas.distances.length!==n*n||atlas.ids.some(id=>!poses.has(id)))return null;
 let anchors=[];
 function attach(p){
  const hit=physics.supportAt({...p,y:p.y+.25},2),y=hit?.point.y??p.y-.65;
  const near=[...poses.values()].filter(s=>Math.abs(s.y-y)<.25).map(s=>({s,d:Math.hypot(s.x-p.x,s.z-p.z)})).sort((a,b)=>a.d-b.d).slice(0,8);
  for(const {s,d}of near){let clear=true;const steps=Math.max(1,Math.ceil(d/2));for(let i=0;i<=steps;i++){const t=i/steps,x=s.x+(p.x-s.x)*t,z=s.z+(p.z-s.z)*t,support=physics.supportAt({x,y:y+.4,z},.8);if(!support||Math.abs(support.point.y-y)>.2){clear=false;break;}}
   if(clear&&!physics.sweepStatic({x:s.x,y:y+.85,z:s.z},{x:p.x,y:y+.85,z:p.z},.3))return {index:byId.get(s.id),offset:d,p};
  }return {p};
 }
 return {prepare(enemies){anchors=enemies.map(attach);},distance(candidate){const row=byId.get(candidate.id);let best=Infinity;for(const a of anchors){const direct=Math.hypot(candidate.x-a.p.x,candidate.y+.65-a.p.y,candidate.z-a.p.z);if(row===undefined||a.index===undefined){best=Math.min(best,direct);continue;}const d=atlas.distances[row*n+a.index];best=Math.min(best,d===65535?direct:d*.5+a.offset);}return best;}};
}
