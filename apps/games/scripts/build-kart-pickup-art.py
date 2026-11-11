# /// script
# dependencies = ["trimesh>=4.8,<5","numpy","scipy","pillow","fast-simplification>=0.1.12,<0.2"]
# ///
"""Build the editable Gear scene and its 96px HUD portraits. Pass an output GLB path."""
from pathlib import Path
import sys
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
    return sorted(model.split(only_watertight=False), key=lambda part:-len(part.faces))

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

def canister(size, color, belt):
    parts = [orb(size,(0,0,0),color)]
    for z in (-.21,.21):
        parts.append(cylinder(size[0]*.44,.1,(0,0,z),belt))
    return together(parts)

def draw(mesh, path):
    v, f = mesh.vertices, mesh.faces
    eye = tm.unitize((1.12,.87,1.40))
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

def models():
    mounted = 'combat/arsenal-mounted.glb'
    dart = asset(mounted,'SeekerShot')
    disc = asset(mounted,'MineTrap')
    # The next disc hides the fuzes on the lower two trays. Keep their
    # pressure shells and outside rim, with the complete sourced trap on top.
    rim = asset(mounted,'MineTrapRimAndFuze')
    rim.merge_vertices(merge_norm=True, merge_tex=True)
    lower_rim = max(rim.split(only_watertight=False, repair=False), key=lambda part: part.extents[0])
    lower_disc = together([asset(mounted,'MineTrapPressureShell'), lower_rim])
    iced = paint(fit(dart,(.47,.42,.97)), ICE)
    collar = cylinder(.22,.10,(0,0,-.1),'#409bcc')
    crystal = wing([(0,.12,0),(-.14,.2,0),(.02,.46,.03),(.11,.20,0),(0,.19,.12)],CREAM)
    ram = [orb((2.52,.2,.36),(0,0,0),NAVY)]
    for x in (-1.24,1.24):
        horn = wing([(x-.16,-.1,-.13),(x+.16,-.1,-.13),(x-.13,.13,-.10),
                     (x+.13,.13,-.10),(x,.31,.70)],GOLD)
        ram.append(horn)
    core = [orb((.51,.50,.51),(0,0,0),PLUM)]
    for angle in (-.73,.73):
        hoop = paint(tm.creation.torus(.33,.028,major_sections=24,minor_sections=6),CREAM)
        core.append(turn(hoop,angle,(1,0,0)))
    mine = [fit(lower_disc,(.72,.14,.68),(0,y,0)) for y in (-.13,.025)]
    mine.append(fit(disc,(.72,.14,.68),(0,.18,0)))
    shell = canister((.60,.60,.94),'#f38135',NAVY)
    tail = wing([(.10,-.03,-.45),(.10,.03,-.45),(.36,0,-.50),(.18,0,-.19)],NAVY)
    nuke = together([shell, cylinder(.13,.08,(0,0,-.44),CREAM)] +
                    [turn(tail.copy(),a*np.pi/2,(0,0,1)) for a in range(4)])
    burst = [fit(asset('combat/arsenal-secondary.glb','Scatter'),(.64,.37,.82),(0,-.06,-.15))]
    # The three tube openings and the three actual ray origins share their spacing.
    for x in (-.2,0,.2):
        burst += [cylinder(.095,.58,(x,0,.30),STEEL), cylinder(.105,.095,(x,0,.55),TEAL),
                  cylinder(.065,.098,(x,0,.551),NAVY), cylinder(.074,.09,(x,.06,-.48),CREAM)]

    return dict(cannon=rocket_parts()[2], machinegun=blaster(), blades=spinner(),
                missile=together([paint(fit(dart,(.55,.52,1.14)),RED),cylinder(.13,.16,(0,0,.11),CREAM)]),trishot=together(burst),
                mine=together(mine),proximity=fit(asset(mounted,'BombShot'),(.61,.47,.62)),
                fakecrate=fit(lighter_mount(asset('giggle-crate.glb','CrateRoot')),(.65,.65,.65)),
                nuke=nuke,supernova=together(core),frost=together([iced,collar,crystal]),ram=together(ram))

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
    for name,mesh in models().items():
        draw(mesh,ART / 'weapon-thumbnails' / (name+'.png'))
        if name != 'cannon':
            scene.add_geometry(linear_colors(mesh),node_name='Gear_'+name,geom_name='Gear_'+name)
    rocket,saddle,_ = rocket_parts()
    scene.add_geometry(linear_colors(saddle),node_name='Gear_cannon',geom_name='RocketSaddle')
    for i, offset in enumerate([(-.18,-.09,0),(.18,-.09,0),(0,.19,0)]):
        pose = tm.transformations.translation_matrix(offset)
        if i == 0:
            scene.add_geometry(linear_colors(rocket), node_name='Rocket0',geom_name='ToyRound',
                               parent_node_name='Gear_cannon',transform=pose)
        else:
            scene.graph.update(frame_to='Rocket'+str(i),frame_from='Gear_cannon',matrix=pose,geometry='ToyRound')
    Path(sys.argv[1]).write_bytes(tm.exchange.gltf.export_glb(scene,include_normals=True,tree_postprocessor=standard_material))
