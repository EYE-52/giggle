#!/usr/bin/env python3
"""Blender source/export for Rocket/Seeker/Bomb rigs, sourced shots, and separate mines.
Preserves frozen pulse-mounted.glb and combat.glb. Run Blender --background --python this file.
"""
import hashlib,json,math,struct,subprocess,tempfile
from pathlib import Path
import bpy
from mathutils import Matrix,Vector

REPO=Path(__file__).resolve().parents[1]
SOURCE=REPO/'assets-source/karts/weapon-candidates-20261007/kenney-blaster-2.1'
RECORD=REPO/'assets-source/karts/arsenal-mounted-20261007'
OUTPUT=REPO/'public/assets/karts/combat/arsenal-mounted.glb'
ATLAS=SOURCE/'Models/GLB format/Textures/colormap.png'
SRC=SOURCE/'Models/GLB format/blaster-m.glb'

def to_blender(p): return Vector((p[0],-p[2],p[1]))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def strip_png_metadata(path):
 data=path.read_bytes();out=data[:8];offset=8
 while offset<len(data):
  size=struct.unpack_from('>I',data,offset)[0];kind=data[offset+4:offset+8];end=offset+size+12
  if kind not in [b'tEXt',b'zTXt',b'iTXt',b'eXIf']:out+=data[offset:end]
  offset=end
 path.write_bytes(out)
def unpack(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];n={'VEC2':2,'VEC3':3,'SCALAR':1}[a['type']];t={5126:'f',5123:'H',5125:'I'}[a['componentType']];size=n*struct.calcsize(t);off=v.get('byteOffset',0)+a.get('byteOffset',0)
 return[struct.unpack_from('<'+t*n,b,off+k*v.get('byteStride',size)) for k in range(a['count'])]
