// Offline synthetic inputs for the vision-model comparison. No network calls.
// Usage: node packages/avatars/prepare-eval.cjs /tmp/giggle-avatar-eval
// Renders 24 known configurations (expected settings come from the renderer
// config, not another model) plus 4 negative fixtures, all 512px PNGs, and a
// manifest.json describing what to score. Hair hidden under a hat is never
// scored. Synthetic catalog recovery, not selfie likeness.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const { CHARACTER_DEFAULTS, validateCharacter } = require('../../server/src/utils/characterConfig');
const { SKIN_PALETTE, HAIR_PALETTE, MATCH_PROMPT_VERSION } = require('../../server/src/utils/avatarMatch');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const logo = {};
new Function('exports', compile(path.join(__dirname, '../ui-tokens/src/logo.ts')))(logo);
const renderer = {};
new Function('require', 'exports', compile(path.join(__dirname, 'src/index.tsx')))(name => name === '../../ui-tokens/src/logo' ? logo : require(name), renderer);

const CREAM = '#f2e8d5';
const DISCRETE_TRAITS = ['face', 'glasses', 'facialHair', 'headwear', 'earrings', 'clothing'];

const paletteId = (palette, hex, label) => {
  const entry = palette.find(candidate => candidate.hex === String(hex).toLowerCase());
  if (!entry) throw new Error(`${label} ${hex} is not in the shared palette; fix the fixture`);
  return entry.id;
};

// 24 known configurations spanning all 8 hair styles, all 3 face shapes, both
// glasses styles, all facial hair, hats, earrings, freckles, and every skin
// and hair palette id at least once. Sliders vary inside the 30-70 model range.
const knownFixtures = [
  { id: 'curls-soft-freckles', settings: { freckles: true } },
  { id: 'curls-round-glasses', settings: { face: 'round', glasses: 'round', skin: '#f6d4b8', hairColor: '#633e30' } },
  { id: 'crop-angular-glasses', settings: { hair: 'crop', face: 'angular', glasses: 'square', skin: '#684332', hairColor: '#25252a', faceWidth: 62 } },
  { id: 'crop-stubble-sweater', settings: { hair: 'crop', facialHair: 'stubble', clothing: 'sweater', skin: '#dca47c', hairColor: '#9e5a39' } },
  { id: 'bob-hoops-sweater', settings: { hair: 'bob', face: 'round', earrings: 'hoops', clothing: 'sweater', skin: '#efbd98', hairColor: '#dfbf85', eyeSpacing: 40 } },
  { id: 'bob-cap-jacket', settings: { hair: 'bob', face: 'angular', headwear: 'cap', clothing: 'jacket', skin: '#493126', hairColor: '#bcb4ad' } },
  { id: 'swoop-jacket-glasses', settings: { hair: 'swoop', glasses: 'round', clothing: 'jacket', skin: '#86523e', hairColor: '#c18a49' } },
  { id: 'swoop-mustache-collar', settings: { hair: 'swoop', face: 'angular', facialHair: 'mustache', clothing: 'collared', skin: '#a36c4b', hairColor: '#25252a' } },
  { id: 'buzz-beard-tee', settings: { hair: 'buzz', face: 'round', facialHair: 'beard', skin: '#bd815e', hairColor: '#39302e' } },
  { id: 'buzz-cap-hoodie', settings: { hair: 'buzz', headwear: 'cap', clothing: 'hoodie', earrings: 'studs', skin: '#684332', hairColor: '#25252a' } },
  { id: 'bald-soft-tee', settings: { hair: 'bald', skin: '#efbd98', hairColor: '#39302e' } },
  { id: 'bald-beanie-hoodie', settings: { hair: 'bald', face: 'round', headwear: 'beanie', clothing: 'hoodie', skin: '#86523e', hairColor: '#633e30' } },
  { id: 'long-hoops-tee', settings: { hair: 'long', earrings: 'hoops', skin: '#f6d4b8', hairColor: '#9e5a39', faceWidth: 38 } },
  { id: 'long-beard-sweater', settings: { hair: 'long', face: 'round', facialHair: 'beard', glasses: 'square', clothing: 'sweater', skin: '#a36c4b', hairColor: '#633e30' } },
  { id: 'bun-studs-tee', settings: { hair: 'bun', earrings: 'studs', freckles: true, skin: '#dca47c', hairColor: '#25252a' } },
  { id: 'bun-glasses-collar', settings: { hair: 'bun', face: 'angular', glasses: 'round', clothing: 'collared', skin: '#493126', hairColor: '#ece0c9' } },
  { id: 'curls-beard-jacket', settings: { face: 'angular', facialHair: 'beard', glasses: 'square', clothing: 'jacket', skin: '#684332', hairColor: '#633e30' } },
  { id: 'crop-hoodie-freckles', settings: { hair: 'crop', face: 'round', clothing: 'hoodie', freckles: true, skin: '#f6d4b8', hairColor: '#dfbf85', noseSize: 38 } },
  { id: 'bob-glasses-collar', settings: { hair: 'bob', glasses: 'round', clothing: 'collared', skin: '#86523e', hairColor: '#39302e', mouthWidth: 62 } },
  { id: 'swoop-hoodie', settings: { hair: 'swoop', face: 'round', clothing: 'hoodie', skin: '#efbd98', hairColor: '#bcb4ad' } },
  { id: 'buzz-freckles-tee', settings: { hair: 'buzz', face: 'angular', freckles: true, skin: '#a36c4b', hairColor: '#c18a49' } },
  { id: 'long-stubble-jacket', settings: { hair: 'long', face: 'angular', facialHair: 'stubble', clothing: 'jacket', skin: '#bd815e', hairColor: '#bcb4ad', eyeSpacing: 60 } },
  { id: 'bun-hoops-sweater', settings: { hair: 'bun', face: 'round', earrings: 'hoops', clothing: 'sweater', skin: '#493126', hairColor: '#9e5a39' } },
  { id: 'bald-mustache-collar', settings: { hair: 'bald', face: 'angular', facialHair: 'mustache', clothing: 'collared', skin: '#dca47c', hairColor: '#ece0c9' } },
].map(fixture => {
  const settings = validateCharacter({ ...CHARACTER_DEFAULTS, ...fixture.settings });
  if (!settings) throw new Error(`fixture ${fixture.id} does not validate against the character contract`);
  const scoredTraits = [
    ...(settings.headwear === 'none' ? ['hair'] : []), // hair hidden under a hat is not scored
    ...DISCRETE_TRAITS,
    ...(settings.freckles ? ['freckles'] : []), // absence is too subtle to demand
    'skinTone',
    'hairColor', // always visible through brows (and facial hair when present)
  ];
  return {
    id: fixture.id,
    kind: 'known',
    settings,
    expectedStatus: 'match',
    acceptableStatuses: ['match'],
    scoredTraits,
    expected: {
      hair: settings.hair, face: settings.face, glasses: settings.glasses, facialHair: settings.facialHair,
      headwear: settings.headwear, earrings: settings.earrings, clothing: settings.clothing,
      freckles: settings.freckles === true,
      skinTone: paletteId(SKIN_PALETTE, settings.skin, `fixture ${fixture.id} skin`),
      hairColor: paletteId(HAIR_PALETTE, settings.hairColor, `fixture ${fixture.id} hairColor`),
      faceWidth: settings.faceWidth, eyeSpacing: settings.eyeSpacing,
      noseSize: settings.noseSize, mouthWidth: settings.mouthWidth,
    },
  };
});

