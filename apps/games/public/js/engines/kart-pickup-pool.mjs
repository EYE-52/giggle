// Pickups disappear on collection and return with a new server id. Keep their
// prepared models across that cycle; cloning the GLB tree belongs to setup.
export function createKartPickupPool(create, capacity) {
  const objects = Array.from({length: capacity}, create);
  const free = objects.slice();
  for (const object of objects) object.visible = false;
  return {
    objects,
    take() {
      const object = free.pop();
      if (!object) return null; // A malformed/over-capacity snapshot cannot hitch.
      object.visible = true;
      return object;
    },
    release(object) {
      object.visible = false;
      object.removeFromParent();
      free.push(object);
    },
  };
}
