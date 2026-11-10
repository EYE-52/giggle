import fs from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {arenaClearanceGraph} from '../test/helpers/kart-arena-audit.mjs';
await R.init();const out={};for(const players of[2,8]){const map=selectArenaVariant(elevatedMap('rookie-ribbons'),players),w=createKartPhysics(R,C);elevatedStatics(map).forEach(d=>w.addStatic(d));try{const nav=arenaClearanceGraph(w,map),nodes=map.spawnCandidates.map(s=>nav.nearest(s).n.index),distances=[],homeNodes=map.sockets.map(s=>nav.nearest(s).n.index),homeDistances=[];for(const n of nodes){const field=nav.shortest(n);for(const i of nodes)distances.push(Number.isFinite(field.distance[i])?Math.round(field.distance[i]*2):65535);for(const i of homeNodes)homeDistances.push(Number.isFinite(field.distance[i])?Math.round(field.distance[i]*2):65535);}out[map.variantId]={version:1,scale:.5,ids:map.spawnCandidates.map(s=>s.id),distances,homeIds:map.sockets.map(s=>s.id),homeDistances};}finally{w.dispose();}}
fs.writeFileSync(new URL('../public/js/engines/kart-rookie-travel.mjs',import.meta.url),'// Offline real support graph. tools/kart-author-rookie-travel.mjs.\nexport const rookieTravel='+JSON.stringify(out)+';\n');
