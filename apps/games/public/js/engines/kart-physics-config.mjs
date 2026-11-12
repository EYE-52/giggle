import {CURATED_MUZZLE} from './kart-weapon-contract.mjs';
// Shared numeric configuration for classic/elevated authority and prediction.
// Muzzle coordinates are chassis-local. +Y up, nose +Z.
export const KART_PHYSICS_CONFIG = Object.freeze({
  version: 1,
  fixedDt: 1 / 60,
  gravity: Object.freeze({ x: 0, y: -18, z: 0 }),
  maxKarts: 32,
  additionalSolverIterations: 4,
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
    // Raised boxes have driveable tops AND vertical sides. Wheel grip is
    // independent; low rigid-hull friction lets bumpers slide along walls.
    wallFriction: 0.04,
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
    // Grip supports the sharper front wheels without full-lock understeer.
    frictionSlip: 3,
    sideStiffness: 1,
  }),
  handling: Object.freeze({
    engineForce: 1000,
    // Extra pull fades out before cruise; forward/Nitro speed caps stay put.
    launchBoost: 1.8,
    directionChangeBrake: .9,
    launchSpeed: 20,
    maxForward: 26,
    maxReverse: 8,
    steering: 0.56,
    highSpeedSteer: 0.045,
    brake: 22,
    coastBrake: 0.45,
  }),
  combat: Object.freeze({
    machinegunMuzzle: CURATED_MUZZLE, trishotMuzzle: CURATED_MUZZLE, missileMuzzle: CURATED_MUZZLE, cannonMuzzle: CURATED_MUZZLE,
    pulseMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
    rocketMuzzle: Object.freeze({ x: -0.95, y: 0.50, z: 1.90 }),
    seekerMuzzle: Object.freeze({ x: -0.95, y: 0.50, z: 1.90 }),
    scatterMuzzle: Object.freeze({ x: 0.95, y: 0.50, z: 1.90 }),
  }),
  wheels: Object.freeze([
    Object.freeze({ x: -1.05, y: -0.015, z: 1.02, radius: 0.385, front: 1 }),
    Object.freeze({ x: 1.05, y: -0.015, z: 1.02, radius: 0.385, front: 1 }),
    Object.freeze({ x: -1.05, y: 0.065, z: -0.92, radius: 0.465, front: 0 }),
    Object.freeze({ x: 1.05, y: 0.065, z: -0.92, radius: 0.465, front: 0 }),
  ]),
});

export default KART_PHYSICS_CONFIG;

// Shipped classic arenas opt into the arcade bumper response. The elevated
// development profile keeps its established deck/landing contact envelopes.
export const CLASSIC_CONTACT_TUNING=Object.freeze({
  friction:.16,restitution:.20,wallFriction:.06,separationSpeed:.8,maxSpin:3,
});
