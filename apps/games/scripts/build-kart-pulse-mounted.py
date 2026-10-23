#!/usr/bin/env python3
"""Normalize licensed Kenney h and author one fitted saddle; never modifies combat.glb.

/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-kart-pulse-mounted.py
Then: node test/kart-pulse-mounted.mjs
Source forward is -Z. Blender import maps glTF Y-up to Z-up; export reverses it.
All geometry is authored/exported through Blender, not patched into the GLB binary.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import tempfile

import bpy
from mathutils import Matrix, Vector

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / 'assets-source/karts/weapon-candidates-20261007/kenney-blaster-2.1'
RECORD = REPO / 'assets-source/karts/pulse-mounted-20261007'
OUTPUT = REPO / 'public/assets/karts/combat/pulse-mounted.glb'
SOURCE_GLB = SOURCE / 'Models/GLB format/blaster-h.glb'
ATLAS = SOURCE / 'Models/GLB format/Textures/colormap.png'
SCALE = 1.45 / (.32399997115135193 + .3240000009536743)
# Eight authored inner lip vertices form an oblique octagonal opening.
# The ring is identified by its source UV strip and front-most inner contour.
BORE_SOURCE = Vector((0, .023752873297214508, -.2939999997615814))
BODY_OFFSET = Vector((0, .50 - BORE_SOURCE.y * SCALE,
                      1.10 - .3240000009536743 * SCALE))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gltf_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def glb_json(path):
    b = path.read_bytes()
    return json.loads(b[20:20 + struct.unpack_from('<I', b, 12)[0]])


def build():
    RECORD.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_GLB))
    original = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    assert len(original) == 1, 'Expected untouched single h mesh'
    body = original[0]
    body.name = 'PulseHousing'
    source_polygons = len(body.data.polygons)
    source_triangles = sum(len(p.vertices)-2 for p in body.data.polygons)
    assert source_triangles == 296
    # Blender's importer/transform application can repair inconsistent source
    # split normals. Preserve the authored surface tuples explicitly, through
    # Blender mesh/loop APIs, rather than accepting that implicit repair.
    source_bytes = SOURCE_GLB.read_bytes()
    source_json = glb_json(SOURCE_GLB)
    json_length = struct.unpack_from('<I', source_bytes, 12)[0]
    binary = source_bytes[28+json_length:]
    primitive = source_json['meshes'][0]['primitives'][0]
    def accessor(index):
        a = source_json['accessors'][index]
        view = source_json['bufferViews'][a['bufferView']]
        n = {'VEC2':2,'VEC3':3,'SCALAR':1}[a['type']]
        t = {5126:'f',5123:'H'}[a['componentType']]
        size = struct.calcsize(t)*n
        offset = view.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+t*n,binary,offset+i*view.get('byteStride',size)) for i in range(a['count'])]
    positions = accessor(primitive['attributes']['POSITION'])
    normals = accessor(primitive['attributes']['NORMAL'])
    uvs = accessor(primitive['attributes']['TEXCOORD_0'])
    indices = [i[0] for i in accessor(primitive['indices'])]
    normalized = [gltf_to_blender((-p[0]*SCALE,p[1]*SCALE+BODY_OFFSET.y,
                                  -p[2]*SCALE+BODY_OFFSET.z)) for p in positions]
    original_materials = list(body.data.materials)
    preserved = bpy.data.meshes.new('PulseOriginalSurface')
    preserved.from_pydata(normalized,[],[indices[i:i+3] for i in range(0,len(indices),3)])
    preserved.update()
    uv_layer = preserved.uv_layers.new(name='OriginalKenneyUV')
    for loop in preserved.loops:
        # glTF UV origin is top-left; Blender UV origin is bottom-left.
        uv = uvs[loop.vertex_index]
        uv_layer.data[loop.index].uv = (uv[0],1-uv[1])
    for poly in preserved.polygons:
        poly.use_smooth = True
    preserved.normals_split_custom_set([gltf_to_blender((-normals[loop.vertex_index][0],
                                  normals[loop.vertex_index][1],-normals[loop.vertex_index][2])) for loop in preserved.loops])
    for material in original_materials:
        preserved.materials.append(material)
    body.data = preserved
    body.matrix_world = Matrix.Identity(4)
    assert len(body.data.polygons) == source_polygons
    assert body.data.uv_layers and body.data.has_custom_normals
    for image in bpy.data.images:
        if image.source == 'FILE':
            image.pack()
    root = bpy.data.objects.new('Pulse', None)
    bpy.context.collection.objects.link(root)
    body.parent = root

    # A single machined U saddle: the grip nests between cheeks and into the
    # base; cheek tops contact the receiver. One connected extruded contour,
    # applied 18 mm three-segment bevels, rather than stacked primitive boxes.
    # Rear foot fits actual SidePod_RMesh top Y=.70, X=.575..1.085,
    # Z=-.67...71 after exact mount. Forward underside rises above the
    # front tire envelope, leaving only the rear foot as the contact plane.
    stations = [(-.325,0,.145),(-.18,0,.145),(.18,.22,.285)]
    n = 8
    verts = []
    for z,bottom,floor in stations:
        section = [(-.125,bottom),(.125,bottom),(.195,.395),(.12,.395),
                   (.12,floor),(-.12,floor),(-.12,.395),(-.195,.395)]
        verts += [gltf_to_blender((x,y,z)) for x,y in section]
    faces = [tuple(range(n-1,-1,-1)),tuple(range((len(stations)-1)*n,len(stations)*n))]
    for station in range(len(stations)-1):
        a,b=station*n,(station+1)*n
        faces += [(a+i,a+(i+1)%n,b+(i+1)%n,b+i) for i in range(n)]
    mesh = bpy.data.meshes.new('PulseSaddleMesh')
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    saddle = bpy.data.objects.new('PulseSaddle', mesh)
    bpy.context.collection.objects.link(saddle)
    saddle.parent = root
    material = bpy.data.materials.new('PulseSaddleCharcoal')
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    # Charcoal 0x29323b converted from sRGB to linear; restrained machined matte.
    def linear(n):
        v=n/255
        return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    bsdf.inputs['Base Color'].default_value = tuple(linear(v) for v in (41,50,59))+(1,)
    bsdf.inputs['Roughness'].default_value = .62
    bsdf.inputs['Metallic'].default_value = .32
    mesh.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    saddle.select_set(True)
    bpy.context.view_layer.objects.active = saddle
    bevel = saddle.modifiers.new('Machined edge radii 18mm', 'BEVEL')
    bevel.width = .018
    bevel.segments = 3
    bevel.affect = 'EDGES'
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    # Recalculate facing for the concave contour before setting weighted normals.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for poly in mesh.polygons:
        poly.use_smooth = True
    normal = saddle.modifiers.new('Machined weighted normals', 'WEIGHTED_NORMAL')
    normal.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=normal.name)

    bore = Vector((-BORE_SOURCE.x*SCALE,
                   BORE_SOURCE.y*SCALE+BODY_OFFSET.y,
                   -BORE_SOURCE.z*SCALE+BODY_OFFSET.z))
    helper = bpy.data.objects.new('PulseMuzzleTip', None)
    bpy.context.collection.objects.link(helper)
    helper.parent = root
    helper.location = gltf_to_blender(bore)
    helper.empty_display_type = 'ARROWS'
    helper.empty_display_size = .075
    root['kind'] = 'pulse'
    root['mount'] = [.95, 1.20-bore.y, 1.90-bore.z]
    root['source'] = 'Kenney Blaster Kit 2.1 / blaster-h; CC0-1.0'
    root['presentation'] = 'Uniform normalized original housing + original fitted machined saddle'
    root['mountContract'] = 'Saddle base Y=0; +Z forward; max front lip Z=1.10; actual oblique bore recorded by helper'
    helper['measurement'] = 'Centroid of original 8 inner lip vertices on oblique muzzle face'
    helper['forward'] = [0.,0.,1.]
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(RECORD/'pulse-mounted.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',
                              export_yup=True,export_extras=True,
                              export_normals=True,export_tangents=True,
                              export_animations=False,export_cameras=False,
                              export_lights=False)
    # Preserve named leaf helper and lossless atlas. Do not quantize/simplify or
    # add compression decoders for this small 2-draw file.
    with tempfile.TemporaryDirectory(prefix='pulse-mounted-') as tmp:
        deduped = Path(tmp)/'dedup.glb'
        cli = ['npx','--yes','@gltf-transform/cli@4.5.0']
        subprocess.run(cli+['dedup',str(OUTPUT),str(deduped)],check=True)
        subprocess.run(cli+['prune',str(deduped),str(OUTPUT),'--keep-leaves','true'],check=True)
    j = glb_json(OUTPUT)
    draws = sum(len(m['primitives']) for m in j['meshes'])
    triangles = sum(j['accessors'][p['indices']]['count']//3 for m in j['meshes'] for p in m['primitives'])
    assert draws<=3 and triangles<1500
    assert len(j['images'])==1 and j['images'][0].get('bufferView') is not None
    assert not any(i.get('uri') for i in j['images'])
    record = {
        'status':'Concrete asset exported for root integration/review; art acceptance pending',
        'source':{'author':'Kenney','pack':'Blaster Kit 2.1','url':'https://kenney.nl/assets/blaster-kit','license':'CC0-1.0',
                  'glb':str(SOURCE_GLB.relative_to(REPO)),'sha256':sha(SOURCE_GLB),
                  'texture':str(ATLAS.relative_to(REPO)),'textureSha256':sha(ATLAS),'texturePixels':[512,512]},
        'output':{'path':str(OUTPUT.relative_to(REPO)),'bytes':OUTPUT.stat().st_size,'sha256':sha(OUTPUT),
                  'draws':draws,'triangles':triangles,'materials':len(j['materials'])},
        'geometry':{'housingSourceTriangles':source_triangles,'sourceUniformScale':SCALE,
                    'sourceRotationY':math.pi,'sourceOffset':list(BODY_OFFSET),'lengthZ':1.45,'frontLipMaxZ':1.1,
                    'sourceMeshChanges':'None removed or simplified; source triangle/UV/split normal tuples copied into Blender and uniformly transformed; integrated grip retained',
                    'saddle':'One connected U loft with tapered rear contact foot and raised forward underside; 18mm 3-segment applied bevel; weighted normals; charcoal matte',
                    'pivot':'Center X=0 at saddle base Y=0, Z=0'},
        'muzzle':{'sourceInnerLipCenter':list(BORE_SOURCE),'assetInnerLipCenter':list(bore),
                  'helper':'PulseMuzzleTip','mount':[.95,1.20-bore.y,1.90-bore.z],'targetMountYForChassisMuzzleY0_50':1.20-bore.y,
                  'targetMountZForChassisMuzzleZ1_90':1.90-bore.z,
                  'caveat':'Source muzzle is oblique: actual opening center is ~.06713m behind forwardmost lip. Exact helper-derived metadata aligns chassis muzzle; no simulation changes here.'},
        'pipeline':{'dcc':bpy.app.version_string,'optimization':'gltf-transform 4.5.0 dedup + prune --keep-leaves true; no simplification, lossy texture conversion, geometry quantization or compression',
                    'editableSource':str((RECORD/'pulse-mounted.blend').relative_to(REPO))},
        'validationScope':'Run actual Three GLTFLoader test; native live app/visual firing acceptance owned by root, pending.'}
    (RECORD/'PROVENANCE.json').write_text(json.dumps(record,indent=2)+'\n')
    (RECORD/'License-Kenney-CC0.txt').write_bytes((SOURCE/'License.txt').read_bytes())
    print(json.dumps(record['output']|record['muzzle'],indent=2),flush=True)


build()
