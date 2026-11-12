import {createStarModel} from './kart-model.mjs';

// Team identity and objectives are presentation only. Every home, dropped
// flag and star uses its authority-provided support height, including decks.
export function createKartObjectives(THREE,scene,{state,assets,renderStars=false}={}) {
  const root=new THREE.Group();root.name='KartObjectives';scene.add(root);
  const geometries=new Set(),materials=new Set(),badges=[],bases=new Map(),flags=new Map(),starParts=[];
  const geo=g=>(geometries.add(g),g),mat=m=>(materials.add(m),m);
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),up=new THREE.Vector3(0,1,0),right=new THREE.Vector3();
  let identity,pole,poleGeometry;
  if(state?.teams?.length){
    identity=mat(new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false}));
    pole=mat(new THREE.MeshBasicMaterial({color:0xf8f4e9,toneMapped:false}));
    poleGeometry=geo(new THREE.CylinderGeometry(.045,.045,2.1,6));
  }
  const glyphs={A:['010','101','111','101','101'],B:['110','101','110','101','110']};
  function labelGeometry(color,letter,flag=false) {
    const positions=[],colors=[],c=new THREE.Color(color);
    const triangle=(a,b,d,tint)=>{for(const p of[a,b,d]){positions.push(...p);colors.push(tint.r,tint.g,tint.b);}};
    const quad=(x,y,w,h,z,tint)=>{const a=[x,y,z],b=[x+w,y,z],d=[x+w,y+h,z],e=[x,y+h,z];triangle(a,b,d,tint);triangle(a,d,e,tint);};
    if(flag||letter==='B')quad(flag?-.55:-.36,flag?-.35:-.36,flag?1.1:.72,flag?.7:.72,0,c);
    else for(let i=0;i<20;i++){const a=i/20*Math.PI*2,b=(i+1)/20*Math.PI*2;triangle([0,0,0],[Math.cos(a)*.38,Math.sin(a)*.38,0],[Math.cos(b)*.38,Math.sin(b)*.38,0],c);}
    const white=new THREE.Color(0x102132),pixel=.095;
    glyphs[letter].forEach((row,y)=>[...row].forEach((on,x)=>{if(on==='1')quad((x-1.5)*pixel,(1.5-y)*pixel,pixel*.95,pixel*.95,.012,white);}));
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
  }
  for(const team of state?.teams || []) {
    const letter=team.id==='blue'?'A':'B',geometry=labelGeometry(team.color,letter);
    const mesh=new THREE.InstancedMesh(geometry,identity,32);mesh.name='KartTeam:'+team.id;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(mesh);badges.push({id:team.id,mesh});
    const teamMaterial=mat(new THREE.MeshBasicMaterial({color:team.color,side:THREE.DoubleSide,toneMapped:false,depthWrite:false}));
    for(const base of(state.bases || []).filter(b=>b.teamId===team.id)) {
      const group=new THREE.Group();group.name='KartBase:'+team.id;
      const ring=new THREE.Mesh(geo(new THREE.RingGeometry(2.3,2.5,32)),teamMaterial);ring.rotation.x=-Math.PI/2;ring.position.y=.05;group.add(ring);
      const marker=new THREE.Mesh(geometry,identity);marker.position.y=.8;group.add(marker);root.add(group);bases.set(base.id,{group,marker});
    }
    for(const flag of(state.flags || []).filter(f=>f.teamId===team.id)) {
      const group=new THREE.Group();group.name='KartFlag:'+team.id;
      const staff=new THREE.Mesh(poleGeometry,pole);staff.position.y=1.05;
      const cloth=new THREE.Mesh(labelGeometry(team.color,letter,true),identity);cloth.position.set(.55,1.75,0);group.add(staff,cloth);root.add(group);flags.set(flag.id,group);
    }
  }
  // The exact same shipped star as classic arenas, with shared buffers and
  // bounded instance matrices. No model cloning happens during play.
  if(renderStars && assets?.star) {
    const template=createStarModel(THREE,assets);template.updateMatrixWorld(true);
    template.traverse(part=>{if(!part.isMesh)return;const mesh=new THREE.InstancedMesh(part.geometry,part.material,64);mesh.name='KartObjectiveStars';mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(mesh);starParts.push({mesh,offset:part.matrixWorld.clone()});});
  }
  function update(snapshot,models,camera,time=0,reducedMotion=false) {
    const teamMode=!!snapshot.teamMode;
    for(const badge of badges) {
      let count=0;
      if(teamMode)for(const kart of snapshot.karts || []) {
        const id=kart.id || kart.pid,model=models.get(id);
        if(snapshot.teamByPlayer?.[id]!==badge.id||id===snapshot.you||!model?.visible||kart.out||kart.connected===false||kart.alive===false||kart.respawn>0)continue;
        position.copy(model.position);position.y+=3;
        right.set(-1.6,0,0).applyQuaternion(camera.quaternion);position.add(right);
        matrix.compose(position,camera.quaternion,scale);badge.mesh.setMatrixAt(count++,matrix);
      }
      badge.mesh.count=count;badge.mesh.visible=count>0;badge.mesh.instanceMatrix.needsUpdate=true;
    }
    for(const base of snapshot.bases || []) {
      const art=bases.get(base.id);if(!art)continue;
      art.group.position.copy(base.position);art.marker.quaternion.copy(camera.quaternion);art.group.visible=teamMode;
    }
    for(const flag of snapshot.flags || []) {
      const art=flags.get(flag.id);if(!art)continue;
      const carrier=flag.state==='carried'?models.get(flag.carrierId):null;
      if(carrier){position.set(-.9,.6,-.9).applyQuaternion(carrier.quaternion).add(carrier.position);art.position.copy(position);}
      else art.position.copy(flag.position);
      art.rotation.y=Math.atan2(camera.position.x-art.position.x,camera.position.z-art.position.z);art.visible=teamMode;
      art.userData.state=flag.state;art.userData.carrierId=flag.carrierId;
    }
    const stars=snapshot.mode==='starrush'?snapshot.stars || []:[];
    for(const part of starParts) {
      let count=0;
      for(const star of stars){if(star.available===false||count>=64)continue;
        position.set(star.x,(star.groundY??star.y??0)+1.5+(reducedMotion?0:Math.sin(time*2.2+count)*.14),star.z);
        rotation.setFromAxisAngle(up,reducedMotion?0:time*1.3);matrix.compose(position,rotation,scale);matrix.multiply(part.offset);part.mesh.setMatrixAt(count++,matrix);
      }
      part.mesh.count=count;part.mesh.visible=count>0;part.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  function dispose(){root.removeFromParent();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const badge of badges)badge.mesh.dispose();for(const part of starParts)part.mesh.dispose();}
  return {root,update,dispose};
}
