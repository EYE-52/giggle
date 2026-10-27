/* Development-only elevated COMBAT layouts. These are shared numeric
 * surfaces, not background images or racing courses. The production flat
 * engine does not import this module. A renderer and the physics adapter
 * consume the same colliders; decoration may never change their shape.
 * Spawn/socket y is the support surface height, not the chassis centre.
 * The vehicle adapter applies its own model/chassis offset when spawning.
 */
const yaw = angle => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });
const box = (id, x, y, z, hx, hy, hz, material = 'stone', grip = 1) =>
  ({ id, shape: 'box', position: { x, y, z }, half: { x: hx, y: hy, z: hz }, material, grip });
const deck = (id, x, top, z, hx, hz, material = 'stone') =>
  ({ ...box(id, x, top - 0.4, z, hx, 0.4, hz, material), shape: 'deck' });
// Closed wedge: local -Z starts at y=0, local +Z ends at `rise`.
const ramp = (id, x, z, width, run, rise, angle = 0, material = 'stone') =>
  ({ id, shape: 'wedge', position: { x, y: rise / 2, z }, half: { x: width / 2, y: rise / 2, z: run / 2 }, rotation: yaw(angle), material, grip: 1 });
const point = (id, surface, x, y, z, angle = Math.atan2(-x, -z)) =>
  ({ id, surface, x, y, z, angle });
const floor = (half = 60) => box('floor', 0, -1, 0, half, 1, half, 'asphalt');
const perimeter = (half = 60) => [
  box('north-boundary', 0, 2, half, half, 2, 0.5, 'barrier'),
  box('south-boundary', 0, 2, -half, half, 2, 0.5, 'barrier'),
  box('east-boundary', half, 2, 0, 0.5, 2, half, 'barrier'),
  box('west-boundary', -half, 2, 0, 0.5, 2, half, 'barrier'),
];
const groundSpawns = coordinates => coordinates.map(([x, z], i) => point(`spawn-${i}`, 'floor', x, 0, z));
const sockets = entries => entries.map(([surface, x, y, z], i) => point(`crate-${i}`, surface, x, y, z, 0));

