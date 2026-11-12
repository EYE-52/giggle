import {raisedWedgeVertices} from './kart-raised-support.mjs';

// Rapier adapter for the elevated kart profile.
// Rapier and the one shared numeric config are injected after WASM init.
// Worlds/handles/controllers remain private; all returned poses are plain data.
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function vector(v, name) {
  if (!v || !['x', 'y', 'z'].every((k) => finite(v[k]) && Math.abs(v[k]) <= 1000000)) throw new TypeError(name + ' must be finite and bounded');
  return { x: v.x, y: v.y, z: v.z };
}
function rotation(q = { x: 0, y: 0, z: 0, w: 1 }, normalize = true) {
  if (!['x', 'y', 'z', 'w'].every((k) => finite(q[k]))) throw new TypeError('rotation must be finite');
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (!finite(n) || n < 1e-8) throw new TypeError('rotation must have a finite nonzero length');
  // Authoritative Rapier float32 poses must round-trip without changing a
  // contact's quaternion by one ULP during rewind. Normalize authored inputs,
  // but preserve already-unit solver output and validate it on restoration.
  if(!normalize){
    if(Math.abs(n-1)>1e-4)throw new TypeError('physical rotation must be unit length');
    return {x:q.x,y:q.y,z:q.z,w:q.w};
  }
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
function idValue(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new TypeError('invalid id');
  return id;
}
function forwardSpeed(body) {
  const q = body.rotation(), v = body.linvel();
  return v.x * 2 * (q.x * q.z + q.w * q.y) + v.y * 2 * (q.y * q.z - q.w * q.x) + v.z * (1 - 2 * (q.x * q.x + q.y * q.y));
}
function wedgeVertices(half) {
  const { x, y, z } = vector(half, 'half');
  if (Math.min(x, y, z) <= 0) throw new RangeError('half extents must be positive');
  // Closed triangle prism: low end -Z, high end +Z, solid underside.
  return raisedWedgeVertices({x,y,z});
}
function validateTrimesh(vertices, indices) {
  if (!(vertices instanceof Float32Array) || vertices.length < 9 || vertices.length % 3 || vertices.length > 30000 ||
      !(indices instanceof Uint32Array) || indices.length < 3 || indices.length % 3 || indices.length > 60000) throw new TypeError('invalid bounded trimesh buffers');
  if (!vertices.every(n => finite(n) && Math.abs(n) <= 1000)) throw new RangeError('trimesh vertices must be finite and bounded');
  const count = vertices.length / 3;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (a >= count || b >= count || c >= count || a === b || b === c || a === c) throw new RangeError('invalid trimesh triangle indices');
    const ux = vertices[b*3]-vertices[a*3], uy = vertices[b*3+1]-vertices[a*3+1], uz = vertices[b*3+2]-vertices[a*3+2];
    const vx = vertices[c*3]-vertices[a*3], vy = vertices[c*3+1]-vertices[a*3+1], vz = vertices[c*3+2]-vertices[a*3+2];
    if (Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) < 1e-10) throw new RangeError('degenerate trimesh triangle');
  }
}
function createKartPhysics(RAPIER, config) {
  if (!RAPIER?.World || !config || config.wheels?.length !== 4) throw new TypeError('initialized Rapier and four-wheel config required');
  const C = structuredClone(config);
  if (!finite(C.fixedDt) || C.fixedDt <= 0 || C.fixedDt > 0.04) throw new RangeError('invalid fixed step');
  const numeric = value => typeof value === 'object' && value !== null ? Object.values(value).every(numeric) : finite(value);
  if (!numeric(C) || !Number.isInteger(C.maxKarts) || C.maxKarts < 1 || C.maxKarts > 32 || !Number.isInteger(C.maxStatics) || C.maxStatics < 1 || C.maxStatics > 128 || C.chassis.mass <= 0 || Object.values(C.chassis.half).some(v => v <= 0) || C.wheels.some(w => w.radius <= 0)) throw new RangeError('invalid numeric vehicle config');
  const world = new RAPIER.World(vector(C.gravity, 'gravity'));
  world.timestep = C.fixedDt;
  // Preserve the existing contact/CCD envelope with the stronger launch.
  world.numSolverIterations = 8;
  world.maxCcdSubsteps = 2;
  const karts = new Map(), statics = new Map(), surfaces = new Map(), kartColliders = new Map(),driveSurfaces=new Set();
  const contactQueue = new RAPIER.EventQueue(true), impacts = [];
  let disposed = false, tick = 0;
  function alive() { if (disposed) throw new Error('physics world disposed'); }
  function kartFor(id) {
    alive();
    const kart = karts.get(id);
    if (!kart) throw new Error('unknown kart ' + id);
    return kart;
  }
  function makeController(body) {
    const v = world.createVehicleController(body);
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2; // This is the actual 0.21.0 setter name.
    for (const w of C.wheels) {
      v.addWheel({ x: w.x, y: w.y, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, C.suspension.restLength, w.radius);
    }
    for (let i = 0; i < 4; i++) {
      v.setWheelMaxSuspensionTravel(i, C.suspension.maxTravel);
      v.setWheelSuspensionStiffness(i, C.suspension.stiffness);
      v.setWheelSuspensionCompression(i, C.suspension.compression);
      v.setWheelSuspensionRelaxation(i, C.suspension.relaxation);
      v.setWheelMaxSuspensionForce(i, C.suspension.maxForce);
      v.setWheelFrictionSlip(i, C.suspension.frictionSlip);
      v.setWheelSideFrictionStiffness(i, C.suspension.sideStiffness);
    }
    return v;
  }
  function addStatic(desc) {
    alive();
    const id = idValue(desc?.id);
    if (statics.has(id)) throw new Error('duplicate static id');
    if (statics.size >= C.maxStatics) throw new RangeError('static limit');
    if (!['box', 'wedge', 'deck', 'trimesh'].includes(desc.shape)) throw new TypeError('unsupported static shape');
    const mesh = desc.shape === 'trimesh';
    const half = mesh ? null : vector(desc.half, 'half'), position = vector(desc.position, 'position'), q = rotation(desc.rotation);
    if (mesh) validateTrimesh(desc.vertices, desc.indices);
    else if (Math.min(half.x, half.y, half.z) <= 0 || Math.max(half.x, half.y, half.z) > 1000) throw new RangeError('invalid half extents');
    const grip = desc.grip === undefined ? 1 : desc.grip;
    if (!finite(grip) || grip <= 0 || grip > 2) throw new RangeError('invalid grip');
    let d = mesh ? RAPIER.ColliderDesc.trimesh(desc.vertices, desc.indices, RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES || 0) :
      desc.shape === 'wedge' ? RAPIER.ColliderDesc.convexHull(wedgeVertices(half)) : RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
    if (!d) throw new Error('invalid convex wedge');
    const driveSurface = mesh || desc.shape === 'wedge' || desc.shape === 'deck' || id === 'floor' || desc.grip !== undefined;
    d.setTranslation(position.x, position.y, position.z).setRotation(q)
      .setFriction(C.arcadeContacts?(driveSurface?0.7:C.arcadeContacts.wallFriction):C.chassis.wallFriction??0.25)
      .setFrictionCombineRule(C.arcadeContacts||C.chassis.wallFriction!==undefined?RAPIER.CoefficientCombineRule.Min:RAPIER.CoefficientCombineRule.Average)
      .setRestitution(driveSurface ? 0 : C.chassis.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
    const collider = world.createCollider(d);
    const data = { id, shape: desc.shape, half, position, rotation: q, grip };
    statics.set(id, data);
    surfaces.set(collider.handle, data);
    if(driveSurface)driveSurfaces.add(collider.handle);
    return structuredClone(data);
  }
  function addKart(id, spawn) {
    alive(); idValue(id);
    if (karts.has(id)) throw new Error('duplicate kart id');
    if (karts.size >= C.maxKarts) throw new RangeError('kart limit');
    const p = vector(spawn?.position, 'position'), q = rotation(spawn.rotation), H = C.chassis.half;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(q)
      .setLinearDamping(C.chassis.linearDamping).setAngularDamping(C.chassis.angularDamping).setCcdEnabled(true).setSoftCcdPrediction(C.softCcdPrediction || 0).setAdditionalSolverIterations(4));
    try {
      const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(H.x, H.y, H.z).setMassProperties(C.chassis.mass,
        { x: 0, y: C.chassis.centerOfMassY, z: 0 },
        { x: C.chassis.mass / 3 * (H.y ** 2 + H.z ** 2), y: C.chassis.mass / 3 * (H.x ** 2 + H.z ** 2) * (C.chassis.yawInertiaScale || 1), z: C.chassis.mass / 3 * (H.x ** 2 + H.y ** 2) },
        { x: 0, y: 0, z: 0, w: 1 }).setFriction(C.chassis.friction).setRestitution(C.chassis.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFrictionCombineRule(C.arcadeContacts||C.chassis.wallFriction!==undefined?RAPIER.CoefficientCombineRule.Min:RAPIER.CoefficientCombineRule.Average)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(6000), body);
      kartColliders.set(collider.handle,id);
      karts.set(id, { body, controller: makeController(body), intent: { steer: 0, throttle: 0, brake: 0 }, epoch: 0,
        collider,enabled: true, frozen: false, slide: null, tuning: { top: 1, engine: 1, steering: 1, traction: 1, rearTraction: 1, rearStiffness:1 } });
      const kart=karts.get(id);
      kart.checkManifold=manifold=>{if(manifold.numSolverContacts()>0&&Math.abs(manifold.normal().y)<.5)kart.sideContact=true;};
      kart.checkContact=other=>world.contactPair(collider,other,kart.checkManifold);
      kart.slideWall=manifold=>{
        if(!manifold.numSolverContacts())return;const n=manifold.normal();if(Math.abs(n.y)>.4)return;
        const norm=Math.hypot(n.x,n.z);if(norm<.5)return;const nx=n.x/norm,nz=n.z/norm,incoming=kart.contactVelocity.linear;
        const normalSpeed=incoming.x*nx+incoming.z*nz,tx=incoming.x-normalSpeed*nx,tz=incoming.z-normalSpeed*nz,speed=Math.hypot(tx,tz);
        if(speed<1.2)return;const v=body.linvel(),along=(v.x*tx+v.z*tz)/speed,target=Math.min(6,speed*.985);
        if(along<target){const extra=target-along;body.setLinvel({x:v.x+tx/speed*extra,y:v.y,z:v.z+tz/speed*extra},true);}
        // A glancing bumper should not yaw itself squarely into the wall.
        // Steering still has full control; never invent motion from rest.
        if(Math.abs(kart.intent.steer)<.1){const a=body.angvel();body.setAngvel({x:a.x,y:a.y*.25,z:a.z},true);}
      };
      kart.wallContact=other=>{if(surfaces.has(other.handle))world.contactPair(collider,other,kart.slideWall);};
    } catch (error) { world.removeRigidBody(body); throw error; }
    return pose(id);
  }
  function resetKart(id, spawn) {
    const kart = kartFor(id), p = vector(spawn?.position, 'position'), q = rotation(spawn.rotation);
    world.removeVehicleController(kart.controller);
    kart.body.setTranslation(p, true); kart.body.setRotation(q, true);
    kart.body.setLinvel({ x: 0, y: 0, z: 0 }, true); kart.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    kart.body.resetForces(true); kart.body.resetTorques(true);
    kart.controller = makeController(kart.body);
    kart.intent = { steer: 0, throttle: 0, brake: 0 }; kart.epoch++;
    kart.slide=null;
    world.propagateModifiedBodyPositionsToColliders();
    return pose(id);
  }
  function restoreKart(id, data) {
    const kart=kartFor(id),p=vector(data.position,'corrected position'),q=rotation(data.rotation,false),v=vector(data.linearVelocity,'corrected velocity'),a=vector(data.angularVelocity,'corrected angular velocity');
    if(Number.isSafeInteger(data.epoch)&&data.epoch>=0)kart.epoch=data.epoch;
    kart.body.setTranslation(p,true);kart.body.setRotation(q,true);kart.body.setLinvel(v,true);kart.body.setAngvel(a,true);world.propagateModifiedBodyPositionsToColliders();
  }
  function applyIntent(id, input) {
    const kart = kartFor(id);
    if (!kart.enabled || kart.frozen) return false;
    if (!input || !finite(input.steer) || !finite(input.throttle) || (input.brake !== undefined && !finite(input.brake))) return false;
    kart.intent = { steer: clamp(input.steer, -1, 1), throttle: clamp(input.throttle, -1, 1), brake: clamp(input.brake || 0, 0, 1) };
    if (kart.intent.throttle || kart.intent.steer || kart.intent.brake) kart.body.wakeUp();
    return true;
  }
  function step(count = 1) {
    alive();
    if (!Number.isInteger(count) || count < 1 || count > 15) throw new RangeError('step count must be 1..15');
    for (let n = 0; n < count; n++) {
      for (const kart of karts.values()) {
        if (!kart.enabled || kart.frozen) continue;
        // Sample real incoming motion before engine/wheel impulses. Throttle
        // into a resting fence can create a large attempted solver force,
        // especially with Garage/nitro, without being another collision.
        kart.contactVelocity = {linear:kart.body.linvel(),angular:kart.body.angvel(),position:kart.body.translation()};
        const v = kart.controller, { steer, throttle, brake } = kart.intent;
        const speed = forwardSpeed(kart.body);
        const opposing = throttle * speed < -0.2;
        const top = (throttle < 0 ? C.handling.maxReverse : C.handling.maxForward) * kart.tuning.top;
        // Build pull once rolling; a kart held against cover keeps its original
        // torque rather than forcing the hull upward with the launch assist.
        // Partial stick input adds a gentler share of the launch punch.
        const launch = 1 + ((C.handling.launchBoost || 1) - 1) * Math.abs(throttle) * Math.min(1, Math.abs(speed) / 2) * Math.max(0, 1 - Math.abs(speed) / (C.handling.launchSpeed || 20));
        // Nitro already supplies its own punch; stacking both can lift the nose.
        const engine = Math.max(kart.tuning.engine, Math.min(C.handling.launchBoost || 1, kart.tuning.engine * launch));
        const force = opposing ? 0 : throttle * C.handling.engineForce * engine * Math.max(0, 1 - (Math.abs(speed) / top) ** 2);
        for (let i = 0; i < 4; i++) {
          const surface = surfaces.get(v.wheelGroundObject(i)?.handle);
          v.setWheelFrictionSlip(i, C.suspension.frictionSlip * (surface?.grip || 1) * kart.tuning.traction * (C.wheels[i].front ? 1 : kart.tuning.rearTraction));
          v.setWheelSideFrictionStiffness(i,C.suspension.sideStiffness*(C.wheels[i].front?1:kart.tuning.rearStiffness));
          v.setWheelSteering(i, C.wheels[i].front ? -steer * C.handling.steering * kart.tuning.steering / (1 + Math.abs(speed) * C.handling.highSpeedSteer) : 0);
          v.setWheelEngineForce(i, force);
          v.setWheelBrake(i, Math.max(brake, opposing ? 0.9 : 0) * C.handling.brake + (throttle === 0 ? C.handling.coastBrake : 0));
        }
        // Only authored driveable statics support suspension, never another kart.
        v.updateVehicle(C.fixedDt, undefined, undefined, (collider) => C.arcadeContacts?driveSurfaces.has(collider.handle):surfaces.has(collider.handle));
        applyArcadeSlide(kart);
      }
      world.step(contactQueue); tick++;
      for(const kart of karts.values())retainSlideMomentum(kart);
      if(!C.arcadeContacts&&C.chassis.wallFriction!==undefined)for(const kart of karts.values())if(kart.enabled&&!kart.frozen&&kart.intent.throttle>0)world.contactPairsWith(kart.collider,kart.wallContact);
      contactQueue.drainContactForceEvents(event => {
        const a=event.collider1(),b=event.collider2(),ka=kartColliders.get(a),kb=kartColliders.get(b);
        if(!ka&&!kb)return;
        const force=event.totalForceMagnitude(),normal=vector(event.maxForceDirection(),'contact normal');
        if(!finite(force)||force<6000)return;
        let point=null;
        world.contactPair(world.getCollider(a),world.getCollider(b),manifold=>{
          if(!point&&manifold.numSolverContacts()>0)point=manifold.solverContactPoint(0);
        });
        if(!point)return;
        // Contact force includes sustained pressure against a fence. Only
        // incoming motion at the contact point is an impact; holding gas
        // into a wall must not play a crash on every solver step.
        const contactSpeed=id=>{
          const k=karts.get(id),v=k?.enabled&&k.contactVelocity;
          if(!v)return 0;
          const r={x:point.x-v.position.x,y:point.y-v.position.y,z:point.z-v.position.z},a=v.angular;
          return (v.linear.x+a.y*r.z-a.z*r.y)*normal.x+
            (v.linear.y+a.z*r.x-a.x*r.z)*normal.y+(v.linear.z+a.x*r.y-a.y*r.x)*normal.z;
        };
        const closingSpeed=Math.abs(contactSpeed(ka)-contactSpeed(kb));
        if(closingSpeed<.75)return;
        if(C.arcadeContacts)separateImpact(ka,kb,normal,point,closingSpeed);
        impacts.push({tick,ids:[ka,kb].filter(Boolean),surfaceId:surfaces.get(a)?.id||surfaces.get(b)?.id||null,
          position:vector(point,'contact point'),normal,impulse:Math.min(4000,force*C.fixedDt)});
        if(impacts.length>24)impacts.shift();
      });
      for (const id of karts.keys()) pose(id); // Fail immediately on non-finite physics.
    }
    return tick;
  }
  // Bounded arcade steering assist, before the solver: walls and other
  // chassis still own contact resolution. Retain momentum with a bounded
  // throttle assist, so the nose leads the path and the tail steps outward.
  const slideVelocity={x:0,y:0,z:0},slideAngular={x:0,y:0,z:0},separation={x:0,y:0,z:0};
  function arcadeSlide(id,slide) {kartFor(id).slide=slide;}
  function applyArcadeSlide(kart) {
    kart.slideSpeed=0;
    const slide=kart.slide,v=kart.body.linvel();
    if(!slide?.active||!kart.controller.wheelIsInContact(0)&&!kart.controller.wheelIsInContact(1))return;
    const incoming=kart.contactVelocity.linear;
    const speed=Math.min(C.handling.maxForward*kart.tuning.top,Math.max(Math.hypot(v.x,v.z),Math.hypot(incoming.x,incoming.z)*Math.exp(-.04*C.fixedDt)+Math.max(0,kart.intent.throttle)*3*C.fixedDt));if(speed<6)return;
    kart.slideSpeed=speed;
    const q=kart.body.rotation(),angle=Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
    const d=slide.direction,turn=d*clamp(.62+.38*kart.intent.steer*d,.24,1);
    const a=kart.body.angvel(),targetYaw=-turn*(1.3+1.05*Math.min(1,speed/20))*Math.min(1,Math.sqrt(slide.traction));
    slideAngular.x=a.x;slideAngular.y=a.y+(targetYaw-a.y)*(1-Math.exp(-16*C.fixedDt));slideAngular.z=a.z;
    kart.body.setAngvel(slideAngular,true);
    const desired=angle+d*(.22+.10*Math.abs(turn))*slide.ease;
    const heading=Math.atan2(v.x,v.z),error=Math.atan2(Math.sin(desired-heading),Math.cos(desired-heading));
    const next=heading+error*(1-Math.exp(-8*slide.traction*C.fixedDt));
    slideVelocity.x=Math.sin(next)*speed;slideVelocity.y=v.y;slideVelocity.z=Math.cos(next)*speed;
    kart.body.setLinvel(slideVelocity,true);
  }
  function retainSlideMomentum(kart) {
    if(!kart.enabled||!kart.slideSpeed)return;
    kart.sideContact=false;world.contactPairsWith(kart.collider,kart.checkContact);
    if(kart.sideContact)return; // A drift never masks a bumper or wall impact.
    const v=kart.body.linvel(),speed=Math.hypot(v.x,v.z),target=kart.slideSpeed*Math.exp(-.04*C.fixedDt);
    if(speed<1||speed>=target)return;
    slideVelocity.x=v.x*target/speed;slideVelocity.y=v.y;slideVelocity.z=v.z*target/speed;kart.body.setLinvel(slideVelocity,true);
  }
  // A short impulse only on a real incoming side impact. No cooldown or
  // hidden pair history: rewind/prediction can reproduce it from the pose.
  // Floor/landing contacts stay entirely in the suspension solver.
  function separateImpact(ka,kb,normal,point,closing) {
    if(Math.abs(normal.y)>.4)return;
    const a=karts.get(ka||kb),b=ka&&kb?karts.get(kb):null;
    if(!a?.enabled||a.frozen||b?.frozen)return;
    limitContactSpin(a);if(b)limitContactSpin(b);
    const pa=a.body.translation(),pb=b?b.body.translation():point;
    let nx=normal.x,nz=normal.z;const len=Math.hypot(nx,nz);if(len<.5)return;
    nx/=len;nz/=len;if((pa.x-pb.x)*nx+(pa.z-pb.z)*nz<0){nx=-nx;nz=-nz;}
    const av=a.body.linvel(),bv=b?.body.linvel();
    const outgoing=(av.x-(bv?.x||0))*nx+(av.z-(bv?.z||0))*nz;
    const extra=Math.min(C.arcadeContacts.separationSpeed,Math.max(0,Math.min(2.4,closing*.2)-outgoing));
    if(extra<=0)return;
    const impulse=extra*C.chassis.mass/(b?2:1);
    separation.x=nx*impulse;separation.y=0;separation.z=nz*impulse;a.body.applyImpulse(separation,true);
    if(b){separation.x=-separation.x;separation.z=-separation.z;b.body.applyImpulse(separation,true);}
  }
  function limitContactSpin(kart) {
    const a=kart.body.angvel();
    if(Math.abs(a.y)<=C.arcadeContacts.maxSpin)return;
    slideAngular.x=a.x;slideAngular.y=clamp(a.y,-C.arcadeContacts.maxSpin,C.arcadeContacts.maxSpin);slideAngular.z=a.z;
    kart.body.setAngvel(slideAngular,true);
  }
  function pose(id) {
    const kart = kartFor(id), v = kart.controller;
    const position = vector(kart.body.translation(), 'body position'), q = rotation(kart.body.rotation(),false);
    const linearVelocity = vector(kart.body.linvel(), 'body velocity'), angularVelocity = vector(kart.body.angvel(), 'angular velocity');
    const wheels = C.wheels.map((w, i) => {
      const contact = kart.enabled && !kart.frozen && v.wheelIsInContact(i), length = v.wheelSuspensionLength(i), spin = v.wheelRotation(i), steer = v.wheelSteering(i);
      if (![length, spin, steer].every(finite)) throw new Error('non-finite wheel state');
      return { contact, length, rotation: spin, steering: steer, surfaceId: contact ? surfaces.get(v.wheelGroundObject(i)?.handle)?.id || null : null };
    });
    return { id, tick, epoch: kart.epoch, position, rotation: q, linearVelocity, angularVelocity, speed: forwardSpeed(kart.body), grounded: wheels.some((w) => w.contact), wheels };
  }
  function poses() { alive(); return [...karts.keys()].map(pose); }
  function halt(kart) {
    kart.intent = { steer: 0, throttle: 0, brake: 0 };
    kart.body.setLinvel({ x: 0, y: 0, z: 0 }, true); kart.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    kart.body.resetForces(true); kart.body.resetTorques(true);
  }
  function setKartEnabled(id, enabled) {
    const kart = kartFor(id);
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
    if (kart.enabled === enabled) return;
    halt(kart); kart.enabled = enabled; kart.body.setEnabled(enabled);
    world.propagateModifiedBodyPositionsToColliders();
  }
  function freezeKart(id, frozen) {
    const kart = kartFor(id);
    if (typeof frozen !== 'boolean') throw new TypeError('frozen must be boolean');
    if (kart.frozen === frozen) return;
    halt(kart); kart.frozen = frozen;
    kart.body.setBodyType(frozen ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    if (!frozen) {
      world.removeVehicleController(kart.controller); kart.controller = makeController(kart.body);
    }
    world.propagateModifiedBodyPositionsToColliders();
  }
  function kartContacts() {
    alive();const pairs=[],seen=new Set();
    for(const [id,kart]of karts){if(!kart.enabled)continue;const collider=kart.body.collider(0);
      world.contactPairsWith(collider,other=>{const peer=kartColliders.get(other.handle);if(!peer)return;const ids=[id,peer].sort(),key=ids.join('|');if(seen.has(key))return;
        let touching=false;world.contactPair(collider,other,m=>{if(m.numSolverContacts()>0)touching=true;});
        if(touching){seen.add(key);pairs.push(ids);}
      });
    }
    return pairs;
  }
  // One-shot yaw kick (an Oil Slick spin-out). Keeps the current travel.
  function spinKart(id, yawRate) {
    const kart = kartFor(id);
    if (!kart.enabled || kart.frozen || !finite(yawRate)) return false;
    const a = kart.body.angvel();
    kart.body.setAngvel({ x: a.x, y: clamp(yawRate, -12, 12), z: a.z }, true);
    return true;
  }
  // Bounded combat knockback, expressed as a velocity change (m/s).
  function kickKart(id,delta){
    const k=kartFor(id);if(!k.enabled||k.frozen)return false;
    const d=vector(delta,'combat kick'),v=k.body.linvel();
    k.body.setLinvel({x:clamp(v.x+d.x,-60,60),y:clamp(v.y+d.y,-20,20),z:clamp(v.z+d.z,-60,60)},true);return true;
  }
  function tuneKart(id, tuning) {
    const kart = kartFor(id);
    if (!tuning || Object.keys(tuning).some(k => !Object.hasOwn(kart.tuning, k))) throw new TypeError('invalid tuning');
    const next = { ...kart.tuning, ...tuning };
    if (!Object.values(next).every(n => finite(n) && n >= 0.1 && n <= 2)) throw new RangeError('tuning must be 0.1..2');
    kart.tuning = next;
  }
  function sweepStatic(from, to, radius = 0) {
    alive(); const p = vector(from, 'sweep start'), end = vector(to, 'sweep end');
    if (!finite(radius) || radius < 0 || radius > 10) throw new RangeError('invalid sweep radius');
    const delta = { x: end.x - p.x, y: end.y - p.y, z: end.z - p.z };
    const ray = new RAPIER.Ray(p, delta), ball = radius ? new RAPIER.Ball(radius) : null;
    let nearest = null;
    // Exact owned colliders, including finite deck undersides. No duplicate
    // world or hidden handles cross this version-2 authority boundary.
    for (const [handle, surface] of surfaces) {
      const collider = world.getCollider(handle);
      const hit = ball ? collider.castShape({ x: 0, y: 0, z: 0 }, ball, p,
        { x: 0, y: 0, z: 0, w: 1 }, delta, 0, 1, true) : collider.castRayAndGetNormal(ray, 1, true);
      if (!hit) continue;
      const fraction = ball ? hit.time_of_impact : hit.timeOfImpact;
      if (nearest && fraction >= nearest.fraction) continue;
      let normal = hit.normal;
      if (ball) {
        const n = hit.normal1, q = surface.rotation;
        const t = { x: 2 * (q.y*n.z-q.z*n.y), y: 2 * (q.z*n.x-q.x*n.z), z: 2 * (q.x*n.y-q.y*n.x) };
        normal = { x: n.x+q.w*t.x+q.y*t.z-q.z*t.y, y: n.y+q.w*t.y+q.z*t.x-q.x*t.z, z: n.z+q.w*t.z+q.x*t.y-q.y*t.x };
      }
      nearest = { surfaceId: surface.id, fraction, point: vector(ray.pointAt(fraction), 'impact'), normal: vector(normal, 'impact normal') };
    }
    return nearest;
  }
  function overlapsStatic(position, q, half = C.chassis.half) {
    alive(); const p = vector(position, 'overlap position'), h = vector(half, 'overlap half'), rot = rotation(q);
    if (Math.min(h.x, h.y, h.z) <= 0 || Math.max(h.x,h.y,h.z) > 10) throw new RangeError('invalid overlap half');
    const shape = new RAPIER.Cuboid(h.x,h.y,h.z);
    for (const handle of surfaces.keys()) if (world.getCollider(handle).intersectsShape(shape,p,rot)) return true;
    return false;
  }
  function supportAt(origin, maxDistance = 2) {
    alive(); const p = vector(origin, 'ray origin');
    if (!finite(maxDistance) || maxDistance <= 0 || maxDistance > 1000) throw new RangeError('invalid support distance');
    const ray = new RAPIER.Ray(p, { x: 0, y: -1, z: 0 });
    let nearest = null;
    // Direct queries on the actual Rapier statics also work before the first
    // world step. No hidden query-refresh step, dynamic body, or mutation.
    for (const [handle, surface] of surfaces) {
      const hit = world.getCollider(handle).castRayAndGetNormal(ray, maxDistance, false);
      if (!hit || hit.normal.y <= 0 || (nearest && hit.timeOfImpact >= nearest.distance)) continue;
      nearest = { surfaceId: surface.id, point: vector(ray.pointAt(hit.timeOfImpact), 'support point'), normal: vector(hit.normal, 'support normal'), distance: hit.timeOfImpact, grip: surface.grip };
    }
    return nearest;
  }
  function drainImpacts() { alive();return impacts.splice(0); }
  function stats() { return { disposed, tick, karts: karts.size, statics: statics.size }; }
  function dispose() {
    if (disposed) return;
    for (const kart of karts.values()) world.removeVehicleController(kart.controller);
    contactQueue.free(); world.free(); karts.clear(); statics.clear(); surfaces.clear(); kartColliders.clear();driveSurfaces.clear(); impacts.length=0; disposed = true;
  }
  return Object.freeze({ apiVersion: 2, addStatic, addKart, resetKart, restoreKart, kartContacts, applyIntent, step, pose, poses, supportAt,
    sweepStatic, overlapsStatic, setKartEnabled, freezeKart, tuneKart, arcadeSlide, kickKart, spinKart, drainImpacts, stats, dispose });
}

export { createKartPhysics, wedgeVertices };
