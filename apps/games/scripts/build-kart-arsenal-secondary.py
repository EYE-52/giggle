#!/usr/bin/env python3
"""Source-preserving Blender export for secondary kart rigs; frozen packs immutable."""
import hashlib,json,math,struct,subprocess,tempfile
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
REPO=Path(__file__).resolve().parents[1]
SOURCE=REPO/'assets-source/karts/weapon-candidates-20261007/kenney-blaster-2.1'
RECORD=REPO/'assets-source/karts/arsenal-secondary-20261007'
OUTPUT=REPO/'public/assets/karts/combat/arsenal-secondary.glb'
ATLAS=SOURCE/'Models/GLB format/Textures/colormap.png'
def to_blender(p): return Vector((p[0],-p[2],p[1]))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def unpack(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];n={'VEC2':2,'VEC3':3,'SCALAR':1}[a['type']];t={5126:'f',5121:'B',5123:'H',5125:'I'}[a['componentType']];size=n*struct.calcsize(t);off=v.get('byteOffset',0)+a.get('byteOffset',0)
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
def preserved_blaster(path,name,root,transform):
 sj,sb=unpack(path);sp=sj['meshes'][0]['primitives'][0]
 pp=accessor(sj,sb,sp['attributes']['POSITION']);nn=accessor(sj,sb,sp['attributes']['NORMAL']);tt=accessor(sj,sb,sp['attributes']['TEXCOORD_0']);ii=[i[0] for i in accessor(sj,sb,sp['indices'])]
 positions=[to_blender(transform@Vector(p)) for p in pp];d=bpy.data.meshes.new(name+'PreservedSurface');d.from_pydata(positions,[],[ii[i:i+3] for i in range(0,len(ii),3)]);d.update();layer=d.uv_layers.new(name='OriginalKenneyUV')
 for l in d.loops:layer.data[l.index].uv=(tt[l.vertex_index][0],1-tt[l.vertex_index][1])
 for p in d.polygons:p.use_smooth=True
 normal_matrix=transform.to_3x3().inverted().transposed();d.normals_split_custom_set([to_blender((normal_matrix@Vector(nn[l.vertex_index])).normalized()) for l in d.loops]);d.materials.append(colormap)
 o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.parent=root
 return o,{'source':str(path.relative_to(REPO)),'sha256':sha(path),'triangles':len(ii)//3,'transformGltf':list(sum((list(row) for row in transform),[])),'surfacePolicy':'Original triangle/UV/split-normal tuples retained under affine rigid/uniform normalization'}


RECORD.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE/'Models/GLB format/blaster-p.glb'))
original=next(o for o in bpy.context.scene.objects if o.type=='MESH');colormap=original.data.materials[0]
bpy.data.objects.remove(original,do_unlink=True)
for o in list(bpy.context.scene.objects):bpy.data.objects.remove(o,do_unlink=True)
charcoal=material('SecondarySaddleCharcoal',(41,50,59),.32,.62)
recipes={}
# Each helper measures an actual source aperture, never a rear/default muzzle.
for name,file,length,bore,floor,top,description in [
 ('Scatter','blaster-p',1.40,(0,.0010247565805912018,-.4310399889945984),.20,.32,'Lower of two exposed octagonal inner-lip rings'),
 ('Rail','blaster-f',1.55,(0,.05250000022351742,-.629999965429306),.26,.36,'Centroid of four oblique rectangular inner-lip vertices'),
 ('Grenade','blaster-l',1.05,(-.07557190954685211,.038947521398464836,-.2751751244068146),.10,.24,'Centroid of six inner boundary vertices of source left recessed aperture; twin-chamber candidate'),
 ('EMP','blaster-n',1.25,(0,.06795560661703348,-.3200500011444092),.04,.20,'Eight inner circular lip vertices between original fork guards')]:
 path=SOURCE/('Models/GLB format/'+file+'.glb');j,b=unpack(path);p=j['meshes'][0]['primitives'][0];pos=accessor(j,b,p['attributes']['POSITION']);front=min(p[2] for p in pos);scale=length/(max(p[2] for p in pos)-front)
 offset=Vector((0,.50-bore[1]*scale,1.10+front*scale));transform=Matrix.Translation(offset)@Matrix.Rotation(math.pi,4,'Y')@Matrix.Scale(scale,4)
 root=empty(name);housing,recipe=preserved_blaster(path,name+'Housing',root,transform)
 normalized_bore=transform@Vector(bore);root['kind']=name.lower();root['mount']=[.95-normalized_bore.x,1.20-normalized_bore.y,1.90-normalized_bore.z];root['source']='Kenney Blaster Kit2.1 / '+file+'; CC0-1.0'
 helper=empty(name+'MuzzleTip',root,normalized_bore);helper['measurement']=description;helper['forward']=[0.,0.,1.]
 # A connected fitted U saddle; rear foot rests on the actual sidepod top.
 verts=[]
 width=max(.11,min(.18,max(abs(p[0]) for p in pos)*scale+.012));inner=width-.045
 for z,bottom,base in [(.61-root['mount'][2],0,floor),(.70-root['mount'][2],0,floor),(.23,.16,max(.18,floor+.02))]:
  verts += [(x,y,z) for x,y in [(-.125,bottom),(.125,bottom),(width,top),(inner,top),(inner,base),(-inner,base),(-inner,top),(-width,top)]]
 faces=[tuple(range(7,-1,-1)),tuple(range(16,24))]
 for row in range(2):faces +=[(row*8+i,row*8+(i+1)%8,(row+1)*8+(i+1)%8,(row+1)*8+i) for i in range(8)]
 mesh(name+'Saddle',verts,faces,root,charcoal,bevel=.012)
 recipes[name]=recipe|{'length':length,'uniformScale':scale,'sourceBoreCenter':list(bore),'boreDescription':description,'helper':list(normalized_bore),'mount':list(root['mount'])}
