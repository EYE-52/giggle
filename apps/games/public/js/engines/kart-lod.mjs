/* Crowd LOD for big kart matches. Up to `fullDetail` karts every kart keeps
 * its full model (8-player matches render exactly as before). Above that,
 * karts farther than `far` metres from the camera hide their detailed model
 * and draw as one shared InstancedMesh: a coloured body with a dark roof,
 * one draw call for every distant kart together. The nearest `keepNear`
 * karts always stay detailed however the camera is placed. */
export function createKartLod(THREE, { fullDetail = 8, far = 42, keepNear = 10, capacity = 32, originY = .55 } = {}) {
  const body = new THREE.BoxGeometry(2.3, 0.7, 3);
  body.translate(0, originY, 0);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const proxies = new THREE.InstancedMesh(body, material, capacity);
  proxies.name = 'kart-lod-proxies';
  proxies.count = 0;
  // Allocate the colour buffer/instancing shader variant during loading,
  // before the first distant driver calls setColorAt().
  proxies.setColorAt(0,new THREE.Color(0xffffff));
  proxies.frustumCulled = false;
  proxies.castShadow = false;
  proxies.receiveShadow = false;
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  // Prepare the colour attribute before shader warm-up, including when the
  // match starts with no distant karts and drops detail later.
  proxies.setColorAt(0, color.setHex(0xffffff));
  const proxied=new Set(),ranked=[];
  const byDistance=(a,b)=>a.d-b.d;
  return {
    object: proxies,
    /* entries: [{mesh, color, visible}] for every kart this frame. Returns
     * the set of meshes drawn as proxies (callers skip their animation). */
    update(camera, entries, nearCount = keepNear) {
      const far2 = far * far;proxied.clear();
      let n = 0;
      if (entries.length > Math.min(fullDetail, nearCount) && camera) {
        let count=0;
        for(const e of entries)if(e.visible){
          const item=ranked[count]||(ranked[count]={});
          item.e=e;item.d=e.mesh.position.distanceToSquared(camera.position);count++;
        }
        ranked.length=count;ranked.sort(byDistance);
        for(let rank=0;rank<ranked.length;rank++){
          const {e,d}=ranked[rank];
          // A zero radius is a hard detail cap, including overlapping spawn or
          // reconnect poses. Classic arenas retain their normal distance LOD.
          const distant = rank >= nearCount && (far === 0 || d > far2) && n < capacity;
          e.mesh.visible = !distant;
          if (!distant) continue;
          proxied.add(e.mesh);
          matrix.compose(e.mesh.position, e.mesh.quaternion, e.mesh.scale);
          proxies.setMatrixAt(n, matrix);
          proxies.setColorAt(n, color.setHex(e.color));
          n++;
        }
      }
      proxies.count = n;
      if (n) { proxies.instanceMatrix.needsUpdate = true; if (proxies.instanceColor) proxies.instanceColor.needsUpdate = true; }
      return proxied;
    },
    dispose() { body.dispose(); material.dispose(); proxies.dispose?.(); },
  };
}

/* Distinct colours beyond the authored eight: golden-angle hues keep 32
 * karts apart without repeating the first eight. */
export function crowdColor(index, authored) {
  if (index < authored.length) return authored[index];
  const c = { h: ((index * 137.508) % 360) / 360, s: 0.62, l: index % 2 ? 0.5 : 0.62 };
  const f = n => { const k = (n + c.h * 12) % 12, a = c.s * Math.min(c.l, 1 - c.l); return c.l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
