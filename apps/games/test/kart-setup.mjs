import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const game = require('../games/pocket-karts/server');
const { MAP_LABELS, preflightElevated } = require('../games/engines/kart-elevated-adapter');
const util = 'data:text/javascript;base64,' + Buffer.from(fs.readFileSync(new URL('../public/js/util.js', import.meta.url))).toString('base64');
const source = fs.readFileSync(new URL('../public/js/kart-setup.js', import.meta.url), 'utf8').replace("'./util.js'", JSON.stringify(util));
const { KART_ARENAS, ROUND_MINUTES, roundMinutes, resolveKartSetup, kartSetupHtml, kartSetupSummary } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const g = { id: 'pocket-karts', schema: { settings: game.manifest.settings, packs: [] } };
const defaults = Object.fromEntries(g.schema.settings.map(s => [s.key, s.def]));
let checks = 0;
const check = (v, msg) => { assert(v, msg); checks++; };
check(KART_ARENAS.length === g.schema.settings.find(s => s.key === 'map').options.length, 'every offered map has one truthful preview');
check(new Set(KART_ARENAS.map(a => a.key)).size === KART_ARENAS.length, 'legacy and elevated profiles cannot share preview keys');
for (const a of KART_ARENAS) {
  check(g.schema.settings.find(s => s.key === 'map').options.includes(a.label), 'preview label is authoritative');
  check(Boolean(MAP_LABELS[a.label]) === Boolean(a.elevated), 'profile agrees with authority');
  const file = new URL('../public/assets/karts/previews/' + a.key + '.webp', import.meta.url);
  check(fs.statSync(file).size > 0 && fs.statSync(file).size < 25000, 'preview exists within small image budget');
  for (const mode of ['Zap Battle', 'Garage Battle', 'Star Rush']) {
    const settings = { ...defaults, mode, map: a.label, winRule: 'Score target', targetStars: 23, targetHits: 17 };
    const next = resolveKartSetup(settings, 'map');
    if (a.elevated) check(preflightElevated(next).ok, 'selecting elevated map repairs unsupported combination');
    else check(JSON.stringify(next) === JSON.stringify(settings), 'classic maps preserve mode and finish choice');
    check(next.targetStars === 23 && next.targetHits === 17, 'switching preserves inactive score targets');
    check(JSON.stringify(settings) === JSON.stringify({ ...defaults, mode, map: a.label, winRule: 'Score target', targetStars: 23, targetHits: 17 }), 'resolver does not mutate saved configuration');
  }
  const html = kartSetupHtml(g, { ...defaults, map: a.label }, false);
  check(html.includes(`value="${a.label}"`), 'read-only chooser retains actual selected label');
  check(!/data-hostonly(?! disabled)/.test(html), 'guests cannot edit controls');
}
for (const a of KART_ARENAS.filter(a => a.elevated)) {
  for (const mode of ['Garage Battle', 'Star Rush']) {
    const next = resolveKartSetup({ ...defaults, map: a.label, mode }, 'mode');
    check(next.map === 'Garden Circuit' && next.mode === mode, 'mode change selects compatible classic arena');
  }
  const target = resolveKartSetup({ ...defaults, map: a.label, winRule: 'Score target' }, 'winRule');
  check(target.map === a.label && target.winRule === 'Score target' && preflightElevated(target).ok, 'a score target keeps the elevated arena');
}
check(Object.keys(resolveKartSetup(defaults)).length === g.schema.settings.length, 'save keeps entire replacement settings object');
check(!('garage' in resolveKartSetup(defaults)), 'no unknown garage key is transmitted');
const config = { ...defaults, map: 'Alpine Courtyard', targetStars: 23, targetHits: 17 };
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const context = { room: { config: { 'pocket-karts': { settings: config } } }, kartSetupSummary };
vm.createContext(context);
vm.runInContext(app.slice(app.indexOf('function configNoteText(g)'), app.indexOf('\nfunction cardHtml(g)')), context);
check(context.configNoteText(g) === 'Battle · Alpine Courtyard · 3 min · Live sunset', 'shipping Play summary omits inactive targets and uses player-facing mode name');
check(kartSetupSummary(g, { ...config, map: 'Rookie Ring', winRule: 'Score target', lightCycle: 'Fixed light', palette: 'Starlight' }) === 'Battle · Rookie Ring · First to 17 KOs · 3 min max · Night', 'battle target summary shows active knockouts and fallback time only');
check(kartSetupSummary(g, { ...config, mode: 'Star Rush', map: 'Garden Circuit', winRule: 'Score target', roundSeconds: 90 }) === 'Star Rush · Garden Circuit · First to 23 stars · 2 min max · Live sunset', 'star target summary shows active stars without knockout target');
check(kartSetupSummary(g, { ...config, mode: 'Garage Battle', map: 'Garden Circuit', lightCycle: 'Fixed light', palette: 'Sunset' }) === 'Garage · Garden Circuit · 3 min · Sunset', 'garage and fixed lighting use concise player-facing names');
check(kartSetupSummary(g, { map: 'Alpine Courtyard' }) === 'Battle · Alpine Courtyard · 3 min · Live sunset', 'partial saved configurations use the actual schema defaults');
check(JSON.stringify(config) === JSON.stringify({ ...defaults, map: 'Alpine Courtyard', targetStars: 23, targetHits: 17 }), 'summary preserves inactive values for later mode switches');
// Round length: 1 to 5 whole minutes, 3 by default, stored as seconds.
const round = g.schema.settings.find(s => s.key === 'roundSeconds');
check(round.min === 60 && round.max === 300 && round.def === 180, 'round length is 1 to 5 minutes, default 3');
check(JSON.stringify(ROUND_MINUTES) === '[1,2,3,4,5]', 'setup offers every whole minute');
check(roundMinutes(30) === 1 && roundMinutes(90) === 2 && roundMinutes(180) === 3 && roundMinutes(600) === 5 && roundMinutes('x') === 3, 'legacy lengths snap to the nearest offered minute');
check(resolveKartSetup({ ...defaults, roundSeconds: '90' }).roundSeconds === '120', 'a legacy draft snaps to whole minutes before saving');
const roundHtml = kartSetupHtml(g, defaults, true);
check((roundHtml.match(/data-kart-key="roundSeconds"/g) || []).length === 5, 'five round-length choices');
check(/aria-checked="true"[^>]*data-kart-key="roundSeconds" data-kart-value="180"/.test(roundHtml), 'three minutes is selected by default');
check(roundHtml.includes('>3 min</button>') && !roundHtml.includes('Seconds per round'), 'lengths read as minutes');
check(kartSetupSummary(g, { ...config, map: 'Alpine Courtyard', winRule: 'Score target' }) === 'Battle · Alpine Courtyard · First to 17 KOs · 3 min max · Live sunset', 'elevated arenas summarise a score target');
console.log(`KART_SETUP ${checks} checks passed: all arena labels/assets, compatibility, inactive drafts and read-only choices`);