# The original orange/red toy dart supplies a compact opaque projectile.
path=SOURCE/'Models/GLB format/bullet-foam-tip.glb';j,b=unpack(path);p=j['meshes'][0]['primitives'][0];ps=accessor(j,b,p['attributes']['POSITION']);length=.70;scale=length/(max(p[1] for p in ps)-min(p[1] for p in ps));center=Vector(tuple((min(p[a] for p in ps)+max(p[a] for p in ps))/2 for a in range(3)))
root=empty('ScatterShot');transform=Matrix.Rotation(math.pi/2,4,'X')@Matrix.Scale(scale,4)@Matrix.Translation(-center);_,recipe=preserved_blaster(path,'ScatterShotBody',root,transform);root['tipZ']=length/2;root['tailZ']=-length/2;root['projectileOrigin']='Geometric center; +Z original red tip; source toy dart colors retained';recipes['ScatterShot']=recipe|{'length':length}
empty('ScatterShotTip',root,(0,0,length/2));empty('ScatterShotTail',root,(0,0,-length/2))
# Grenade-a is a distinct authored cylindrical canister, uniformly normalized.
path=SOURCE/'Models/GLB format/grenade-a.glb';j,b=unpack(path);p=j['meshes'][0]['primitives'][0];ps=accessor(j,b,p['attributes']['POSITION']);center=Vector(tuple((min(p[a] for p in ps)+max(p[a] for p in ps))/2 for a in range(3)));radius=max((Vector(p)-center).length for p in ps);scale=.27/radius
root=empty('GrenadeShot');_,recipe=preserved_blaster(path,'GrenadeShotCanister',root,Matrix.Scale(scale,4)@Matrix.Translation(-center));root['projectileOrigin']='Geometric center; .27m source enclosing radius';root['source']='Kenney grenade-a cylindrical canister; CC0-1.0';recipes['GrenadeShot']=recipe|{'radius':.27,'uniformScale':scale}
for image in bpy.data.images:
 if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(RECORD/'arsenal-secondary.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',export_yup=True,export_extras=True,export_normals=True,export_tangents=False,export_animations=False,export_cameras=False,export_lights=False)
with tempfile.TemporaryDirectory(prefix='arsenal-secondary-') as tmp:
 intermediate=Path(tmp)/'dedup.glb';cli=['npx','--yes','@gltf-transform/cli@4.5.0'];subprocess.run(cli+['dedup',str(OUTPUT),str(intermediate)],check=True);subprocess.run(cli+['prune',str(intermediate),str(OUTPUT),'--keep-leaves','true'],check=True)
record={'status':'Source-backed secondary candidates for root visual/runtime review; not accepted art','output':{'path':str(OUTPUT.relative_to(REPO)),'bytes':OUTPUT.stat().st_size,'sha256':sha(OUTPUT)},'recipes':recipes,'license':'Kenney CC0-1.0; original source mesh/bevels/UV/split normals/colors retained','atlas':{'path':str(ATLAS.relative_to(REPO)),'sha256':sha(ATLAS),'packing':'Original512 PNG unchanged, embedded'},'editable':str((RECORD/'arsenal-secondary.blend').relative_to(REPO)),'scope':'No frozen assets/runtime/simulation/config edits','limits':['Grenade uses original twin-chamber blaster-l; not a literal source grenade launcher. Actual source left aperture helper is offsetX; metadata compensates to canonical muzzle. Review role suitability.','ScatterShot retains original orange/red toy-dart source colors.','RailShot intentionally omitted: energy streak remains runtime VFX, not invented source geometry.']}
(RECORD/'PROVENANCE.json').write_text(json.dumps(record,indent=2)+'\n');(RECORD/'License-Kenney-CC0.txt').write_bytes((SOURCE/'License.txt').read_bytes());print(json.dumps(record,indent=2))
