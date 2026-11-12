# /// script
# dependencies = ["trimesh>=4.8,<5","numpy","scipy","pillow","fast-simplification>=0.1.12,<0.2"]
# ///
"""Build the editable Gear scene and its 96px HUD portraits. Pass an output GLB path."""
from pathlib import Path
import sys
import json
import hashlib
import numpy as np
import trimesh as tm
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'public/assets/karts'
SOURCE = ROOT / 'scripts/sources/kart-powerups'
NAVY, STEEL, CREAM, RED, GOLD = '#263348', '#728497', '#fff0cc', '#f34b46', '#ffbb43'
TEAL, ICE, PLUM = '#1fb89c', '#9febff', '#c944aa'

def paint(mesh, color):
    mesh.visual = tm.visual.ColorVisuals(mesh, vertex_colors=tm.visual.color.hex_to_rgba(color))
    return mesh

def fit(mesh, size, center=(0,0,0)):
    out = mesh.copy()
    out.apply_translation(-out.bounds.mean(axis=0))
    out.apply_scale(np.asarray(size) / np.maximum(out.extents, .00001))
    out.apply_translation(center)
    return out

def turn(mesh, angle, axis):
    mesh.apply_transform(tm.transformations.rotation_matrix(angle,axis))
    return mesh

def together(parts):
    return tm.util.concatenate(parts)

def cylinder(radius, height, position, color, *, upright=False):
    obj = paint(tm.creation.cylinder(radius, height, sections=16), color)
    if upright:
        turn(obj, -np.pi/2, (1,0,0))
    obj.apply_translation(position)
    return obj

def orb(size, position, color):
    return paint(fit(tm.creation.icosphere(subdivisions=2), size, position), color)

def components(filename):
    model = tm.load(SOURCE / filename, force='mesh')
    model.merge_vertices(merge_norm=True, merge_tex=True)
    return sorted(model.split(only_watertight=False, repair=False), key=lambda part:-len(part.faces))

def wing(vertices, color):
    return paint(tm.convex.convex_hull(np.array(vertices)), color)

def rocket_parts():
    body = components('rocketpod.glb')[1]
    body = fit(turn(body,np.pi/2,(1,0,0)), (.25,.25,1.15))
    rocket = [paint(body,CREAM), cylinder(.127,.14,(0,0,.31),RED),
              orb((.23,.23,.27),(0,0,.46),RED), cylinder(.10,.055,(0,0,-.58),NAVY),
              cylinder(.069,.057,(0,0,-.59),GOLD)]
    fin = wing([(0,-.04,-.51),(0,.04,-.51),(.20,0,-.51),(.09,0,-.20)], RED)
    rocket += [turn(fin.copy(),i*np.pi/2,(0,0,1)) for i in range(4)]
    single = together(rocket)
    pods = []
    for x,y in [(-.18,-.09),(.18,-.09),(0,.19)]:
        item = single.copy()
        item.apply_translation((x,y,0))
        pods.append(item)
    pods.append(orb((.72,.22,.58),(0,-.19,-.10),NAVY))
    return single, pods[-1], together(pods)

def spinner():
    parts = components('spinner.glb')
    washer = together([paint(part, STEEL if i==0 else TEAL if i==1 else GOLD)
                       for i,part in enumerate(parts)])
    washer = fit(turn(washer,-np.pi/2,(1,0,0)),(3.50,.18,3.50))
    tooth = wing([(1.60,-.03,-.15),(1.60,.06,-.15),(1.63,0,.30),
                  (2.19,-.01,.08),(2.16,.04,-.04)], CREAM)
    return together([washer]+[turn(tooth.copy(),i*np.pi/4,(0,1,0)) for i in range(8)])

def blaster():
    pieces = components('blaster.glb')
    housing = paint(fit(pieces[0],(.56,.40,.65),(0,0,-.22)), GOLD)
    parts = [housing,cylinder(.26,.14,(0,0,.06),NAVY),
             cylinder(.215,.1,(0,0,-.53),STEEL)]
    for i in range(5):
        angle = 2*np.pi*i/5
        x,y = .132*np.cos(angle),.132*np.sin(angle)
        parts += [paint(fit(pieces[5],(.135,.135,.54),(x,y,.31)), STEEL),
                  cylinder(.068,.09,(x,y,.55),GOLD),cylinder(.046,.093,(x,y,.552),NAVY)]
    return together(parts)

def asset(file, branch):
    scene = tm.load_scene(ART / file)
    parts = []
    def descend(name):
        matrix, key = scene.graph[name]
        if key:
            mesh = scene.geometry[key].copy()
            if mesh.visual.kind == 'texture':
                material = mesh.visual.material
                if mesh.visual.uv is not None:
                    mesh.visual = mesh.visual.to_color()
                else:
                    mesh.visual = tm.visual.ColorVisuals(mesh,vertex_colors=material.main_color)
            mesh.apply_transform(matrix)
            parts.append(mesh)
        for child in scene.graph.transforms.children.get(name,[]):
            descend(child)
    descend(branch)
    return together(parts)