const MAPS = {
  garden: {
    id: 'garden', revision: 'combat-elevation-1', name: 'Alpine Courtyard',
    environment: 'alpine', half: 60,
    colliders: [floor(), ...perimeter(),
      // A raised courtyard has two ramps and a genuine driveable underpass.
      deck('courtyard', 24, 7, 8, 14, 12),
      ramp('south-ramp', 16, -18, 10, 28, 7),
      ramp('north-ramp', 32, 34, 10, 28, 7, Math.PI),
      ...[[12, -2], [36, -2], [12, 18], [36, 18]].map(([x,z], i) => box(`courtyard-pier-${i}`, x, 3.1, z, 0.8, 3.1, 0.8)),
      // Cover divides the plaza without closing its central cross-routes.
      box('fountain-base', -12, 1.2, -4, 4, 1.2, 4, 'fountain'),
      box('garden-west', -32, 1.1, 18, 6, 1.1, 3, 'hedge'),
      box('garden-south', -14, 1.1, -32, 7, 1.1, 3, 'hedge'),
      box('garden-north', -5, 1.1, 34, 4, 1.1, 6, 'hedge'),
      box('arcade-cover', 42, 2.5, -24, 4, 2.5, 5),
    ],
    spawns: groundSpawns([[-44,-40], [42,46], [-44,40], [44,-42], [-34,-12], [-22,46], [48,8], [-6,-48]]),
    sockets: sockets([
      ['floor',-44,0,-28], ['floor',-28,0,-42], ['floor',4,0,-34], ['floor',46,0,-8],
      ['floor',48,0,32], ['floor',-44,0,26], ['floor',-16,0,18], ['floor',-28,0,38],
      ['floor',-2,0,0], ['floor',24,0,8], ['courtyard',18,7,4], ['courtyard',32,7,12],
      ['floor',-44,0,-8], ['floor',-46,0,46], ['floor',-22,0,0], ['floor',-20,0,-20],
      ['floor',10,0,-48], ['floor',34,0,-46], ['floor',4,0,44], ['floor',-18,0,46],
      ['floor',46,0,48], ['floor',0,0,24], ['courtyard',14,7,16], ['courtyard',34,7,0],
    ]),
    routes: [
      { id:'courtyard-south', from:'floor', via:'south-ramp', to:'courtyard' },
      { id:'courtyard-north', from:'floor', via:'north-ramp', to:'courtyard' },
    ],
  },
  frost: {
    id:'frost', revision:'combat-elevation-1', name:'Frost Quarry', environment:'frost', half:60,
    colliders:[floor(), ...perimeter(),
      // Ice is explicitly solid driveable ground, never water inferred from art.
      box('ice-basin', 0, 0.06, 0, 16, 0.06, 12, 'ice', 0.38),
      deck('quarry-shelf', -27, 8, 12, 11, 16, 'slate'),
      ramp('shelf-south-ramp', -27, -20, 12, 32, 8, 0, 'slate'),
      ramp('shelf-north-ramp', -27, 40, 12, 24, 8, Math.PI, 'slate'),
      // Bridge crosses the rink. Separate finite underside allows a lower route.
      deck('quarry-bridge', -2, 8, 16, 14, 5, 'steel'),
      deck('east-landing', 17, 8, 16, 5, 8, 'slate'),
      ramp('east-ramp', 17, 38, 10, 28, 8, Math.PI, 'slate'),
      // Optional takeoff over the rink edge; the level ground at either side
      // stays available. No jump key or mandatory lap route is introduced.
      ramp('quarry-kicker', 2, -20, 8, 12, 2, 0, 'slate'),
      box('shelf-pier-a', -35, 3.6, 3, 1, 3.6, 1, 'slate'),
      box('shelf-pier-b', -35, 3.6, 23, 1, 3.6, 1, 'slate'),
      box('landing-pier', 20, 3.6, 16, 0.8, 3.6, 0.8, 'steel'),
      box('rock-north', 38, 2.8, 32, 5, 2.8, 6, 'slate'),
      box('rock-south', 25, 2.4, -28, 6, 2.4, 4, 'slate'),
      box('rock-west', -44, 3, -26, 3, 3, 5, 'slate'),
      box('crane-foot', 44, 2, 2, 3, 2, 3, 'steel'),
    ],
    spawns:groundSpawns([[-48,-44],[44,46],[-48,44],[44,-44],[-12,-38],[32,-8],[42,18],[-46,10]]),
    sockets:sockets([
      ['floor',-44,0,-42],['floor',-8,0,-28],['floor',38,0,-42],['floor',48,0,22],
      ['floor',-48,0,34],['floor',6,0,42],['floor',32,0,46],['floor',-4,0,22],
      ['ice-basin',-8,0.12,-4],['ice-basin',8,0.12,6],['quarry-shelf',-30,8,12],
      ['quarry-bridge',0,8,16],['east-landing',17,8,16],
      ['floor',-50,0,0],['floor',-10,0,34],['floor',2,0,-44],['floor',38,0,-16],
      ['floor',44,0,6],['floor',46,0,46],['floor',-44,0,48],['floor',-20,0,-12],
      ['quarry-shelf',-25,8,3],['quarry-shelf',-25,8,25],
      ['quarry-bridge',-10,8,16],['east-landing',16,8,20],
    ]),
    routes:[
      {id:'shelf-south',from:'floor',via:'shelf-south-ramp',to:'quarry-shelf'},
      {id:'shelf-north',from:'floor',via:'shelf-north-ramp',to:'quarry-shelf'},
      {id:'landing-north',from:'floor',via:'east-ramp',to:'east-landing'},
    ],
  },
  neon: {
    id:'neon', revision:'combat-elevation-1', name:'Neon Harbor', environment:'harbor', half:60,
    colliders:[floor(),...perimeter(),
      deck('loading-deck', 22, 6, 14, 14, 14, 'steel'),
      ramp('harbor-south-ramp', 14, -12, 10, 24, 6, 0, 'steel'),
      ramp('harbor-north-ramp', 30, 40, 10, 24, 6, Math.PI, 'steel'),
      ...[[10,2],[34,2],[10,26],[34,26]].map(([x,z],i)=>box(`loading-pier-${i}`,x,2.6,z,0.8,2.6,0.8,'steel')),
      // Asymmetric cargo cover creates flanks and clear rocket sightlines.
      box('cargo-west-a',-32,2.5,16,5,2.5,3,'cargo-teal'),
      box('cargo-west-b',-24,2.5,26,3,2.5,5,'cargo-orange'),
      box('cargo-south',-10,2.5,-26,7,2.5,3,'cargo-teal'),
      box('cargo-east',44,2.5,-26,4,2.5,5,'cargo-orange'),
      box('cargo-north',-8,2.5,42,4,2.5,3,'cargo-orange'),
      box('dock-bollard',-42,0.9,-4,1,0.9,1,'steel'),
    ],
    spawns:groundSpawns([[-46,-44],[44,46],[-46,42],[46,-44],[-34,-18],[-12,26],[48,12],[0,-46]]),
    sockets:sockets([
      ['floor',-44,0,-32],['floor',-20,0,-44],['floor',4,0,-28],['floor',38,0,-12],
      ['floor',48,0,32],['floor',-44,0,28],['floor',-10,0,12],['floor',-28,0,44],
      ['floor',-2,0,-6],['floor',22,0,14],['loading-deck',14,6,10],['loading-deck',30,6,20],
      ['floor',-44,0,4],['floor',-44,0,48],['floor',-24,0,-8],['floor',-26,0,-34],
      ['floor',8,0,-44],['floor',34,0,-44],['floor',2,0,44],['floor',-18,0,34],
      ['floor',44,0,44],['floor',-6,0,28],['loading-deck',16,6,24],['loading-deck',30,6,4],
    ]),
    routes:[
      {id:'loading-south',from:'floor',via:'harbor-south-ramp',to:'loading-deck'},
      {id:'loading-north',from:'floor',via:'harbor-north-ramp',to:'loading-deck'},
    ],
  },
  harbor: {
    id:'harbor', revision:'combat-elevation-1', name:'Harbor Heights', environment:'harbor', half:86,
    colliders:[floor(86),...perimeter(86),
      // Three upper fighting areas are joined by finite bridge spans. The
      // clear road at z=20 crosses below all five decks, not a painted tunnel.
      deck('upper-dock',0,7,20,23,16,'steel'),
      deck('west-span',-37,7,20,14,7,'steel'),
      deck('west-balcony',-61,7,20,10,17,'steel'),
      deck('east-span',37,7,20,14,7,'steel'),
      deck('east-balcony',61,7,20,10,17,'steel'),
      // Opposite dock approaches and flank climbs make two open loops. Wide
      // smooth wedges meet the exact deck edges without invisible steps.
      ramp('dock-south-climb',-16,-16,14,40,7,0,'steel'),
      ramp('dock-north-climb',16,56,14,40,7,Math.PI,'steel'),
      ramp('west-climb',-61,-17,14,40,7,0,'steel'),
      ramp('east-climb',61,57,14,40,7,Math.PI,'steel'),
      // Optional supported takeoff drops from the east balcony onto the clear
      // lower apron. Every other ascent remains an ordinary driveable bypass.
      {...ramp('balcony-kicker',61,9,10,12,1.7,Math.PI,'steel'),
        position:{x:61,y:7+1.7/2,z:9}},
      ...[[-20,7],[20,7],[-20,33],[20,33],[-47,14],[-47,26],[47,14],[47,26]]
        .map(([x,z],i)=>box(`dock-pier-${i}`,x,3.1,z,1.1,3.1,1.1,'steel')),
      // A few cargo/warehouse masses provide shelter and short-range flanks.
      // These are the entire solid envelope; scenery must stay inside it.
      box('warehouse-west',-36,3,-35,10,3,8,'cargo-teal'),
      box('cargo-west-north',-38,2.7,55,8,2.7,5,'cargo-orange'),
      box('cargo-east-south',37,2.7,-40,8,2.7,5,'cargo-orange'),
      box('cargo-east-north',44,2.7,56,5,2.7,8,'cargo-teal'),
      box('cargo-centre',0,1.6,-18,4,1.6,5,'cargo-teal'),
      box('dock-cover-west',-8,8.8,30,3,1.8,2,'cargo-orange'),
      box('dock-cover-east',8,8.8,10,3,1.8,2,'cargo-teal'),
    ],
    spawns:groundSpawns([[-66,-66],[76,66],[-66,66],[66,-66],[-4,-68],[4,68],[-74,-8],[74,-8]]),
    sockets:sockets([
      ['floor',-64,0,-50],['floor',-48,0,-66],['floor',28,0,-64],['floor',66,0,-48],
      ['floor',-66,0,52],['floor',76,0,48],['floor',0,0,60],['floor',44,0,70],
      ['floor',-74,0,20],['floor',74,0,20],
      ['floor',-36,0,-20],['floor',-50,0,-34],['floor',32,0,46],['floor',30,0,-28],
      ['floor',0,0,20],['floor',-37,0,20],['floor',37,0,20],['floor',-61,0,20],
      ['upper-dock',-12,7,16],['upper-dock',12,7,26],
      ['west-span',-37,7,20],['east-span',37,7,20],
      ['west-balcony',-61,7,24],['east-balcony',61,7,26],
    ]),
    routes:[
      {id:'dock-south',from:'floor',via:'dock-south-climb',to:'upper-dock'},
      {id:'dock-north',from:'floor',via:'dock-north-climb',to:'upper-dock'},
      {id:'west-flank',from:'floor',via:'west-climb',to:'west-balcony'},
      {id:'east-flank',from:'floor',via:'east-climb',to:'east-balcony'},
    ],
  },
};

export const elevatedMapIds = Object.freeze(Object.keys(MAPS));
export function elevatedMap(id) {
  if (!Object.hasOwn(MAPS,id)) throw new RangeError(`Unknown elevated combat map: ${id}`);
  return structuredClone(MAPS[id]);
}
