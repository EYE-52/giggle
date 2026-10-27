// Shared numeric configuration for the elevated kart authority and renderer.
// Muzzle coordinates are chassis-local. +Y up, nose +Z.
export const KART_PHYSICS_CONFIG = Object.freeze({
  version: 1,
  fixedDt: 1 / 60,
  gravity: Object.freeze({ x: 0, y: -18, z: 0 }),
  maxKarts: 8,
  maxStatics: 128,
  chassis: Object.freeze({
    half: Object.freeze({ x: 1.22, y: 0.26, z: 1.55 }),
    mass: 120,
    centerOfMassY: -0.12,
    // The engine, driver and wheels spread yaw inertia beyond a uniform
    // thin box. This keeps a high-speed bumper corner hit recoverable.
    yawInertiaScale: 2,
    linearDamping: 0.15,
    angularDamping: 2.2,
    // Modest solver restitution lets bumpers rebound and transfer momentum
    // without inventing a velocity kick in the renderer. Fence friction is
    // lower than road friction; tyre grip stays in the wheel controller.
    friction: 0.45,
    restitution: 0.15,
    modelOriginY: -0.70,
  }),
  suspension: Object.freeze({
    restLength: 0.30,
    maxTravel: 0.24,
    stiffness: 65,
    compression: 7,
    relaxation: 9,
    maxForce: 10000,
    frictionSlip: 2.2,
    sideStiffness: 1,
  }),
  handling: Object.freeze({
    engineForce: 1000,
    maxForward: 26,
    maxReverse: 5,
    steering: 0.43,
    highSpeedSteer: 0.055,
    brake: 22,
    coastBrake: 0.45,
  }),
  combat: Object.freeze({
    pulseMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
    rocketMuzzle: Object.freeze({ x: -0.95, y: 0.50, z: 1.90 }),
    seekerMuzzle: Object.freeze({ x: -0.95, y: 0.50, z: 1.90 }),
    scatterMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
    railMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
    grenadeMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
    empMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
  }),
  wheels: Object.freeze([
    Object.freeze({ x: -1.05, y: -0.015, z: 1.02, radius: 0.385, front: 1 }),
    Object.freeze({ x: 1.05, y: -0.015, z: 1.02, radius: 0.385, front: 1 }),
    Object.freeze({ x: -1.05, y: 0.065, z: -0.92, radius: 0.465, front: 0 }),
    Object.freeze({ x: 1.05, y: 0.065, z: -0.92, radius: 0.465, front: 0 }),
  ]),
});

export default KART_PHYSICS_CONFIG;
