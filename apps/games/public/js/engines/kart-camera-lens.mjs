// Widen the driving view without moving the collision-checked camera through scenery.
export function setKartCameraLens(camera, fov, youDrive) {
  const zoom = youDrive ? 0.85 : 1;
  if (camera.zoom === zoom && Math.abs(camera.fov - fov) <= 0.005) return;
  camera.zoom = zoom;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}
