// Use the same authoring tools as the mounted libraries. From apps/games:
// npm exec --package=@gltf-transform/cli@4.5.1 -- sh -c 'NODE_PATH="$(dirname "$(dirname "$(command -v gltf-transform)")")" node scripts/build-kart-combat-core.cjs'
const path = require('node:path');
const { NodeIO } = require('@gltf-transform/core');
const { EXTMeshoptCompression } = require('@gltf-transform/extensions');
const { prune } = require('@gltf-transform/functions');
const { MeshoptEncoder } = require('meshoptimizer');

async function build() {
  const dir = path.resolve(__dirname, '../public/assets/karts/combat');
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(path.join(dir, 'combat.glb'));
  const library = doc.getRoot().listNodes().find(n => n.getName() === 'CombatLibrary');
  // Every other branch has art in the pulse, mounted or secondary library.
  const retained = new Set(['Bolt', 'Pickup', 'Shield', 'RailShot']);
  for (const child of library.listChildren()) {
    if (retained.has(child.getName())) continue;
    const removed = [];
    child.traverse(node => removed.push(node));
    for (const node of removed) node.dispose();
  }
  await doc.transform(prune({ keepAttributes: true, keepLeaves: true, keepSolidTextures: true }));
  // Lossless buffer compression. No quantization transform or lossy filters.
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(path.join(dir, 'combat-core.meshopt.glb'), doc);
}

build().catch(error => { console.error(error); process.exitCode = 1; });