def lighter_mount(mesh):
    # Keep disconnected details (in particular each raised question mark)
    # and pigment boundaries when reducing these multi-part, single-draw rigs.
    parts = []
    pigments = np.asarray(mesh.visual.face_colors)
    for color in np.unique(pigments, axis=0):
        surface = mesh.submesh([np.all(pigments == color, axis=1)], append=True)
        surface.merge_vertices(merge_norm=True, merge_tex=True)
        for part in surface.split(only_watertight=False, repair=False):
            if len(part.faces) > 32:
                part = part.simplify_quadric_decimation(face_count=max(16, len(part.faces) // 2))
            part.visual = tm.visual.ColorVisuals(part, vertex_colors=color)
            parts.append(part)
    return together(parts)

def draw(mesh, path, eye=(1.12,.87,1.40)):
    v, f = mesh.vertices, mesh.faces
    eye = tm.unitize(eye)
    right = tm.unitize(np.cross((0,1,0),eye))
    up = np.cross(eye,right)
    pos = np.column_stack((v@right,-v@up))
    pos -= (pos.min(axis=0)+pos.max(axis=0))*.5
    pos = pos*(343/max(np.ptp(pos,axis=0)))+192
    depth = v@eye
    colors = mesh.visual.face_colors[:,:3] / 255.
    light = .69+.31*np.maximum(0, mesh.face_normals@tm.unitize((-.35,.90,.58)))
    pixels = np.clip(255*colors*light[:,None],0,255).astype(int)
    image = Image.new('RGBA',(384,384))
    canvas = ImageDraw.Draw(image)
    for i in np.argsort(depth[f].mean(axis=1)):
        canvas.polygon([tuple(p) for p in pos[f[i]]],fill=tuple(pixels[i])+(255,))
    image.resize((96,96),Image.Resampling.LANCZOS).quantize(colors=208,method=Image.Quantize.FASTOCTREE).save(path,optimize=True)

def sourced(name, colors, size):
    pieces = components(name+'.glb')
    painted = [paint(piece, colors.get(i, colors.get('rest', STEEL)))
               for i,piece in enumerate(pieces)]
    mesh = together(painted)
    return fit(mesh,size)

def missile():
    parts = components('missile.glb')
    body = paint(parts[0], RED)
    centers = body.triangles_center
    colors = body.visual.face_colors.copy()
    # Paint the existing rear cap and swept fins. The dark cap, gold rim and
    # pale forward lens make direction clear from either end without new mesh.
    rear = centers[:,2] < -.23
    fins = (np.maximum(np.abs(centers[:,0]),np.abs(centers[:,1])) > .34) & (centers[:,2] < .15)
    colors[rear | fins] = tm.visual.color.hex_to_rgba(GOLD)
    colors[rear & (np.linalg.norm(centers[:,:2],axis=1)<.22)] = tm.visual.color.hex_to_rgba(NAVY)
    body.visual = tm.visual.ColorVisuals(body,face_colors=colors)
    return fit(together([body,paint(parts[1],ICE)]+[paint(p,GOLD) for p in parts[2:]]),(.55,.52,1.14))

def trishot():
    parts = components('trishot.glb')
    colors = {0:TEAL,1:CREAM,2:GOLD,3:GOLD,4:GOLD,5:GOLD}
    for i,part in enumerate(parts):
        paint(part,colors.get(i,NAVY))
        if i in (3,4,5):
            # These are the three real open tubes, not painted extra mouths.
            pigment=part.visual.face_colors.copy()
            centers=part.triangles_center
            radial=np.linalg.norm(centers[:,:2]-part.bounds.mean(axis=0)[:2],axis=1)
            pigment[(centers[:,2]<.20)|(radial<.075)]=tm.visual.color.hex_to_rgba(NAVY)
            part.visual=tm.visual.ColorVisuals(part,face_colors=pigment)
    return fit(together(parts),(.78,.43,.88))

def mine_round():
    pieces = components('mine.glb')
    # The stepped rim has most of the triangles. Reduce that surface alone;
    # keep the raised flower and its boundaries intact on all three rounds.
    pieces[0] = pieces[0].simplify_quadric_decimation(face_count=400)
    return fit(turn(together([paint(p, NAVY if i==0 else GOLD if i==1 else RED)
                              for i,p in enumerate(pieces)]),-np.pi/2,(1,0,0)),(.72,.14,.68))

def ram_bumper():
    parts = components('ram.glb')
    # Move the original curved horns onto the original bumper. The unwanted
    # vehicle body, wheels and tall cockpit hoop never enter the library.
    for i in (6,7):
        parts[i].apply_translation((0,-.18,.49))
    return fit(together([paint(parts[i], GOLD if i in (6,7) else TEAL if i==8 else NAVY)
                         for i in (6,7,8,10,12,20,23)]),(2.72,.55,.54))

def models():
    mine = mine_round()
    stack = []
    for y in (-.13,.025,.18):
        copy = mine.copy()
        copy.apply_translation((0,y,0))
        stack.append(copy)
    return dict(cannon=rocket_parts()[2], machinegun=blaster(), blades=spinner(),
        missile=missile(),
        trishot=trishot(),
        mine=together(stack),
        proximity=sourced('proximity',{0:TEAL,1:NAVY,2:GOLD,'rest':CREAM},(.61,.47,.62)),
        fakecrate=fit(lighter_mount(asset('giggle-crate.glb','CrateRoot')),(.65,.65,.65)),
        nuke=sourced('nuke',{0:RED,1:RED,2:NAVY,3:GOLD,4:CREAM,13:NAVY,'rest':GOLD},(.60,.62,.60)),
        supernova=sourced('supernova',{0:CREAM,9:PLUM,'rest':GOLD},(.72,.68,.55)),
        frost=sourced('frost',{0:TEAL,1:ICE,2:ICE,3:ICE,4:NAVY,5:TEAL,'rest':CREAM},(.62,.62,.82)),
        # The generation includes a cockpit and wheels. Keep only its actual
        # bumper, two curved horns and their braces for the snap-on accessory.
        ram=ram_bumper())

def standard_material(tree):
    tree['materials']=[{'name':'Toy enamel','pbrMetallicRoughness':{'metallicFactor':.15,'roughnessFactor':.53}}]
    for item in tree['meshes']:
        for part in item['primitives']:
            part['material']=0

def linear_colors(mesh):
    # glTF consumes linear color. The illustration and pigments use sRGB.
    rgba = mesh.visual.vertex_colors.copy()
    color = rgba[:,:3]/255.
    rgba[:,:3] = np.rint(255*np.where(color<=.04045,color/12.92,((color+.055)/1.055)**2.4))
    mesh.visual = tm.visual.ColorVisuals(mesh,vertex_colors=rgba)
    return mesh

if __name__ == '__main__':
    scene = tm.Scene()
    manifest = {'portraitSize':96,'models':{}}
    tasks = json.loads((SOURCE / 'source-tasks.json').read_text())
    for name,mesh in models().items():
        source_name = {'cannon':'rocketpod','machinegun':'blaster','blades':'spinner'}.get(name,name)
        source = ART / 'giggle-crate.glb' if name=='fakecrate' else SOURCE / (source_name+'.glb')
        manifest['models'][name] = {'node':'Gear_'+name,'triangles':len(mesh.faces)}
        manifest['models'][name]['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        task = tasks.get(name,{}).get('task') or {'cannon':'01a1cb50-3ce2-7597-b979-609cb35f69e5','machinegun':'01a1cb50-4d6a-726b-88ec-c8249837b0f8','blades':'01a1cb50-2f48-7787-9520-ac38b753ea53'}.get(name)
        if task:
            manifest['models'][name]['task'] = task
        draw(mesh,ART / 'weapon-thumbnails' / (name+'.png'),eye=(.65,.38,1.60) if name=='trishot' else (1.12,.87,1.40))
        if name not in ('cannon','mine'):
            scene.add_geometry(linear_colors(mesh),node_name='Gear_'+name,geom_name='Gear_'+name)
    scene.graph.update(frame_to='Gear_mine',frame_from='world',matrix=np.eye(4))
    for i,y in enumerate((-.13,.025,.18)):
        pose = tm.transformations.translation_matrix((0,y,0))
        if i == 0:
            scene.add_geometry(linear_colors(mine_round()),node_name='Mine0',geom_name='TrailRound',
                               parent_node_name='Gear_mine',transform=pose)
        else:
            scene.graph.update(frame_to='Mine'+str(i),frame_from='Gear_mine',matrix=pose,geometry='TrailRound')
    rocket,saddle,_ = rocket_parts()
    scene.add_geometry(linear_colors(saddle),node_name='Gear_cannon',geom_name='RocketSaddle')
    for i, offset in enumerate([(-.18,-.09,0),(.18,-.09,0),(0,.19,0)]):
        pose = tm.transformations.translation_matrix(offset)
        if i == 0:
            scene.add_geometry(linear_colors(rocket), node_name='Rocket0',geom_name='ToyRound',
                               parent_node_name='Gear_cannon',transform=pose)
        else:
            scene.graph.update(frame_to='Rocket'+str(i),frame_from='Gear_cannon',matrix=pose,geometry='ToyRound')
    (ART / 'weapon-thumbnails' / 'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    Path(sys.argv[1]).write_bytes(tm.exchange.gltf.export_glb(scene,include_normals=True,tree_postprocessor=standard_material))
