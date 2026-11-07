'use strict';
/* Kart wire schema for the real-time layer (server/realtime.js). These are
 * the per-tick motion fields of a public kart view; everything else about a
 * kart (health, weapon, timers) rides the JSON delta. Precision: positions
 * float32, rotation unit quaternion in int16, velocities 1 cm/s, yaw ~1e-4.
 * 75 bytes per kart against about 1.4 KB as JSON. */
const KART_STREAM = Object.freeze({
  path: 'karts',
  key: 'pid',
  fields: [
    ['motionIntent.steer', 'i8', 1 / 127],
    ['motionIntent.throttle', 'i8', 1 / 127],
    [['motionIntent.drift', 'motionIntent.nitro', 'physicalPose.grounded'], 'bits'],
    ['physicalPose.position.x', 'f32'], ['physicalPose.position.y', 'f32'], ['physicalPose.position.z', 'f32'],
    ['physicalPose.rotation', 'quat'],
    ['physicalPose.linearVelocity.x', 'i16', 0.01], ['physicalPose.linearVelocity.y', 'i16', 0.01], ['physicalPose.linearVelocity.z', 'i16', 0.01],
    ['physicalPose.angularVelocity.x', 'i16', 0.001], ['physicalPose.angularVelocity.y', 'i16', 0.001], ['physicalPose.angularVelocity.z', 'i16', 0.001],
    ['physicalPose.epoch', 'u32'],
    ['physicalPose.speed', 'i16', 0.01],
    // Wheels are visual: 2.5 mm travel, spin mod 2 pi, 5 mrad steering.
    ['physicalPose.wheels', 'list', { count: 4, fields: [['length', 'u8', 0.0025], ['rotation', 'angle'], ['steering', 'i8', 0.005]] }],
    ['x', 'f32'], ['z', 'f32'],
    ['angle', 'i16', Math.PI / 32767],
    ['speed', 'i16', 0.01], ['vx', 'i16', 0.01], ['vz', 'i16', 0.01],
    ['slip', 'i16', 0.001],
  ],
});

module.exports = { KART_STREAM };
