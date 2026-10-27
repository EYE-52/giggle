// Explicit diagnostic geometry, not one of the production combat maps.
export const PROTOTYPE_SOLIDS = [
  { id: 'floor', shape: 'box', half: { x: 36, y: 0.5, z: 48 }, position: { x: 0, y: -0.5, z: 0 } },
  { id: 'ramp-up', shape: 'wedge', half: { x: 5, y: 2, z: 8 }, position: { x: 0, y: 2, z: 0 } },
  { id: 'bridge', shape: 'deck', half: { x: 5, y: 0.35, z: 5 }, position: { x: 0, y: 3.65, z: 13 } },
  { id: 'ramp-down', shape: 'wedge', half: { x: 5, y: 2, z: 8 }, position: { x: 0, y: 2, z: 26 }, rotation: { x: 0, y: 1, z: 0, w: 0 } },
  { id: 'jump-ramp', shape: 'wedge', half: { x: 4, y: 1.5, z: 6 }, position: { x: 18, y: 1.5, z: 0 } },
  { id: 'wall-north', shape: 'box', half: { x: 36, y: 2.5, z: 0.6 }, position: { x: 0, y: 2.5, z: 47 } },
  { id: 'wall-south', shape: 'box', half: { x: 36, y: 2.5, z: 0.6 }, position: { x: 0, y: 2.5, z: -47 } },
  { id: 'wall-west', shape: 'box', half: { x: 0.6, y: 2.5, z: 48 }, position: { x: -35, y: 2.5, z: 0 } },
  { id: 'wall-east', shape: 'box', half: { x: 0.6, y: 2.5, z: 48 }, position: { x: 35, y: 2.5, z: 0 } },
  { id: 'cover', shape: 'box', half: { x: 3, y: 1.4, z: 3 }, position: { x: -17, y: 1.4, z: -2 } },
];

export const PROTOTYPE_SCENES = {
  ramp: { label: 'Ramp → bridge → descent', primary: { x: 0, y: 1, z: -20 }, secondary: { x: -12, y: 1, z: -22 } },
  jump: { label: 'Ramp edge → gravity → landing', primary: { x: 18, y: 1, z: -20 }, secondary: { x: -12, y: 1, z: -22 } },
  underpass: { label: 'Lower and upper bridge layers', primary: { x: -12, y: 1, z: 13 }, primaryRotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, secondary: { x: 0, y: 4.8, z: 13 } },
  contact: { label: 'Two chassis contact', primary: { x: 0, y: 1, z: -27 }, secondary: { x: 0, y: 1, z: -17 }, secondaryRotation: { x: 0, y: 1, z: 0, w: 0 } },
};
