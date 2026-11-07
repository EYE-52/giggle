// Conservative scene draw inventory; no camera culling or shadow passes.
// node scripts/kart-draw-counts.mjs [--fallback]
import {buildClassicArena,countDraws,drawSources,loadSceneryAssets} from '../test/helpers/kart-headless-world.mjs';
const assets=process.argv.includes('--fallback')?{}:await loadSceneryAssets();
for(const id of ['ring','blocks','garden','frost','neon']){
  const arena=buildClassicArena(id,assets);
  console.log(JSON.stringify({id,draws:countDraws(arena.scene),sources:drawSources(arena)}));
}
