import {createKartModel,disposeKartModel} from './kart-model.mjs';

/* One 512px still per confirmed look/upgrade change, using the arena's
 * renderer and loaded GLBs. No extra WebGL context, asset fetch or loop. */
export function createGarageThumbnail(THREE,renderer,assets,{canvas=()=>document.createElement('canvas')}={}) {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(28,512/320,.1,40);
  camera.position.set(4.2,2.7,4.8);camera.lookAt(0,.9,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0x8295b6,2.6));
  const light=new THREE.DirectionalLight(0xffffff,3.5);light.position.set(3,5,4);scene.add(light);
  const rim=new THREE.DirectionalLight(0xffce83,2);rim.position.set(-3,2,-4);scene.add(rim);
  const target=new THREE.WebGLRenderTarget(512,320),pixels=new Uint8Array(512*320*4);
  target.texture.colorSpace=THREE.SRGBColorSpace;
  const surface=canvas();surface.width=512;surface.height=320;
  const context=surface.getContext('2d');
  let model=null,disposed=false;
  const rackGeometry=new THREE.CylinderGeometry(.095,.095,.8,8),rackMaterial=new THREE.MeshStandardMaterial({color:0x64758f,metalness:.4,roughness:.35});
  function retire(){if(model){scene.remove(model);disposeKartModel(model);model=null;}}
  return {
    draw({color,driver,levels={}}) {
      if(disposed||!context)return null;
      retire();model=createKartModel(THREE,{assets,color,driver});scene.add(model);
      const kart=model.userData.kart;
      if(!kart)return null;
      kart.flame.visible=(levels.engine||0)>0;
      kart.flame.scale.setScalar(1+(levels.engine||0)*.45);
      for(const material of kart.paint) if(material.emissive){material.emissive.setHex(color);material.emissiveIntensity=(levels.engine||0)*.09;}
      for(const steer of kart.steers)steer.rotation.y=(levels.handling||0)*.12;
      kart.inner.scale.x=1+(levels.handling||0)*.035;
      for(let i=0;i<(levels.reload||0);i++){
        const barrel=new THREE.Mesh(rackGeometry,rackMaterial);barrel.rotation.x=Math.PI/2;barrel.position.set(.7+i*.19,.94,-.4);model.add(barrel);
      }
      const oldTarget=renderer.getRenderTarget(),oldColor=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
      const oldViewport=renderer.getViewport(new THREE.Vector4()),oldScissor=renderer.getScissor(new THREE.Vector4()),oldScissorTest=renderer.getScissorTest();
      try {
        renderer.setRenderTarget(target);renderer.setViewport(0,0,512,320);renderer.setScissorTest(false);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(scene,camera);
        renderer.readRenderTargetPixels(target,0,0,512,320,pixels);
        const output=context.createImageData(512,320),stride=512*4;
        for(let y=0;y<320;y++)output.data.set(pixels.subarray((319-y)*stride,(320-y)*stride),y*stride);
        context.putImageData(output,0,0);
        return surface.toDataURL('image/png');
      } finally {
        renderer.setRenderTarget(oldTarget);renderer.setViewport(oldViewport);renderer.setScissor(oldScissor);renderer.setScissorTest(oldScissorTest);renderer.setClearColor(oldColor,oldAlpha);
      }
    },
    dispose(){disposed=true;retire();target.dispose();rackGeometry.dispose();rackMaterial.dispose();},
  };
}