const negativeFixtures = [
  { id: 'blank-cream', expectedStatus: 'no_face', acceptableStatuses: ['no_face'], note: 'blank cream square' },
  { id: 'two-avatars', expectedStatus: 'multiple_faces', acceptableStatuses: ['multiple_faces'], note: 'two avatars side by side' },
  { id: 'blurred-avatar', expectedStatus: 'unclear_photo', acceptableStatuses: ['unclear_photo', 'match'], note: 'heavily blurred avatar; unclear_photo or match both acceptable' },
  { id: 'tiny-avatar', expectedStatus: 'unclear_photo', acceptableStatuses: ['unclear_photo', 'match'], note: 'tiny avatar on a large blank canvas; unclear_photo or match both acceptable' },
].map(fixture => ({ ...fixture, kind: 'negative', settings: null, scoredTraits: [], expected: null }));

const renderSettings = (settings, size) => renderToStaticMarkup(React.createElement(renderer.GiggleAvatar, { ...settings, size, animated: false, label: '' }));
const renderBuffer = (settings, size) => sharp(Buffer.from(renderSettings(settings, size))).png().toBuffer();
const blankBuffer = (width, height) => sharp({ create: { width, height, channels: 3, background: CREAM } }).png().toBuffer();

async function main() {
  const dir = path.resolve(process.argv[2] || '/tmp/giggle-avatar-eval');
  fs.mkdirSync(dir, { recursive: true });

  for (const fixture of knownFixtures) {
    await sharp(Buffer.from(renderSettings(fixture.settings, 512))).png().toFile(path.join(dir, `${fixture.id}.png`));
  }

  await sharp({ create: { width: 512, height: 512, channels: 3, background: CREAM } }).png().toFile(path.join(dir, 'blank-cream.png'));

  const left = await renderBuffer({ ...CHARACTER_DEFAULTS, hair: 'curls' }, 256);
  const right = await renderBuffer({ ...CHARACTER_DEFAULTS, hair: 'bob', face: 'round', earrings: 'hoops', clothing: 'sweater', skin: '#efbd98', hairColor: '#dfbf85' }, 256);
  await sharp(await blankBuffer(512, 512)).composite([
    { input: left, left: 0, top: 128 },
    { input: right, left: 256, top: 128 },
  ]).png().toFile(path.join(dir, 'two-avatars.png'));

  const sharpAvatar = await renderBuffer(CHARACTER_DEFAULTS, 512);
  await sharp(sharpAvatar).blur(16).png().toFile(path.join(dir, 'blurred-avatar.png'));

  const tiny = await renderBuffer({ ...CHARACTER_DEFAULTS, face: 'round', glasses: 'round' }, 64);
  await sharp(await blankBuffer(512, 512)).composite([{ input: tiny, left: 224, top: 224 }]).png().toFile(path.join(dir, 'tiny-avatar.png'));

  const fixtures = [...knownFixtures, ...negativeFixtures];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    kind: 'synthetic-catalog-recovery',
    label: 'Synthetic catalog recovery, not selfie likeness',
    promptVersion: MATCH_PROMPT_VERSION,
    imageEdgePx: 512,
    notes: 'Rendered offline from the local character renderer; no network calls, no real people, no inference. Expected settings come from the renderer configuration, not another model. Hair hidden under a hat is excluded from scoring; freckles are only scored when present. Numeric sliders are reported with tolerance by the runner, not as exact pass/fail. Recovering these configurations is a catalog smoke test, not evidence of selfie likeness.',
    counts: { known: knownFixtures.length, negative: negativeFixtures.length },
    fixtures,
  }, null, 2));
  console.log(`Prepared ${fixtures.length} synthetic images (${knownFixtures.length} known + ${negativeFixtures.length} negative) and manifest in ${dir}. No network calls made.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
