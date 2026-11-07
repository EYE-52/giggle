/* Tyre skid marks: one instanced mesh used as a ring buffer of small dark
 * quads. Each mark records its birth time in an instance attribute and the
 * shader fades it to nothing after SKID_LIFE seconds, so marks always end on
 * their own and nothing is allocated per frame. Presentation only. */
export const SKID_LIMIT = 192;
export const SKID_LIFE = 3.2;
const SPACING = .32; // metres of travel between marks per wheel

const VERTEX = `
attribute float skidBirth;
attribute vec4 skidTint;
varying vec4 vSkidTint;
uniform float skidTime;
varying float vSkidAlpha;
varying vec2 vSkidUv;
void main(){
  float age = skidTime - skidBirth;
  vSkidAlpha = skidBirth < 0.0 ? 0.0 : clamp(1.0 - age / ${SKID_LIFE.toFixed(2)}, 0.0, 1.0);
  vSkidUv = uv;vSkidTint=skidTint;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = `
varying vec4 vSkidTint;
varying float vSkidAlpha;
varying vec2 vSkidUv;
void main(){
  if (vSkidAlpha <= 0.0) discard;
  float edge = 1.0 - smoothstep(.55, 1.0, abs(vSkidUv.x * 2.0 - 1.0));
  gl_FragColor = vec4(vSkidTint.rgb, vSkidAlpha * edge * vSkidTint.a);
}`;

export function createKartSkids(THREE, scene, { groundAt = () => 0 } = {}) {
  const geometry = new THREE.PlaneGeometry(.24, SPACING + .06);
  geometry.rotateX(-Math.PI / 2);
  const births = new Float32Array(SKID_LIMIT).fill(-1);
  const birthAttr = new THREE.InstancedBufferAttribute(births, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('skidBirth', birthAttr);
  const tints=new Float32Array(SKID_LIMIT*4),tintAttr=new THREE.InstancedBufferAttribute(tints,4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('skidTint',tintAttr);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { skidTime: { value: 0 } },
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, SKID_LIMIT);
  mesh.name = 'KartSkidMarks'; mesh.frustumCulled = false; mesh.renderOrder = 2;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const trails = new Map(); // pid -> last mark position per kart (x,z)
  // Visible for the loading warm-up render, then only while marks remain.
  let head = 0, time = 0, disposed = false, dirty = false, lastStamp = -Infinity;
  function stamp(x, z, angle, surface) {
    p.set(x, groundAt(x, z) + .045, z); q.setFromAxisAngle(up, angle);
    matrix.compose(p, q, one); mesh.setMatrixAt(head, matrix);
    const color=surface?.skid??0x14121a,j=head*4;
    tints[j]=((color>>16)&255)/255;tints[j+1]=((color>>8)&255)/255;tints[j+2]=(color&255)/255;tints[j+3]=surface?.opacity??.55;
    births[head] = time; head = (head + 1) % SKID_LIMIT; dirty = true; lastStamp = time;
  }
  // Call each frame per kart with its pose and whether its tyres are sliding.
  function track(pid, x, z, angle, sliding, surface) {
    if (disposed) return;
    let last = trails.get(pid);
    if (!sliding || !Number.isFinite(x) || !Number.isFinite(z)) { if (last) last.on = false; return; }
    if (!last) trails.set(pid, last = { x, z, on: false });
    if (!last.on) { last.x = x; last.z = z; last.on = true; return; }
    const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
    if (d < SPACING) return;
    if (d > 4) { last.x = x; last.z = z; return; } // a respawn or snap: no streak across the map
    const fx = Math.sin(angle), fz = Math.cos(angle), rx = fz, rz = -fx;
    const mx = (x + last.x) / 2 - fx * 1.05, mz = (z + last.z) / 2 - fz * 1.05; // rear axle
    const heading = Math.atan2(dx, dz);
    stamp(mx + rx * 1.02, mz + rz * 1.02, heading, surface);
    stamp(mx - rx * 1.02, mz - rz * 1.02, heading, surface);
    last.x = x; last.z = z;
  }
  function update(dt) {
    if (disposed) return;
    if (Number.isFinite(dt) && dt > 0) time += Math.min(dt, .1);
    material.uniforms.skidTime.value = time;
    mesh.visible = time - lastStamp < SKID_LIFE;
    if (dirty) { mesh.instanceMatrix.needsUpdate = true; birthAttr.needsUpdate = true; tintAttr.needsUpdate = true; dirty = false; }
  }
  function forget(pid) { trails.delete(pid); }
  function reset() { births.fill(-1); birthAttr.needsUpdate = true; trails.clear(); head = 0; lastStamp = -Infinity; mesh.visible = false; }
  function live() { let n = 0; for (const b of births) if (b >= 0 && time - b < SKID_LIFE) n++; return n; }
  function dispose() { if (disposed) return; disposed = true; mesh.removeFromParent(); geometry.dispose(); material.dispose(); trails.clear(); }
  return Object.freeze({ mesh, track, update, forget, reset, live, dispose });
}

// Sliding tyres: an authored drift, a real sideways slide, or hard braking.
// `pose` may carry a predicted physicalPose; `brake` is the local intent.
export function kartSliding(kart, pose, brake = false) {
  if (!kart || kart.respawn > 0 || kart.connected === false) return false;
  if (kart.drifting === true) return true;
  const phys = pose?.physicalPose || kart.physicalPose;
  if (phys && phys.grounded === false) return false;
  const v = phys?.linearVelocity, angle = Number.isFinite(pose?.angle) ? pose.angle : kart.angle;
  if (v && Number.isFinite(angle)) {
    const lateral = Math.abs(v.x * Math.cos(angle) - v.z * Math.sin(angle)), speed = Math.hypot(v.x, v.z);
    if (lateral > 3.2 && speed > 6) return true;
    if (brake && speed > 9) return true;
  } else if (brake && Math.abs(kart.speed || 0) > 9) return true;
  return false;
}
