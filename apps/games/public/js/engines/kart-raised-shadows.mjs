// One tiny shadow caster per kart instead of redrawing all wheels, engine,
// paint and animal meshes. Layer 1 is shadow-only; the colour camera uses 0.
export function disableRaisedStaticShadows(root){root?.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;for(const m of[].concat(o.material||[]))if(m.transparent)m.forceSinglePass=true;});}
export function createRaisedShadows(THREE,{sun,quality}){
  const geometry=new THREE.BoxGeometry(2.15,.6,3),material=new THREE.MeshBasicMaterial(),models=new WeakSet();let tier;
  sun?.shadow?.camera?.layers?.enable(1);
  return{add(model){if(models.has(model))return;models.add(model);model.traverse(o=>{if(o.isMesh)o.castShadow=false;});const proxy=new THREE.Mesh(geometry,material);proxy.name='KartShadowProxy';proxy.layers.set(1);proxy.castShadow=true;model.add(proxy);},
    update(){const next=quality();if(tier===next||!sun?.shadow)return;tier=next;sun.castShadow=next!=='low';const size=next==='high'?1024:512;if(sun.shadow.mapSize.x!==size){sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(size,size);}},
    dispose(){geometry.dispose();material.dispose();}};
}
