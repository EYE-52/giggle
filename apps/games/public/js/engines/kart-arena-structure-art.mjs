// Static arena structure dressing: four draws regardless of wall count.
// Unit geometry and instance buffers live until dispose; frames do no work.
const EMPTY=Object.freeze([]);
const COLORS={garden:[0x357c40,0xf4f4d7],frost:[0xe9f5ff,0x369ee9],neon:[0x30344d,0xff49c4],ring:[0xe84440,0xffffff],blocks:[0xe84440,0xffffff]};
export function createKartArenaStructures(THREE,scene,{groundAt=()=>0}={}) {
  const root=new THREE.Group();root.name='arena-structures';scene.add(root);
  const box=new THREE.BoxGeometry(1,1,1),wedge=new THREE.BufferGeometry();
  wedge.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,-1,1,0,-1,-1,0,1,1,0,1,-1,1,1,1,1,1],3));
  wedge.setIndex([0,1,2,1,3,2,0,4,1,1,4,5,2,3,4,3,5,4,0,2,4,1,5,3]);wedge.computeVertexNormals();
  const decal=new THREE.BufferGeometry(),coords=[[-.7,-.25],[-.45,-.5],[0,.05],[.45,-.5],[.7,-.25],[0,.65]];
  decal.setAttribute('position',new THREE.Float32BufferAttribute(coords.flatMap(([x,z])=>[x,(z+1)/2+.025,z]),3));
  decal.setIndex([0,1,2,2,3,4,0,2,5,2,4,5]);decal.computeVertexNormals();
  const bodyMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}),capMat=new THREE.MeshBasicMaterial({color:0xffffff});
  const rampMat=new THREE.MeshStandardMaterial({color:0x435769,roughness:.7}),arrowMat=new THREE.MeshBasicMaterial({color:0xffed83,side:THREE.DoubleSide});
  const make=(name,g,m,n)=>{const mesh=new THREE.InstancedMesh(g,m,n);mesh.name=name;mesh.count=0;mesh.frustumCulled=false;root.add(mesh);return mesh;};
  const bodies=make('arena-barrier-bodies',box,bodyMat,64),caps=make('arena-barrier-caps',box,capMat,64),ramps=make('arena-ramp-wedges',wedge,rampMat,16),arrows=make('arena-ramp-chevrons',decal,arrowMat,16);
  const dummy=new THREE.Object3D(),color=new THREE.Color();let identity,theme,wallCount=-1,rampCount=-1,disposed=false;
  function sync(map) {
    if(disposed)return;
    const walls=map?.barriers||EMPTY,lips=map?.ramps||EMPTY;
    if(identity===map?.id&&theme===map?.theme&&wallCount===walls.length&&rampCount===lips.length)return;
    if(walls.length>64||lips.length>16)throw new RangeError('arena structure budget exceeded');
    identity=map?.id;theme=map?.theme;wallCount=walls.length;rampCount=lips.length;
    const palette=COLORS[theme]||COLORS.ring;
    bodies.count=caps.count=wallCount;ramps.count=arrows.count=rampCount;
    for(let i=0;i<walls.length;i++){
      const b=walls[i],y=groundAt(b.x,b.z);dummy.rotation.set(0,0,0);
      dummy.position.set(b.x,y+.45,b.z);dummy.scale.set(b.hw*2,.9,b.hd*2);dummy.updateMatrix();bodies.setMatrixAt(i,dummy.matrix);bodies.setColorAt(i,color.setHex(palette[0]));
      dummy.position.y=y+.85;dummy.scale.y=.1;dummy.updateMatrix();caps.setMatrixAt(i,dummy.matrix);caps.setColorAt(i,color.setHex(theme==='neon'&&i%2?0xffdf48:palette[1]));
    }
    for(let i=0;i<lips.length;i++){
      const r=lips[i];dummy.position.set(r.x,groundAt(r.x,r.z),r.z);dummy.rotation.set(0,r.angle,0);dummy.scale.set(r.hw,r.h,r.hl);dummy.updateMatrix();ramps.setMatrixAt(i,dummy.matrix);arrows.setMatrixAt(i,dummy.matrix);
    }
    for(const mesh of [bodies,caps,ramps,arrows]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  return {root,sync,animate(){},stats:()=>({barriers:wallCount,ramps:rampCount,drawCalls:(wallCount?2:0)+(rampCount?2:0)}),dispose(){if(disposed)return;disposed=true;scene.remove(root);for(const mesh of [bodies,caps,ramps,arrows])mesh.dispose();for(const g of [box,wedge,decal])g.dispose();for(const m of [bodyMat,capMat,rampMat,arrowMat])m.dispose();}};
}

export function drawArenaRoads2d(ctx,map,px,pz,scale) {
  for(const road of map?.roads||[]){
    ctx.beginPath();for(let i=0;i<road.points.length;i++){const p=road.points[i];ctx[i?'lineTo':'moveTo'](px(p[0]),pz(p[1]));}if(road.closed)ctx.closePath();
    ctx.strokeStyle='#f6e9c9';ctx.lineWidth=(road.width+1)*scale;ctx.stroke();
    ctx.strokeStyle='#53616a';ctx.lineWidth=road.width*scale;ctx.stroke();
  }
}
export function drawArenaStructures2d(ctx,map,px,pz,scale) {
  const colors=COLORS[map?.theme]||COLORS.ring;
  ctx.fillStyle='#'+colors[0].toString(16).padStart(6,'0');ctx.strokeStyle='#'+colors[1].toString(16).padStart(6,'0');ctx.lineWidth=.25*scale;
  for(const b of map?.barriers||[]){ctx.fillRect(px(b.x-b.hw),pz(b.z-b.hd),b.hw*2*scale,b.hd*2*scale);ctx.strokeRect(px(b.x-b.hw),pz(b.z-b.hd),b.hw*2*scale,b.hd*2*scale);}
  for(const r of map?.ramps||[]){
    ctx.save();ctx.translate(px(r.x),pz(r.z));ctx.rotate(-r.angle);ctx.fillStyle='#435769';ctx.fillRect(-r.hw*scale,-r.hl*scale,r.hw*2*scale,r.hl*2*scale);ctx.strokeStyle='#ffed83';ctx.lineWidth=.4*scale;
    ctx.beginPath();ctx.moveTo(-r.hw*.6*scale,-.5*scale);ctx.lineTo(0,1*scale);ctx.lineTo(r.hw*.6*scale,-.5*scale);ctx.stroke();ctx.restore();
  }
}