def empty(name,parent=None,location=(0,0,0)):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=to_blender(location);return o
def material(name,rgb,metal=.0,rough=.65,emission=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF')
 def lin(v):v=v/255;return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
 n.inputs['Base Color'].default_value=tuple(lin(v) for v in rgb)+(1,);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough
 if emission:n.inputs['Emission Color'].default_value=tuple(lin(v) for v in emission)+(1,);n.inputs['Emission Strength'].default_value=.8
 return m
def mesh(name,verts,faces,parent,mat,uv=None,bevel=0):
 d=bpy.data.meshes.new(name+'Surface');d.from_pydata([to_blender(p) for p in verts],[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.parent=parent;d.materials.append(mat)
 if uv:
  layer=d.uv_layers.new(name='PaletteUV')
  for l in d.loops:layer.data[l.index].uv=uv
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
 if bevel:
  mod=o.modifiers.new('Applied machined fillet','BEVEL');mod.width=bevel;mod.segments=1 if bevel<.005 else 3;mod.limit_method='ANGLE';mod.angle_limit=.9;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in d.polygons:p.use_smooth=True
 mod=o.modifiers.new('Applied weighted surface normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def lathe(profile,segments=32,center=(0,0,0)):
 verts=[]
 for radius,y in profile:
  for i in range(segments):
   a=2*math.pi*i/segments;verts.append((center[0]+radius*math.cos(a),center[1]+y,center[2]+radius*math.sin(a)))
 faces=[]
 for row in range(len(profile)-1):
  for i in range(segments):a=row*segments+i;b=row*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
 faces+=[tuple(range(segments-1,-1,-1)),tuple(range((len(profile)-1)*segments,len(profile)*segments))]
 return verts,faces
def combine(parts):
 vertices=[];faces=[]
 for v,f in parts:off=len(vertices);vertices+=v;faces += [tuple(i+off for i in p) for p in f]
 return vertices,faces
def block(center,size,angle=0):
 x,y,z=center;sx,sy,sz=[v/2 for v in size];c,s=math.cos(angle),math.sin(angle)
 verts=[(x+c*a-s*d,y+b,z+s*a+c*d) for a,b,d in [(-sx,-sy,-sz),(sx,-sy,-sz),(sx,sy,-sz),(-sx,sy,-sz),(-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]]
 return verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]

def chamfered_tab(center,size,angle):
 x,y,z=center;hx,hy,hz=[d/2 for d in size];r=.004
 contour=[(-hx+r,-hz),(hx-r,-hz),(hx,-hz+r),(hx,hz-r),(hx-r,hz),(-hx+r,hz),(-hx,hz-r),(-hx,-hz+r)]
 verts=[];c,s=math.cos(angle),math.sin(angle)
 for height,shrink in [(-hy,.003),(-hy+.003,0),(hy-.003,0),(hy,.003)]:
  for a,b in contour:
   a-=math.copysign(shrink,a);b-=math.copysign(shrink,b);verts.append((x+c*a-s*b,y+height,z+s*a+c*b))
 faces=[tuple(range(7,-1,-1)),tuple(range(24,32))]
 for row in range(3):faces +=[(row*8+i,row*8+(i+1)%8,(row+1)*8+(i+1)%8,(row+1)*8+i) for i in range(8)]
 return verts,faces

RECORD.mkdir(parents=True,exist_ok=True);OUTPUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SRC));body=next(o for o in bpy.context.scene.objects if o.type=='MESH');colormap=body.data.materials[0]
j,b=unpack(SRC);primitive=j['meshes'][0]['primitives'][0];pos=accessor(j,b,primitive['attributes']['POSITION']);norm=accessor(j,b,primitive['attributes']['NORMAL']);uv=accessor(j,b,primitive['attributes']['TEXCOORD_0']);idx=[p[0] for p in accessor(j,b,primitive['indices'])]
# Flat authored front nozzle. Recover its inner 8-vertex mouth by radius.
front=min(p[2] for p in pos);front_points={tuple(p) for p in pos if abs(p[2]-front)<1e-6};cx=sum(p[0] for p in front_points)/len(front_points);cy=sum(p[1] for p in front_points)/len(front_points)
radii=sorted({round(math.hypot(p[0]-cx,p[1]-cy),6) for p in front_points});inner=[p for p in front_points if abs(math.hypot(p[0]-cx,p[1]-cy)-min(radii))<1e-5]
assert len(inner)==8
bore_source=Vector((sum(p[0] for p in inner)/8,sum(p[1] for p in inner)/8,front));scale=1.30/(max(p[2] for p in pos)-front)
bore_y=.50;offset=Vector((0,bore_y-bore_source.y*scale,1.10+front*scale))
vertices=[to_blender((-p[0]*scale,p[1]*scale+offset.y,-p[2]*scale+offset.z)) for p in pos]
preserved=bpy.data.meshes.new('RocketOriginalKenneySurface');preserved.from_pydata(vertices,[],[idx[i:i+3] for i in range(0,len(idx),3)]);preserved.update();layer=preserved.uv_layers.new(name='OriginalKenneyUV')
for l in preserved.loops:layer.data[l.index].uv=(uv[l.vertex_index][0],1-uv[l.vertex_index][1])
for p in preserved.polygons:p.use_smooth=True
preserved.normals_split_custom_set([to_blender((-norm[l.vertex_index][0],norm[l.vertex_index][1],-norm[l.vertex_index][2])) for l in preserved.loops]);preserved.materials.append(colormap);body.data=preserved;body.name='RocketHousing';body.matrix_world=Matrix.Identity(4)
rocket=empty('Rocket');body.parent=rocket;rocket['kind']='rocket';rocket['mount']=[-.95,1.20-bore_y,.80];rocket['source']='Kenney Blaster Kit 2.1 / blaster-m; CC0-1.0'
helper=empty('RocketMuzzleTip',rocket,(0,bore_y,1.10));helper['measurement']='Original front nozzle inner 8-vertex centroid';helper['forward']=[0.,0.,1.]
charcoal=material('ArsenalSaddleCharcoal',(41,50,59),.32,.62);metal=material('MineMachinedSteel',(142,156,174),.68,.43);red=material('MineArmedLampRed',(230,45,35),.1,.45,(255,55,35))
# Fitted left-pod saddle; the rear foot seats on the pod and the front rises
# above the wheel. The original source grip remains nested and intact.
stations=[(-.19,0,.08),(-.10,0,.08),(.23,.16,.18)];section_count=8;verts=[]
for z,bottom,floor in stations:
 section=[(-.125,bottom),(.125,bottom),(.185,.275),(.105,.275),(.105,floor),(-.105,floor),(-.105,.275),(-.185,.275)]
 verts += [(x,y,z) for x,y in section]
faces=[tuple(range(7,-1,-1)),tuple(range(16,24))]
for row in range(2):faces += [(row*8+i,row*8+(i+1)%8,(row+1)*8+(i+1)%8,(row+1)*8+i) for i in range(8)]
mesh('RocketSaddle',verts,faces,rocket,charcoal,bevel=.012)

# Original mechanical pressure disc, not a scaled grenade/orb. Shallow moulded
# shell with deliberate radius transitions, inset plate and physical steel rim.
def device(root,offset_y=0):
 shell=lathe([(.33,0),(.38,.012),(.405,.040),(.410,.075),(.400,.112),(.375,.128),(.29,.128)],32)
 shell=([(x,y+offset_y,z) for x,y,z in shell[0]],shell[1])
 # Original palette uses the same unchanged authored atlas as the housing.
 mesh(root.name+'PressureShell',*shell,root,colormap,uv=(.4375,1-.625))
 rim=lathe([(.285,.115),(.307,.123),(.315,.141),(.370,.141),(.378,.128),(.373,.108)],32)
 plate=lathe([(.02,.133),(.26,.133),(.277,.142),(.277,.151),(.264,.159),(.02,.159)],32)
 fuze=lathe([(.067,.157),(.077,.165),(.077,.183),(.065,.190)],8)
 parts=[rim,plate,fuze]
 # Six low, bevelled anti-slip fuze teeth: physical rectangular metal tabs.
 for i in range(6):
  a=i*math.tau/6;parts.append(chamfered_tab((.34*math.cos(a),.15,.34*math.sin(a)),(.048,.022,.055),a))
 # Four recessed hex fastener heads, small enough to read as hardware.
 for i in range(4):
  a=math.pi/4+i*math.pi/2;parts.append(lathe([(.018,.143),(.018,.157)],6,(.235*math.cos(a),0,.235*math.sin(a))))
 v,f=combine(parts);v=[(x,y+offset_y,z) for x,y,z in v];mesh(root.name+'RimAndFuze',v,f,root,metal)
 v,f=block((.13,.167+offset_y,0),(.040,.012,.022));lamp=mesh(root.name+'Lamp',v,f,root,red,bevel=.004);lamp['armedIndicator']=True
 root['source']='Original Giggle authored pressure device; no source grenade geometry or borrowed explosive mesh'
 root['trapStyle']='Low pressure disc / machined rim / short fuze tabs; no radius rings'
 return root
trap=device(empty('MineTrap'));trap['kind']='mine-trap';trap['pivotDescription']='Ground base Y=0';trap['radiusVisual']=.410
mine=device(empty('Mine'),.055);mine['kind']='mine';mine['mount']=[0,1.29,-1.35]
# Stowed rack seat on rear wing: connected bevelled pad, using steel material.
v,f=block((0,.0275,0),(.35,.055,.32));rack=mesh('MineStowRack',v,f,mine,metal,bevel=.015)
# Join the rack into the existing metal draw, leaving stable branch/lamp names.
metal_mesh=next(o for o in mine.children if o.name=='MineRimAndFuze');bpy.ops.object.select_all(action='DESELECT');metal_mesh.select_set(True);rack.select_set(True);bpy.context.view_layer.objects.active=metal_mesh;bpy.ops.object.join()
# Preserve other authored single-material Blaster Kit surfaces exactly.
def preserved_blaster(path,name,root,transform):
 sj,sb=unpack(path);sp=sj['meshes'][0]['primitives'][0]
 pp=accessor(sj,sb,sp['attributes']['POSITION']);nn=accessor(sj,sb,sp['attributes']['NORMAL']);tt=accessor(sj,sb,sp['attributes']['TEXCOORD_0']);ii=[i[0] for i in accessor(sj,sb,sp['indices'])]
 positions=[to_blender(transform@Vector(p)) for p in pp];d=bpy.data.meshes.new(name+'PreservedSurface');d.from_pydata(positions,[],[ii[i:i+3] for i in range(0,len(ii),3)]);d.update();layer=d.uv_layers.new(name='OriginalKenneyUV')
 for l in d.loops:layer.data[l.index].uv=(tt[l.vertex_index][0],1-tt[l.vertex_index][1])
 for p in d.polygons:p.use_smooth=True
 normal_matrix=transform.to_3x3().inverted().transposed();d.normals_split_custom_set([to_blender((normal_matrix@Vector(nn[l.vertex_index])).normalized()) for l in d.loops]);d.materials.append(colormap)
 o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.parent=root
 return o,{'source':str(path.relative_to(REPO)),'sha256':sha(path),'triangles':len(ii)//3,'transformGltf':list(sum((list(row) for row in transform),[])),'surfacePolicy':'Original triangle/UV/split-normal tuples retained under affine rigid/uniform normalization'}

# Seeker uses actual green authored receiver q and a fitted left-pod cradle.
seeker=empty('Seeker');seeker['kind']='seeker'
qpath=SOURCE/'Models/GLB format/blaster-q.glb';qj,qb=unpack(qpath);qp=accessor(qj,qb,qj['meshes'][0]['primitives'][0]['attributes']['POSITION']);qfront=min(p[2] for p in qp);qscale=1.30/(max(p[2] for p in qp)-qfront)
# Opening lies between original lower/upper rim contours on front Z plane.
qsource_bore=Vector((0,.02099667489528656,qfront));qoffset=Vector((0,.50-qsource_bore.y*qscale,1.10+qfront*qscale));qtransform=Matrix.Translation(qoffset)@Matrix.Rotation(math.pi,4,'Y')@Matrix.Scale(qscale,4)
_,seeker_source=preserved_blaster(qpath,'SeekerHousing',seeker,qtransform);seeker['mount']=[-.95,.70,.80];seeker['source']='Kenney Blaster Kit2.1 / blaster-q; CC0-1.0'
shelper=empty('SeekerMuzzleTip',seeker,(0,.50,1.10));shelper['measurement']='Source front rectangular aperture center';shelper['forward']=[0.,0.,1.]
# Same seat footprint as mirrored Pulse; receiver is higher than m's grip.
verts=[]
for z,bottom,floor in [(-.19,0,.16),(-.10,0,.16),(.23,.16,.24)]:
 section=[(-.125,bottom),(.125,bottom),(.18,.345),(.10,.345),(.10,floor),(-.10,floor),(-.10,.345),(-.18,.345)]
 verts += [(x,y,z) for x,y in section]
mesh('SeekerSaddle',verts,faces,seeker,charcoal,bevel=.012)

# Actual authored Space Kit rocket modules assembled at their authored
# stack interfaces. Only preview grid translations are discarded. Geometry,
# normals and linear material colors are preserved; the latter become COLOR_0
# for one efficient draw per shot, since all source materials are matte/diffuse.
space=RECORD/'sources/kenney-space-kit/Models/GLTF format'
shot_material=bpy.data.materials.new('AuthoredSpaceKitVertexColors');shot_material.use_nodes=True;sn=shot_material.node_tree.nodes.get('Principled BSDF');sn.inputs['Base Color'].default_value=(1,1,1,1);sn.inputs['Metallic'].default_value=1;sn.inputs['Roughness'].default_value=1
color_node=shot_material.node_tree.nodes.new('ShaderNodeVertexColor');color_node.layer_name='AuthoredSourceMaterialColor';shot_material.node_tree.links.new(color_node.outputs['Color'],sn.inputs['Base Color'])
shot_sources={}
def assembled_rocket(name,parts,length):
 root=empty(name);total=max(offset+height for _,offset,height in parts);uniform=length/total;v=[];f=[];vertex_normals=[];face_colors=[];sources=[]
 for file,offset,height in parts:
  path=space/(file+'.glb');sj,sb=unpack(path);sources.append({'path':str(path.relative_to(REPO)),'sha256':sha(path),'stackY':offset,'sourceHeight':height})
  for sp in sj['meshes'][0]['primitives']:
   pp=accessor(sj,sb,sp['attributes']['POSITION']);nn=accessor(sj,sb,sp['attributes']['NORMAL']);ii=[i[0] for i in accessor(sj,sb,sp['indices'])];base=len(v)
   # Original +Y axis becomes runtime +Z; original X/Z radial directions stay
   # orthonormal (X, -Z, Y) and every part uses the same uniform scale.
   mat=sj['materials'][sp['material']]['pbrMetallicRoughness'];assert mat.get('metallicFactor',1)==1 and mat.get('roughnessFactor',1)==1
   color=mat.get('baseColorFactor',[1,1,1,1])
   for i in range(0,len(ii),3):
    base=len(v)
    for k in ii[i:i+3]:
     p=pp[k];n=nn[k]
     v.append(to_blender((p[0]*uniform,-p[2]*uniform,(p[1]+offset)*uniform-length/2)))
     vertex_normals.append(to_blender((n[0],-n[2],n[1])).normalized())
    f.append((base,base+1,base+2));face_colors.append(color)
 d=bpy.data.meshes.new(name+'PreservedSourceModules');d.from_pydata(v,[],f);d.update();colors=d.color_attributes.new(name='AuthoredSourceMaterialColor',type='FLOAT_COLOR',domain='CORNER')
 for face,color in zip(d.polygons,face_colors):
  face.use_smooth=True
  for li in face.loop_indices:colors.data[li].color=color
 d.normals_split_custom_set([vertex_normals[l.vertex_index] for l in d.loops]);d.materials.append(shot_material);o=bpy.data.objects.new(name+'Body',d);bpy.context.collection.objects.link(o);o.parent=root
 root['source']='Kenney Space Kit original rocket modules; CC0-1.0';root['tipZ']=length/2;root['tailZ']=-length/2;root['projectileOrigin']='Geometric bounding center; +Z nose, -Z tail'
 empty(name+'Tip',root,(0,0,length/2));empty(name+'Tail',root,(0,0,-length/2));shot_sources[name]={'parts':sources,'length':length,'uniformScale':uniform,'sourceTriangleCount':len(f),'materialEncoding':'Original linear diffuse RGBA copied to COLOR_0; identical source metallic1/roughness1 response; no recoloring/simplification'}
 return root
assembled_rocket('RocketShot',[('rocket_finsA',0,.7),('rocket_sidesA',.7,1),('rocket_topA',1.7,.8)],1.25)
assembled_rocket('SeekerShot',[('rocket_baseB',0,1.3),('rocket_fuelB',1.3,1),('rocket_topB',2.3,1.1)],1.15)

# Original readable dynamite bundle. Four material draws include every stick,
# binding, fuse, sensor and lamp; no orb, world-radius ring or hidden collider.
def along_z(part,center=(0,0,0)):
 v,f=part;return [(x+center[0],z+center[1],y+center[2]) for x,y,z in v],f
def rope(points,radius=.018,segments=8):
 v=[]
 for i,p in enumerate(points):
  tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
  tangent.normalize();u=tangent.cross(Vector((1,0,0))).normalized();w=tangent.cross(u)
  for side in range(segments):v.append(tuple(Vector(p)+radius*(u*math.cos(side*math.tau/segments)+w*math.sin(side*math.tau/segments))))
 f=[]
 for row in range(len(points)-1):
  for side in range(segments):a=row*segments+side;b=row*segments+(side+1)%segments;f.append((a,b,b+segments,a+segments))
 f += [tuple(range(segments-1,-1,-1)),tuple(range((len(points)-1)*segments,len(points)*segments))]
 return v,f
bomb_shot=empty('BombShot');dynamite=material('DynamiteVividRed',(238,35,32),.03,.56);fuse_material=material('DynamiteCreamFuse',(244,224,172),0,.82)
centers=[(0,0)]+[(.222*math.cos(i*math.tau/6),.222*math.sin(i*math.tau/6)) for i in range(6)]
sticks=[];caps=[]
for x,y in centers:
 sticks.append(along_z(lathe([(.082,-.43),(.110,-.413),(.114,-.392),(.114,.392),(.110,.413),(.082,.43)],12),(x,y,0)))
 for end in [-1,1]:
  v=[(x+.073*math.cos(i*math.tau/12),y+.073*math.sin(i*math.tau/12),end*.431) for i in range(12)]
  caps.append((v,[tuple(range(12)) if end>0 else tuple(range(11,-1,-1))]))
mesh('BombShotDynamite',*combine(sticks),bomb_shot,dynamite)
bands=[]
for z in [-.225,.225]:
 v,f=along_z(lathe([(.328,z-.035),(.350,z-.030),(.350,z+.030),(.328,z+.035),(.328,z-.035)],24));bands.append((v,f[:-2]))
bands.append(block((0,.350,.12),(.22,.10,.24)))
mesh('BombShotBandsAndSensor',*combine(bands),bomb_shot,charcoal)
caps.append(rope([(0,0,.432),(0,.055,.485),(0,.15,.475),(0,.275,.36),(0,.397,.21),(0,.397,.12)]))
mesh('BombShotFuse',*combine(caps),bomb_shot,fuse_material)
lamp=mesh('BombShotLamp',*block((0,.365,.245),(.075,.035,.013)),bomb_shot,red);lamp['armedIndicator']=True
# Bound the complete visible model by the authority sphere, after centering
# its geometric box for a stable rolling/deployed pivot.
points=[vert.co.copy() for o in bomb_shot.children if o.type=='MESH' for vert in o.data.vertices]
center_blender=Vector(tuple((min(v[i] for v in points)+max(v[i] for v in points))/2 for i in range(3)))
radius=max((p-center_blender).length for p in points);bundle_scale=.585/radius
for o in bomb_shot.children:
 for vert in o.data.vertices:vert.co=(vert.co-center_blender)*bundle_scale
bomb_shot['projectileOrigin']='Full geometric bounding center; all visible vertices inside .585m sphere';bomb_shot['source']='Original Giggle authored seven-stick dynamite, bands, cream fuse and proximity sensor';bomb_shot['radiusVisual']=.585
bomb_source={'design':'Seven vivid red paper dynamite sticks, two charcoal bands, cream fuse/ends, dark proximity sensor and small red hardware lamp; no orb/radius ring','sourceLicense':'Original project authored geometry and materials; replaces Kenney grenade-b model','projectileBranch':'BombShot','meshNames':[o.name for o in bomb_shot.children],'draws':4,'visualRadius':.585,'authorityRadius':.60,'fullCenterCorrectionBlender':list(center_blender),'uniformEnclosingScale':bundle_scale}
bomb=empty('Bomb');bomb['kind']='bomb';bomb['mount']=[0,.70,.80]
# The identical bundle stows lengthwise on the left pod, ahead of the helmet.
# A single chamfered trough angles forward to the true central release helper.
for original in bomb_shot.children:
 clone=original.copy();clone.data=original.data;clone.name=original.name.replace('BombShot','BombStowed');bpy.context.collection.objects.link(clone);clone.parent=bomb
 transform=Matrix.Translation(to_blender((-.80,.57,-.015)))
 clone.matrix_basis=transform@original.matrix_basis
# Shaped connected ejection chute with seated rear foot and rising forward lip.
verts=[]
for cx,cy,z in [(-.80,.10,-.19),(-.80,.10,.10),(0,.50,1.10)]:
 section=[(-.125,-.10),(.125,-.10),(.15,.07),(.11,.07),(.11,-.055),(-.11,-.055),(-.11,.07),(-.15,.07)]
 verts += [(cx+x,cy+y,z) for x,y in section]
mesh('BombEjector',*combine([(verts,faces),block((-.80,.165,-.015),(.38,.13,.58))]),bomb,charcoal,bevel=.012);bhelper=empty('BombMuzzleTip',bomb,(0,.50,1.10));bhelper['measurement']='Actual forward ejection trough opening center';bhelper['forward']=[0.,0.,1.]

for image in bpy.data.images:
 if image.source=='FILE':image.pack()
bpy.context.scene.unit_settings.system='METRIC';bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(RECORD/'arsenal-mounted.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',export_yup=True,export_extras=True,export_normals=True,export_tangents=False,export_animations=False,export_cameras=False,export_lights=False)
with tempfile.TemporaryDirectory(prefix='arsenal-mounted-') as tmp:
 intermediate=Path(tmp)/'dedup.glb';cli=['npx','--yes','@gltf-transform/cli@4.5.0'];subprocess.run(cli+['dedup',str(OUTPUT),str(intermediate)],check=True);subprocess.run(cli+['prune',str(intermediate),str(OUTPUT),'--keep-leaves','true'],check=True)
 # Compression without the CLI meshopt transform's lossy quantize step.
 # Resolve the SDK installed by the pinned CLI above; no repo dependency.
 package=next(p for p in (Path.home()/'.npm/_npx').glob('*/node_modules/@gltf-transform/cli/package.json') if json.loads(p.read_text())['version']=='4.5.0');modules=package.parents[2]
 code=f"""import {{NodeIO}} from {json.dumps((modules/'@gltf-transform/core/dist/index.js').as_uri())};
import {{EXTMeshoptCompression}} from {json.dumps((modules/'@gltf-transform/extensions/dist/index.js').as_uri())};
import {{MeshoptEncoder}} from {json.dumps((modules/'meshoptimizer/index.js').as_uri())};
await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({{'meshopt.encoder':MeshoptEncoder}});
const document=await io.read({json.dumps(str(OUTPUT))});
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({{method:EXTMeshoptCompression.EncoderMethod.QUANTIZE}});
await io.write({json.dumps(str(OUTPUT.with_suffix('.meshopt.glb')))},document);
"""
 subprocess.run(['node','--input-type=module','-e',code],check=True)
output,_=unpack(OUTPUT)
triangles=sum(output['accessors'][p['indices']]['count']//3 for m in output['meshes'] for p in m['primitives']);draws=sum(len(m['primitives']) for m in output['meshes'])
record={'status':'Concrete asset library for root integration/review; art acceptance pending','output':{'path':str(OUTPUT.relative_to(REPO)),'bytes':OUTPUT.stat().st_size,'sha256':sha(OUTPUT),'libraryPrimitiveDraws':draws,'libraryTriangles':triangles},'rocket':{'source':str(SRC.relative_to(REPO)),'sha256':sha(SRC),'author':'Kenney','license':'CC0-1.0','sourceTriangles':len(idx)//3,'sourceScale':scale,'sourceRotationY':math.pi,'sourceOffset':list(offset),'sourceBoreCenter':list(bore_source),'lengthZ':1.30,'helper':[0,bore_y,1.10],'mount':[-.95,1.20-bore_y,.80],'preserved':'All original source positions, split normals, UV, triangle topology, palette/atlas and integrated grip; no simplification or stripping'},'mine':{'design':'Original Giggle pressure-disc authored through Blender; shallow moulded shell, machined rim/plate, short bevelled fuze tabs and small armed-lamp slot','sourceLicense':'Original project authored content; Kenney atlas reused under CC0-1.0','mountedBranch':'Mine','deployedBranch':'MineTrap','lampNames':['MineLamp','MineTrapLamp'],'mount':[0,1.29,-1.35],'visualRadius':.410,'deployedBaseY':0},'atlas':{'path':str(ATLAS.relative_to(REPO)),'sha256':sha(ATLAS),'size':[512,512],'packing':'Original PNG embedded losslessly'},'pipeline':{'dcc':bpy.app.version_string,'editable':str((RECORD/'arsenal-mounted.blend').relative_to(REPO)),'optimization':'Pinned glTF Transform4.5.0 dedup/prune --keep-leaves; no lossy conversion/compression or quantization'},'scope':'Asset presentation only; root owns runtime/config/muzzles/rules and visual/live-fire acceptance.'}
record['projectileNormalsNote']='Original zero-area source triangles retained. Blender may assign fallback normals to their isolated nonrendering corners; all visible source normals/positions/material colors verified by actual loader.';record['seeker']=seeker_source|{'sourceBoreCenter':list(qsource_bore),'helper':[0,.50,1.10],'mount':[-.95,.70,.80]};record['projectiles']=shot_sources;record['bomb']=bomb_source|{'helper':[0,.50,1.10],'mount':[0,.70,.80]};(RECORD/'License-Kenney-Space-CC0.txt').write_bytes((RECORD/'sources/kenney-space-kit/License.txt').read_bytes())
(RECORD/'PROVENANCE.json').write_text(json.dumps(record,indent=2)+'\n');(RECORD/'License-Kenney-CC0.txt').write_bytes((SOURCE/'License.txt').read_bytes());print(json.dumps(record,indent=2))

# Bomb and Proximity share the exact projectile model. Render that geometry,
# not a mine/grenade substitute; all other existing thumbnails stay untouched.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.render.film_transparent=True
for o in scene.objects:o.hide_render=o.type=='MESH' and o.parent!=bomb_shot
camera_data=bpy.data.cameras.new('DynamiteThumbnailCamera');camera=bpy.data.objects.new('DynamiteThumbnailCamera',camera_data);bpy.context.collection.objects.link(camera);scene.camera=camera
camera.location=to_blender((1.4,1.05,1.65));camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.type='ORTHO';camera_data.ortho_scale=1.37
scene.world.color=(.30,.30,.30)
for name,location,energy,size in [('DynamiteKey',(-2,3,3),450,4),('DynamiteFill',(3,1,1),180,3)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=to_blender(location);o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
scene.view_settings.view_transform='AgX';scene.render.resolution_x=96;scene.render.resolution_y=96;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
thumb=REPO/'public/assets/karts/weapon-thumbnails/bomb.png';scene.render.filepath=str(thumb);bpy.ops.render.render(write_still=True);strip_png_metadata(thumb);thumb.with_name('proximity.png').write_bytes(thumb.read_bytes())
credits=thumb.with_name('CREDITS.txt');text=credits.read_text();line='Bomb and Proximity: Blender Cycles renders of the original Giggle seven-stick dynamite BombShot from arsenal-mounted.glb (scripts/build-kart-arsenal-mounted.py); red sticks, charcoal straps, cream fuse and proximity sensor; no external imagery.'
if line not in text:credits.write_text(text.rstrip()+'\n'+line+'\n')
for o in scene.objects:
 if o.type=='MESH':o.hide_render=o.parent!=trap
target=to_blender((0,.095,0));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.ortho_scale=.98
scene.render.filepath=str(thumb.with_name('mine.png'));bpy.ops.render.render(write_still=True);strip_png_metadata(thumb.with_name('mine.png'))
text=credits.read_text();line='Mine: Blender Cycles render of the independently grounded MineTrap pressure disc (no stowed rack or enlarged mounted gear) from the same arsenal-mounted source script; actual restrained red hardware lamp retained.'
if line not in text:credits.write_text(text.rstrip()+'\n'+line+'\n')
record['output']['meshopt']={'path':str(OUTPUT.with_suffix('.meshopt.glb').relative_to(REPO)),'bytes':OUTPUT.with_suffix('.meshopt.glb').stat().st_size,'sha256':sha(OUTPUT.with_suffix('.meshopt.glb')),'method':'EXT_meshopt_compression without quantization or simplification; exact float attributes, triangle winding retained (encoder may cyclically rotate triangle starting indices)'}
record['pipeline']['compressionVersions']={name:json.loads((modules/name/'package.json').read_text())['version'] for name in ['@gltf-transform/core','@gltf-transform/extensions','meshoptimizer']}
record['bomb']['thumbnails']=['public/assets/karts/weapon-thumbnails/bomb.png','public/assets/karts/weapon-thumbnails/proximity.png'];record['mine']['thumbnail']='public/assets/karts/weapon-thumbnails/mine.png';(RECORD/'PROVENANCE.json').write_text(json.dumps(record,indent=2)+'\n')
