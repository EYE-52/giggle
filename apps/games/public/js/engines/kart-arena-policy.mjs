// Launch-arena contract v1. Old map IDs deliberately keep their old rules.
export const ARENA_POLICY_VERSION = 1;
export const ARENA_LIMITS = Object.freeze({homes:96, boxes:48, candidates:64, starts:32});
export function arenaBoxCount(area, players, sockets) {
  if(!Number.isFinite(area)||area<=0||!Number.isInteger(players)||players<2||players>32||!Number.isInteger(sockets)||sockets<12||sockets>96)throw new RangeError('Invalid arena supply');
  // Active firing probes exposed long road gaps at 320m2 per box; 200 still missed seeds.
  // Cycle more existing homes while retaining the 48-box and seat caps.
  return Math.min(sockets,48,Math.max(12,Math.ceil(area/160),Math.ceil(1.25*players)+8));
}
export function selectArenaVariant(source, players, requested) {
  if(!source.arenaVersion)return structuredClone(source);
  const variants=source.variants||[];
  const variant=requested?variants.find(v=>v.id===requested):variants.find(v=>players<=v.maxPlayers&&players>=v.minPlayers);
  if(!variant||players<variant.minPlayers||players>variant.maxPlayers)throw new RangeError('Arena player count or variant is unavailable');
  const map=Object.assign(structuredClone(source),structuredClone(variant.layout||{})),enabled=new Set(variant.districts);
  map.variantId=variant.id;map.mapRevision=source.revision;map.enabledDistricts=[...enabled];
  map.colliders=map.colliders.filter(d=>(!d.district||enabled.has(d.district))&&!variant.disabledColliders?.includes(d.id));
  map.sockets=map.sockets.filter(s=>!s.district||enabled.has(s.district));
  map.spawnCandidates=map.spawnCandidates.filter(s=>!s.district||enabled.has(s.district));
  const starts=variant.starts?.[players]||variant.startIds;
  map.spawns=starts?starts.map(id=>map.spawnCandidates.find(s=>s.id===id)):map.spawnCandidates.slice(0,variant.maxPlayers);
  if(map.spawns.some(s=>!s))throw new Error('Missing arena start');
  map.maxPlayers=variant.maxPlayers;map.minPlayers=variant.minPlayers;
  map.usableArea=variant.usableArea;map.boxPolicy={version:1,floorWeights:variant.floorWeights||map.levels.map(()=>1)};
  // Variant-only barriers are visible, solid, and use the same descriptor in
  // authority, prediction, camera queries and art. Never switch during a round.
  map.colliders.push(...structuredClone(variant.gates||[]));
  map.playBounds=structuredClone(variant.playBounds||map.playBounds);
  map.variants=undefined;
  return map;
}
export function validateArenaContract(map) {
  if(map.arenaVersion!==1||!map.variantId||!map.revision||!map.enabledDistricts?.length)throw new TypeError('Arena identity required');
  for(const [key,max] of [['spawns',32],['spawnCandidates',64],['sockets',96],['colliders',128]]) {
    const entries=map[key];if(!Array.isArray(entries)||!entries.length||entries.length>max||new Set(entries.map(e=>e.id)).size!==entries.length)throw new TypeError('Invalid arena '+key);
  }
  if(![2,3].includes(map.levels?.length)||!Number.isFinite(map.usableArea)||map.usableArea<=0)throw new TypeError('Invalid arena floors/area');
  for(const p of [...map.spawns,...map.spawnCandidates,...map.sockets])if(![p.x,p.y,p.z,p.angle].every(Number.isFinite)||!map.colliders.some(d=>d.id===p.surface))throw new TypeError('Invalid supported arena pose');
  for(const level of map.levels)if(map.sockets.filter(s=>s.level===level.id).length<4)throw new TypeError('Every arena floor needs four homes');
  return true;
}
// Exact integer quotas, at least four homes on every enabled floor.
export function arenaFloorQuotas(count, levels, sockets, weights=levels.map(()=>1)) {
  if(count<4*levels.length)throw new RangeError('Insufficient floor supply');
  const quota=levels.map(()=>4),capacity=levels.map(l=>sockets.filter(s=>s.level===l.id).length);
  if(capacity.some(n=>n<4)||capacity.reduce((a,b)=>a+b,0)<count)throw new RangeError('Insufficient legal homes');
  while(quota.reduce((a,b)=>a+b,0)<count){let best=-1,score=-Infinity;for(let i=0;i<quota.length;i++){const value=(weights[i]||1)/(quota[i]+1);if(quota[i]<capacity[i]&&value>score){score=value;best=i;}}quota[best]++;}
  return quota;
}
export function selectArenaHomes(map,players,random,starts=map.spawns.slice(0,players)) {
  const atlas=map.travelAtlas,rows=new Map((atlas?.ids||[]).map((id,i)=>[id,i])),columns=new Map((atlas?.homeIds||[]).map((id,i)=>[id,i]));
  const road=(a,b)=>{const i=rows.get(a.id),j=columns.get(b.id);return i!==undefined&&j!==undefined&&atlas.homeDistances?atlas.homeDistances[i*atlas.homeIds.length+j]*atlas.scale:Math.hypot(a.x-b.x,a.z-b.z);};
  const count=arenaBoxCount(map.usableArea,players,map.sockets.length),quotas=arenaFloorQuotas(count,map.levels,map.sockets,map.boxPolicy.floorWeights),chosen=[];
  for(let floor=0;floor<map.levels.length;floor++){
    const level=map.levels[floor],pool=map.sockets.filter(s=>s.level===level.id),needs=starts.filter(s=>Math.abs(s.y-level.y)<.1).map(s=>({s,count:0}));
    const districts=new Map();
    while(chosen.filter(s=>s.level===level.id).length<quotas[floor]){
      const candidates=pool.filter(s=>!chosen.includes(s));
      const ranked=candidates.map(s=>({s,score:needs.reduce((sum,n)=>sum+(n.count<2&&s.profile!=='risk'?((road(n.s,s)<=32?10000:0)+Math.max(0,36-road(n.s,s))*10)*(2-n.count):0),0)+(1/(1+(districts.get(s.district)||0)))*15+random()})).sort((a,b)=>b.score-a.score);
      const next=ranked[0].s;chosen.push(next);districts.set(next.district,(districts.get(next.district)||0)+1);
      for(const n of needs)if(next.profile!=='risk'&&road(n.s,next)<=32)n.count++;
    }
  }
  if(chosen.filter(s=>s.profile==='risk').length>Math.floor(count*.1)){
    // Keep risk locations but use ordinary odds where the round has few homes.
    let risks=Math.floor(count*.1);return chosen.map(s=>s.profile==='risk'&&risks--<=0?{...s,profile:'exposed'}:s);
  }
  return chosen;
}
// Eight actively firing drivers can exhaust the old 3/4/6s cycle even
// while homes are reachable. Keep fixed homes/counts; replenish ordinary
// floors within the three-second dry limit and retain the risk delay.
export const arenaRespawnMs=profile=>profile==='risk'?4000:profile==='exposed'?3000:2000;
export function createArenaRewardPolicy(weapons,players,random) {
  const recent=[],tiers=['common','uncommon','rare'],byTier=Object.fromEntries(tiers.map(t=>[t,Object.keys(weapons).filter(id=>weapons[id].tier===t)]));
  const cap=players<=8?1:players<=16?2:3;
  if(tiers.some(t=>!byTier[t].length))throw new Error('Incomplete weapon tiers');
  return {roll(profile,elapsedMs){
    while(recent.length&&recent[0]<=elapsedMs-12000)recent.shift();
    let weights=profile==='risk'&&elapsedMs>=8000?[.4,.5,.1]:[.52,.43,.05];
    if(recent.length>=cap){const total=weights[0]+weights[1];weights=[weights[0]/total,weights[1]/total,0];}
    const roll=random();let tier=roll<weights[0]?'common':roll<weights[0]+weights[1]?'uncommon':'rare';
    if(tier==='rare')recent.push(elapsedMs);
    const pool=byTier[tier];return pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];
  },stats:()=>({cap,awards:recent.length})};
}
