#!/usr/bin/env python3
"""Build original Giggle Karts combat art assets in Blender, export combat.glb.

Original authored content (no ripped assets): mystery supply crate, six
rear-mount weapon rigs (Pulse/Scatter/Mine/Shield/Rocket/Rail) and four
projectile shots (Bolt pulse+scatter variants, RocketShot, RailShot).

Usage (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
      --python scripts/build-kart-combat-assets.py -- \\
      --out-dir public/assets/karts/combat \\
      --blend assets-source/karts/giggle-combat.blend \\
      --stats-out /tmp/giggle-karts-polish-20261006/glb-stats.json

Conventions (verified by this script, see glb-report.md):
  - Three.js runtime: noses/muzzles point +Z, ground plane y=0.
  - Pickup/Mine origins at ground (base y=0). Weapons at mount point,
    barrel +Z. Shots centered, nose +Z, tracer -Z.
  - Blender working space is Z-up; forward is built at S*+Y where S is a
    trial-export sign (+1/-1) flipped automatically when the verified GLB
    nose marker does not land on +Z. Never trust memory: inspect.
  - All part rotations/scales baked into mesh vertices; exported mesh nodes
    carry translations only (identity rotation/scale).
  - One mesh per material per model part (joined in bmesh): Pickup 6,
    Mine 4 (prop uses 3, rig uses 3), Bolt 6 (two 3-mesh variants),
    every other model <= 3 meshes.
  - Materials use NO textures/UVs. Glow/tracer meshes use emissive
    Principled so the GLB reads correctly standalone; the runtime factory
    swaps tracers/glows to pooled additive basics (documented).
"""

import argparse
import json
import math
import os
import struct
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COMBAT_MODELS = ["Pickup", "Pulse", "Scatter", "Mine", "Shield",
                 "Rocket", "Rail", "Bolt", "RocketShot", "RailShot", "Grenade", "EMP", "GrenadeShot"]


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Build Giggle Karts combat GLB.")
    ap.add_argument("--out-dir", default=os.path.join(
        REPO_ROOT, "public", "assets", "karts", "combat"))
    ap.add_argument("--blend", default=os.path.join(
        REPO_ROOT, "assets-source", "karts", "giggle-combat.blend"))
    ap.add_argument("--stats-out", default="/tmp/giggle-karts-polish-20261006/glb-stats.json")
    ap.add_argument("--tmp-dir", default=os.environ.get("TMPDIR", "/tmp"))
    return ap.parse_args(argv)


def srgb_to_linear(c):
    def f(v):
        v = v / 255.0
        if v <= 0.04045:
            return v / 12.92
        return ((v + 0.055) / 1.055) ** 2.4
    return (f(c[0]), f(c[1]), f(c[2]), 1.0)


def hex_rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def compose(center, euler_xyz=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)):
    rx, ry, rz = euler_xyz
    sx, sy, sz = scale
    m = Matrix.Translation(Vector(center))
    m = m @ Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4()
    m = m @ Matrix(((sx, 0, 0, 0), (0, sy, 0, 0),
                    (0, 0, sz, 0), (0, 0, 0, 1)))
    return m


_MATS = {}


def make_mat(name, hex_color, metallic=0.0, roughness=0.5,
             emissive_hex=None, emissive_strength=0.0):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = srgb_to_linear(hex_rgb(hex_color))
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emissive_hex:
        bsdf.inputs["Emission Color"].default_value = srgb_to_linear(
            hex_rgb(emissive_hex))
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    _MATS[name] = mat
    return mat


def build_materials():
    return {
        "Amber": make_mat("CombatAmber", "#FFB020", roughness=0.65),
        "Coral": make_mat("CombatCoral", "#F2545B", roughness=0.6),
        "Metal": make_mat("CombatMetal", "#25334A", metallic=0.85,
                          roughness=0.4),
        "Mint": make_mat("CombatMint", "#2FE8B0", roughness=0.5,
                         emissive_hex="#0E9B8A", emissive_strength=0.5),
        "MintGlow": make_mat("CombatMintGlow", "#83FFE0", roughness=0.4,
                             emissive_hex="#83FFE0", emissive_strength=1.0),
        "Cream": make_mat("CombatCream", "#FFF6E8", roughness=0.55),
        "Cyan": make_mat("CombatCyan", "#35D5FF", roughness=0.45,
                         emissive_hex="#1A9FD4", emissive_strength=0.8),
        "CyanGlow": make_mat("CombatCyanGlow", "#6AF0FF", roughness=0.35,
                             emissive_hex="#6AF0FF", emissive_strength=1.0),
        "Ember": make_mat("CombatSteel", "#C3CDD8", metallic=0.55, roughness=0.26),
        "EmberGlow": make_mat("CombatEmberGlow", "#FF8A3C", roughness=0.35,
                              emissive_hex="#FF8A3C", emissive_strength=1.0),
        "PinkGlow": make_mat("CombatPinkGlow", "#FF6AD5", roughness=0.35,
                             emissive_hex="#FF6AD5", emissive_strength=1.0),
        "Red": make_mat("CombatRed", "#E02020", roughness=0.45,
                        emissive_hex="#E02020", emissive_strength=0.9),
        "RedGlow": make_mat("CombatRedGlow", "#FF2A35", roughness=0.35,
                            emissive_hex="#FF2A35", emissive_strength=1.0),
        "Ice": make_mat("CombatBore", "#05070A", roughness=0.95),
        "Warm": make_mat("CombatBrass", "#C9A227", metallic=0.85, roughness=0.35),
    }


def clear_scene():
    try:
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
    except RuntimeError:
        pass
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def new_collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def clear_collection(coll):
    for obj in list(coll.objects):
        me = obj.data if hasattr(obj, "data") and hasattr(obj.data, "users") else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if me is not None and getattr(me, "users", 1) == 0:
            try:
                bpy.data.meshes.remove(me)
            except (ReferenceError, RuntimeError):
                pass


def new_empty(name, coll, location=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = location
    coll.objects.link(obj)
    return obj


def parent_keep(parent, child):
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


# --------------------------------------------------------------------------
# bmesh builders (transforms baked into vertices; objects stay identity)
# --------------------------------------------------------------------------

_BOX_FACES = (
    (0, 3, 2, 1),
    (4, 5, 6, 7),
    (0, 1, 5, 4),
    (3, 7, 6, 2),
    (1, 2, 6, 5),
    (0, 4, 7, 3),
)


def bm_box(bm, matrix, mat_idx):
    base = [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5),
            (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
            (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5),
            (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]
    verts = [bm.verts.new(matrix @ Vector(co)) for co in base]
    bm.verts.ensure_lookup_table()
    for quad in _BOX_FACES:
        try:
            face = bm.faces.new([verts[i] for i in quad])
        except ValueError:
            continue
        face.material_index = mat_idx
    return verts


def bm_cyl(bm, r1, r2, depth, segs, matrix, mat_idx):
    before = set(bm.faces)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs,
                          radius1=r1, radius2=r2, depth=depth,
                          matrix=matrix, calc_uvs=False)
    for face in bm.faces:
        if face not in before:
            face.material_index = mat_idx


def bm_tube(bm, outer, inner, depth, segs, matrix, mat_idx):
    rings = []
    for z, radius in [(-depth/2, outer), (depth/2, outer),
                      (-depth/2, inner), (depth/2, inner)]:
        rings.append([bm.verts.new(matrix @ Vector((radius*math.cos(i*2*math.pi/segs),
                        radius*math.sin(i*2*math.pi/segs), z))) for i in range(segs)])
    for a, b in [(0,1), (3,2), (2,0), (1,3)]:
        for i in range(segs):
            j = (i+1) % segs
            f = bm.faces.new([rings[a][i], rings[a][j], rings[b][j], rings[b][i]])
            f.material_index = mat_idx


def tube_y(bm, outer, inner, depth, segs, center, mat_idx, S):
    bm_tube(bm, outer, inner, depth, segs, compose(center, (S * math.pi / 2.0,0,0)), mat_idx)


def cyl_y(bm, r_front, r_back, depth, segs, center, mat_idx, S):
    """Cylinder/cone along Blender Y: front cap faces S*+Y (Three +Z nose)."""
    bm_cyl(bm, r_front, r_back, depth, segs,
           compose(center, (S * math.pi / 2.0, 0.0, 0.0)), mat_idx)


def bm_octa(bm, radius, matrix, mat_idx):
    r = radius
    top = bm.verts.new(matrix @ Vector((0.0, 0.0, r)))
    bot = bm.verts.new(matrix @ Vector((0.0, 0.0, -r)))
    ring = [bm.verts.new(matrix @ Vector((r, 0.0, 0.0))),
            bm.verts.new(matrix @ Vector((0.0, r, 0.0))),
            bm.verts.new(matrix @ Vector((-r, 0.0, 0.0))),
            bm.verts.new(matrix @ Vector((0.0, -r, 0.0)))]
    bm.verts.ensure_lookup_table()
    for i in range(4):
        try:
            f = bm.faces.new([top, ring[i], ring[(i + 1) % 4]])
            f.material_index = mat_idx
        except ValueError:
            pass
        try:
            f = bm.faces.new([bot, ring[(i + 1) % 4], ring[i]])
            f.material_index = mat_idx
        except ValueError:
            pass


def mesh_from_bm(name, bm, mats, coll, location=(0.0, 0.0, 0.0)):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    for m in mats:
        me.materials.append(m)
    obj.location = Vector(location)
    coll.objects.link(obj)
    return obj


def _activate(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def _deactivate(obj):
    obj.select_set(False)


def add_bevel(obj, width, segments=1, limit="ANGLE", angle_deg=30.0):
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = limit
    if limit == "ANGLE":
        mod.angle_limit = math.radians(angle_deg)
    _activate(obj)
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    finally:
        _deactivate(obj)


def shade_all(obj, smooth=False):
    for poly in obj.data.polygons:
        poly.use_smooth = smooth


def finish(obj, bevel_width=0.0, smooth=False):
    if bevel_width > 0.0:
        add_bevel(obj, bevel_width, segments=1)
    shade_all(obj, smooth=smooth)


# --------------------------------------------------------------------------
# Combat models (Blender Z-up; forward is S*+Y, S = trial nose sign)
# --------------------------------------------------------------------------

def build_pickup(coll, mats, root, S):
    g = new_empty("Pickup", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)
    Y = lambda v: S * v  # noqa: E731

    bm = bmesh.new()
    bm_box(bm, compose((0.0, 0.0, 0.61), scale=(1.5, 1.5, 1.1)), 0)
    o = mesh_from_bm("PickupBody", bm, [mats["Amber"]], coll)
    finish(o, bevel_width=0.03)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_box(bm, compose((0.0, 0.0, 1.27), scale=(1.62, 1.62, 0.22)), 0)
    o = mesh_from_bm("PickupLid", bm, [mats["Coral"]], coll)
    finish(o, bevel_width=0.03)
    parent_keep(g, o)

    bm = bmesh.new()
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            for z in (0.18, 1.04):
                bm_box(bm, compose((sx * 0.68, sy * 0.68, z),
                                   scale=(0.24, 0.24, 0.24)), 0)
    for sx in (-1.0, 1.0):
        bm_box(bm, compose((sx * 0.4, Y(-0.79), 1.15),
                           scale=(0.3, 0.08, 0.18)), 0)
    for sx in (-1.0, 1.0):
        bm_box(bm, compose((sx * 0.78, 0.0, 0.65),
                           scale=(0.06, 0.3, 1.1)), 0)
    o = mesh_from_bm("PickupMetal", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.015)
    parent_keep(g, o)

    bm = bmesh.new()
    for face in (1.0, -1.0):
        y = Y(face * 0.80)
        bm_box(bm, compose((0.0, y, 0.98), scale=(0.5, 0.1, 0.14)), 0)
        bm_box(bm, compose((0.18, y, 0.80), scale=(0.14, 0.1, 0.24)), 0)
        bm_box(bm, compose((0.0, y, 0.64), scale=(0.5, 0.1, 0.14)), 0)
        bm_box(bm, compose((-0.05, y, 0.48), scale=(0.14, 0.1, 0.2)), 0)
        bm_box(bm, compose((-0.05, y, 0.26), scale=(0.15, 0.1, 0.15)), 0)
    o = mesh_from_bm("PickupGlyph", bm, [mats["Cream"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    for face in (1.0, -1.0):
        bm_octa(bm, 0.35, compose((0.0, Y(face * 0.72), 0.68),
                                  scale=(1.0, 0.35, 1.25)), 0)
    o = mesh_from_bm("PickupBadge", bm, [mats["MintGlow"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_cyl(bm, 1.15, 1.15, 0.06, 24, compose((0.0, 0.0, 0.03)), 0)
    o = mesh_from_bm("PickupPad", bm, [mats["MintGlow"]], coll)
    finish(o)
    parent_keep(g, o)
    bpy.context.view_layer.update()
    return g


def build_pulse_rig(coll, mats, root, S):
    g = new_empty("Pulse", coll, (0.0, 0.0, 0.0)); parent_keep(root, g)
    Y = lambda v: S * v
    bm = bmesh.new()
    for pos, size in [((0,Y(-.1),.06),(.34,.6,.12)),
                      ((0,Y(-.2),.3),(.26,.5,.3)),
                      ((0,Y(-.32),.16),(.1,.16,.22)),
                      ((0,Y(-.15),.47),(.08,.5,.06))]:
        bm_box(bm, compose(pos, scale=size), 0)
    cyl_y(bm,.085,.095,1.15,12,(0,Y(.375),.3),0,S)
    tube_y(bm,.11,.06,.2,12,(0,Y(1.0),.3),0,S)
    o=mesh_from_bm("PulseBody",bm,[mats["Metal"]],coll); finish(o,bevel_width=.012); parent_keep(g,o)
    bm=bmesh.new()
    bm_cyl(bm,.2,.2,.14,14,compose((-.26,Y(-.25),.28),(0,math.pi/2,0)),0)
    for x,z,h in [(-.17,-.22,.36),(-.1,-.2,.4),(-.03,-.18,.43)]:
        bm_box(bm,compose((x,Y(z),h),scale=(.1,.12,.07)),0)
    o=mesh_from_bm("PulseFins",bm,[mats["Warm"]],coll); finish(o); parent_keep(g,o)  # ammo drum/belt
    bm=bmesh.new(); cyl_y(bm,.055,.055,.04,12,(0,Y(1.055),.3),0,S)
    o=mesh_from_bm("PulseMuzzle",bm,[mats["Ice"]],coll); finish(o); parent_keep(g,o)
    parent_keep(g,new_empty("PulseMuzzleTip",coll,(0,Y(1.10),.3)))
    bpy.context.view_layer.update(); return g


def build_scatter_rig(coll, mats, root, S):
    g = new_empty("Scatter", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)
    Y = lambda v: S * v  # noqa: E731

    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(-0.32), 0.24), scale=(0.5, 0.42, 0.42)), 0)
    cyl_y(bm, 0.09, 0.1, 1.0, 10, (0.0, Y(0.28), 0.42), 0, S)
    cyl_y(bm, 0.09, 0.1, 1.0, 10, (-0.17, Y(0.28), 0.18), 0, S)
    cyl_y(bm, 0.09, 0.1, 1.0, 10, (0.17, Y(0.28), 0.18), 0, S)
    bm_box(bm, compose((0.0, Y(-0.3), 0.52), scale=(0.08, 0.2, 0.14)), 0)
    bm_box(bm, compose((0.0, Y(-0.32), 0.06), scale=(0.2, 0.2, 0.12)), 0)
    o = mesh_from_bm("ScatterBody", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.02)
    parent_keep(g, o)

    bm = bmesh.new()
    for x, h in [(0,.42),(-.17,.18),(.17,.18)]:
        tube_y(bm,.12,.062,.16,12,(x,Y(.82),h),0,S)
    o = mesh_from_bm("ScatterMuzzles", bm, [mats["Warm"]], coll)
    finish(o)
    parent_keep(g, o)

    tip = new_empty("ScatterMuzzleTip", coll, (0.0, Y(0.90), 0.42))
    parent_keep(g, tip)
    bpy.context.view_layer.update()
    return g


def build_mine(coll, mats, root, S):
    g = new_empty("Mine", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)

    bm = bmesh.new()
    bm_cyl(bm, 0.8, 0.86, 0.28, 18, compose((0.0, 0.0, 0.14)), 0)
    for i in range(10):
        a = (float(i) / 10.0) * math.pi * 2.0
        bm_cyl(bm, 0.0, 0.09, 0.24, 6,
               compose((math.cos(a) * 0.72, math.sin(a) * 0.72, 0.42)), 0)
    o = mesh_from_bm("MineDisk", bm, [mats["Metal"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_tube(bm, .32, .14, .12, 14, compose((0,0,.36)), 0)
    o = mesh_from_bm("MineCap", bm, [mats["Red"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_cyl(bm, .13, .13, .08, 12, compose((0,0,.355)), 0)
    o = mesh_from_bm("MineGlow", bm, [mats["RedGlow"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_box(bm, compose((0.0, 0.0, 0.11), scale=(0.7, 0.7, 0.22)), 0)
    for sx in (-1.0, 1.0):
        bm_box(bm, compose((sx * 0.36, 0.0, 0.2), scale=(0.08, 0.7, 0.3)), 0)
    o = mesh_from_bm("MineRack", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.02)
    parent_keep(g, o)

    tip = new_empty("MineMuzzleTip", coll, (0.0, 0.0, 0.5))
    parent_keep(g, tip)
    bpy.context.view_layer.update()
    return g


def build_shield_rig(coll, mats, root, S):
    g = new_empty("Shield", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)

    bm = bmesh.new()
    bm_cyl(bm, 0.35, 0.42, 0.18, 6, compose((0.0, 0.0, 0.09)), 0)
    for i in range(3):
        a = (float(i) / 3.0) * math.pi * 2.0
        bm_box(bm, compose((math.cos(a) * 0.22, math.sin(a) * 0.22, 0.35),
                           (-0.35 * math.sin(a), 0.35 * math.cos(a), 0.0),
                           (0.1, 0.12, 0.4)), 0)
    o = mesh_from_bm("ShieldBase", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.02)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_octa(bm, 0.2, compose((0.0, 0.0, 0.48)), 0)
    o = mesh_from_bm("ShieldCore", bm, [mats["CyanGlow"]], coll)
    finish(o)
    parent_keep(g, o)

    tip = new_empty("ShieldMuzzleTip", coll, (0.0, 0.0, 0.48))
    parent_keep(g, tip)
    bpy.context.view_layer.update()
    return g


def build_rocket_rig(coll, mats, root, S):
    g = new_empty("Rocket", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)
    Y = lambda v: S * v  # noqa: E731

    bm = bmesh.new()
    bm_box(bm, compose((0.0, 0.0, 0.25), scale=(0.24, 0.24, 0.5)), 0)
    cyl_y(bm, 0.16, 0.18, 1.4, 12, (0.0, Y(0.2), 0.65), 0, S)
    bm_box(bm, compose((0.0, Y(-0.5), 0.35), scale=(0.12, 0.3, 0.4)), 0)
    bm_box(bm, compose((0.0, Y(-0.3), 0.15), scale=(0.4, 0.5, 0.12)), 0)
    o = mesh_from_bm("RocketBody", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.02)
    parent_keep(g, o)

    bm = bmesh.new()
    cyl_y(bm, 0.19, 0.19, 0.1, 12, (0.0, Y(0.5), 0.65), 0, S)
    cyl_y(bm, 0.19, 0.19, 0.1, 12, (0.0, Y(-0.1), 0.65), 0, S)
    bm_box(bm, compose((0.0, Y(0.1), 0.9), scale=(0.08, 0.2, 0.16)), 0)
    o = mesh_from_bm("RocketTrim", bm, [mats["Coral"]], coll)
    finish(o, bevel_width=0.015)
    parent_keep(g, o)

    bm = bmesh.new()
    cyl_y(bm, 0.19, 0.19, 0.12, 12, (0.0, Y(0.92), 0.65), 0, S)
    o = mesh_from_bm("RocketMuzzle", bm, [mats["Warm"]], coll)
    finish(o)
    parent_keep(g, o)

    tip = new_empty("RocketMuzzleTip", coll, (0.0, Y(0.98), 0.65))
    parent_keep(g, tip)
    bpy.context.view_layer.update()
    return g


def build_rail_rig(coll, mats, root, S):
    g = new_empty("Rail", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)
    Y = lambda v: S * v  # noqa: E731

    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(0.2), 0.35), scale=(0.22, 1.6, 0.3)), 0)
    for sx in (-1.0, 1.0):
        bm_box(bm, compose((sx * 0.16, Y(0.4), 0.35),
                           scale=(0.1, 0.8, 0.4)), 0)
    bm_box(bm, compose((0.0, Y(-0.6), 0.35), scale=(0.3, 0.4, 0.4)), 0)
    bm_box(bm, compose((0.0, 0.0, 0.175), scale=(0.2, 0.2, 0.35)), 0)
    o = mesh_from_bm("RailBody", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.02)
    parent_keep(g, o)

    bm = bmesh.new()
    for dy in (0.0, 0.4, 0.8):
        bm_box(bm, compose((0.0, Y(dy), 0.35), scale=(0.3, 0.08, 0.38)), 0)
    o = mesh_from_bm("RailCoil", bm, [mats["Cyan"]], coll)
    finish(o, bevel_width=0.015)
    parent_keep(g, o)

    bm = bmesh.new()
    cyl_y(bm, 0.05, 0.12, 0.3, 10, (0.0, Y(1.05), 0.35), 0, S)
    o = mesh_from_bm("RailMuzzle", bm, [mats["CyanGlow"]], coll)
    finish(o)
    parent_keep(g, o)

    tip = new_empty("RailMuzzleTip", coll, (0.0, Y(1.20), 0.35))
    parent_keep(g, tip)
    bpy.context.view_layer.update()
    return g


def build_bolt(coll, mats, root, S):
    g=new_empty("Bolt",coll,(0,0,0)); parent_keep(root,g)
    Y=lambda v:S*v
    # Solid pointed slugs with two machined brass bands. Thin straight
    # tracers are less than half the solid body's length, never exhaust.
    for name,radius,nose,center,body,back,tail in [
        ("Pulse",.16,.5,.5,.75,-.125,.65),
        ("Scatter",.22,.45,.325,.5,-.15,.50)]:
        gp=new_empty("Bolt"+name,coll,(0,0,0)); parent_keep(g,gp)
        bm=bmesh.new()
        cyl_y(bm,0,radius,nose,12,(0,Y(center),0),0,S)
        cyl_y(bm,radius*.86,radius*.94,body,12,(0,Y(back),0),0,S)
        o=mesh_from_bm("Bolt"+name+"Body",bm,[mats["Ember"]],coll); finish(o); parent_keep(gp,o)
        bm=bmesh.new()
        for z in (back-body*.25,back-body*.40):
            cyl_y(bm,radius*.97,radius*.97,.04,12,(0,Y(z),0),0,S)
        o=mesh_from_bm("Bolt"+name+"Fins",bm,[mats["Warm"]],coll); finish(o); parent_keep(gp,o)
        bm=bmesh.new(); end=back-body/2
        cyl_y(bm,.025,.025,tail,8,(0,Y(end-tail/2),0),0,S)
        o=mesh_from_bm("Bolt"+name+"Tracer",bm,[mats["CyanGlow"] if name=="Pulse" else mats["EmberGlow"]],coll)
        finish(o); parent_keep(gp,o)
    bpy.context.view_layer.update(); return g


def build_rocket_shot(coll, mats, root, S):
    g = new_empty("RocketShot", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)
    Y = lambda v: S * v  # noqa: E731

    bm = bmesh.new()
    cyl_y(bm, 0.0, 0.2, 0.4, 10, (0.0, Y(0.4), 0.0), 0, S)
    cyl_y(bm, 0.2, 0.22, 0.6, 10, (0.0, Y(-0.1), 0.0), 0, S)
    cyl_y(bm, 0.16, 0.12, 0.2, 10, (0.0, Y(-0.45), 0.0), 0, S)
    o = mesh_from_bm("RocketShotBody", bm, [mats["Ember"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    for k in range(4):
        a = (float(k) / 4.0) * math.pi * 2.0
        bm_box(bm, compose((0.0, Y(-0.3), 0.0), (0.0, a, 0.0),
                           (0.06, 0.4, 0.6)), 0)
    o = mesh_from_bm("RocketShotFins", bm, [mats["Metal"]], coll)
    finish(o, bevel_width=0.01)
    parent_keep(g, o)

    bm = bmesh.new()
    cyl_y(bm, 0.18, 0.0, 1.1, 10, (0.0, Y(-1.0), 0.0), 0, S)
    o = mesh_from_bm("RocketShotTracer", bm, [mats["EmberGlow"]], coll)
    finish(o)
    parent_keep(g, o)
    bpy.context.view_layer.update()
    return g


def build_rail_shot(coll, mats, root, S):
    g = new_empty("RailShot", coll, (0.0, 0.0, 0.0))
    parent_keep(root, g)
    Y = lambda v: S * v  # noqa: E731

    bm = bmesh.new()
    cyl_y(bm, 0.0, 0.08, 0.9, 8, (0.0, Y(0.45), 0.0), 0, S)
    cyl_y(bm, 0.08, 0.1, 0.6, 8, (0.0, Y(-0.3), 0.0), 0, S)
    o = mesh_from_bm("RailShotBody", bm, [mats["Cyan"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(-0.5), 0.0), scale=(0.05, 0.3, 0.4)), 0)
    bm_box(bm, compose((0.0, Y(-0.5), 0.0), scale=(0.4, 0.3, 0.05)), 0)
    o = mesh_from_bm("RailShotFins", bm, [mats["Metal"]], coll)
    finish(o)
    parent_keep(g, o)

    bm = bmesh.new()
    cyl_y(bm, 0.1, 0.0, 1.5, 8, (0.0, Y(-1.3), 0.0), 0, S)
    o = mesh_from_bm("RailShotTracer", bm, [mats["CyanGlow"]], coll)
    finish(o)
    parent_keep(g, o)
    bpy.context.view_layer.update()
    return g


def build_expanded_items(coll, mats, root, S):
    """Original canister launcher, pronged EMP emitter and live grenade."""
    Y = lambda v: S * v
    def group(name):
        g = new_empty(name, coll); parent_keep(root, g); return g
    def part(g, name, material, build):
        bm = bmesh.new(); build(bm)
        obj = mesh_from_bm(name, bm, [mats[material]], coll)
        finish(obj); parent_keep(g, obj)
    g = group("Grenade")
    def launcher(bm):
        bm_box(bm, compose((0,Y(-.15),.14),scale=(.56,.65,.28)),0)
        cyl_y(bm,.25,.28,1.05,12,(0,Y(.3),.5),0,S)
    part(g,"GrenadeBody","Metal",launcher)
    part(g,"GrenadeMuzzle","Amber",lambda bm:cyl_y(bm,.31,.31,.17,12,(0,Y(.85),.5),0,S))
    part(g,"GrenadeLatch","Coral",lambda bm:bm_box(bm,compose((0,Y(-.25),.56),scale=(.38,.18,.13)),0))
    parent_keep(g,new_empty("GrenadeMuzzleTip",coll,(0,Y(.95),.5)))
    g = group("EMP")
    def emitter(bm):
        bm_box(bm,compose((0,Y(-.08),.24),scale=(.72,.55,.48)),0)
        for x in [-.43,.43]:
            bm_box(bm,compose((x,Y(.3),.4),scale=(.15,1.15,.17)),0)
    part(g,"EMPBody","Metal",emitter)
    def arcs(bm):
        for x in [-.43,.43]:
            cyl_y(bm,.13,.13,.1,10,(x,Y(.9),.4),0,S)
        bm_box(bm,compose((0,Y(.13),.52),scale=(.48,.1,.12)),0)
    part(g,"EMPCore","CyanGlow",arcs)
    parent_keep(g,new_empty("EMPMuzzleTip",coll,(0,Y(.96),.4)))
    g = group("GrenadeShot")
    part(g,"GrenadeCanister","Amber",lambda bm:bm_cyl(bm,.38,.38,.76,12,compose((0,0,0)),0))
    def ribs(bm):
        bm_cyl(bm,.4,.4,.12,12,compose((0,0,-.3)),0)
        bm_cyl(bm,.4,.4,.12,12,compose((0,0,.3)),0)
        bm_box(bm,compose((0,0,.46),scale=(.15,.26,.18)),0)
        bm_box(bm,compose((0,Y(.15),.57),scale=(.12,.5,.08)),0)
        bm_box(bm,compose((0,Y(.35),.40),scale=(.12,.08,.34)),0)
        for x,y in [(-.34,0),(.34,0),(0,-.34),(0,.34)]:
            bm_box(bm,compose((x,y,0),scale=(.1,.1,.45)),0)
    part(g,"GrenadeBands","Metal",ribs)
    part(g,"GrenadeFuse","RedGlow",lambda bm:bm_box(bm,compose((0,Y(.14),.48),scale=(.12,.1,.09)),0))


def build_library(coll, mats, S, with_marks):
    root = new_empty("CombatLibrary", coll, (0.0, 0.0, 0.0))
    root["giggle_asset"] = "combat"
    root["nose"] = "+Z(three)"
    build_pickup(coll, mats, root, S)
    build_pulse_rig(coll, mats, root, S)
    build_scatter_rig(coll, mats, root, S)
    build_mine(coll, mats, root, S)
    build_shield_rig(coll, mats, root, S)
    build_rocket_rig(coll, mats, root, S)
    build_rail_rig(coll, mats, root, S)
    build_bolt(coll, mats, root, S)
    build_rocket_shot(coll, mats, root, S)
    build_rail_shot(coll, mats, root, S)
    build_expanded_items(coll, mats, root, S)
    if with_marks:
        nose = new_empty("CombatNoseMark", coll, (0.0, S * 2.0, 0.5))
        tail = new_empty("CombatTailMark", coll, (0.0, S * -2.0, 0.5))
        parent_keep(root, nose)
        parent_keep(root, tail)
    bpy.context.view_layer.update()
    return root


# --------------------------------------------------------------------------
# Export (selection-based, single combat.glb)
# --------------------------------------------------------------------------

def ensure_gltf_addon():
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except (RuntimeError, TypeError):
        pass


def export_collection(coll, path):
    for obj in bpy.data.objects:
        obj.select_set(False)
    for obj in coll.objects:
        obj.select_set(True)
    if coll.objects:
        bpy.context.view_layer.objects.active = coll.objects[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                                  use_selection=True, export_yup=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                                  use_selection=True)


# --------------------------------------------------------------------------
# GLB inspection (pure stdlib: no pygltflib dependency)
# --------------------------------------------------------------------------

def read_glb_json(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, total = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB file: %s" % path
    assert version == 2, "unsupported glTF version %d" % version
    off = 12
    js = None
    while off + 8 <= len(data):
        (length, ctype) = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        off += 8 + length
    assert js is not None, "GLB has no JSON chunk: %s" % path
    return js


def glb_stats(path):
    js = read_glb_json(path)
    accessors = js.get("accessors", [])
    meshes = js.get("meshes", [])
    nodes = js.get("nodes", [])
    materials = js.get("materials", [])

    def prim_tris(prim):
        if "indices" in prim:
            return accessors[prim["indices"]]["count"] // 3
        return accessors[prim["attributes"]["POSITION"]]["count"] // 3

    tris = sum(prim_tris(p) for m in meshes for p in m.get("primitives", []))
    parent = {}
    for i, node in enumerate(nodes):
        for c in node.get("children", []):
            parent[c] = i
    world_t = {}

    def accum(i):
        if i in world_t:
            return world_t[i]
        node = nodes[i]
        t = list(node.get("translation", [0.0, 0.0, 0.0]))
        if i in parent:
            p = accum(parent[i])
            t = [t[k] + p[k] for k in range(3)]
        world_t[i] = t
        return t

    for i in range(len(nodes)):
        accum(i)
    names = [n.get("name", "#%d" % i) for i, n in enumerate(nodes)]
    by_name = {}
    for i, n in enumerate(names):
        by_name.setdefault(n, []).append(i)

    def descendants(root_i):
        out, stack = [], [root_i]
        while stack:
            i = stack.pop()
            out.append(i)
            stack.extend(nodes[i].get("children", []))
        return out

    models = {}
    for mname in COMBAT_MODELS:
        idxs = by_name.get(mname, [])
        if not idxs:
            models[mname] = {"present": False}
            continue
        root_i = idxs[0]
        mesh_nodes = [i for i in descendants(root_i) if "mesh" in nodes[i]]
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3
        mtri = 0
        mmats = set()
        mnames = []
        for i in mesh_nodes:
            mesh = meshes[nodes[i]["mesh"]]
            mnames.append(names[i])
            t = world_t[i]
            for prim in mesh.get("primitives", []):
                mtri += prim_tris(prim)
                if "material" in prim:
                    mmats.add(materials[prim["material"]].get("name", "?"))
                acc = accessors[prim["attributes"]["POSITION"]]
                for k in range(3):
                    lo[k] = min(lo[k], acc["min"][k] + t[k])
                    hi[k] = max(hi[k], acc["max"][k] + t[k])
        models[mname] = {
            "present": True,
            "mesh_count": len(mesh_nodes),
            "mesh_names": mnames,
            "triangles": mtri,
            "materials": sorted(mmats),
            "bounds_min": [round(v, 4) for v in lo],
            "bounds_max": [round(v, 4) for v in hi],
        }
    for sub in ("BoltPulse", "BoltScatter"):
        idxs = by_name.get(sub, [])
        if not idxs:
            models[sub] = {"present": False}
            continue
        mesh_nodes = [i for i in descendants(idxs[0]) if "mesh" in nodes[i]]
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3
        for i in mesh_nodes:
            mesh = meshes[nodes[i]["mesh"]]
            t = world_t[i]
            for prim in mesh.get("primitives", []):
                acc = accessors[prim["attributes"]["POSITION"]]
                for k in range(3):
                    lo[k] = min(lo[k], acc["min"][k] + t[k])
                    hi[k] = max(hi[k], acc["max"][k] + t[k])
        models[sub] = {
            "present": True,
            "mesh_count": len(mesh_nodes),
            "mesh_names": [names[i] for i in mesh_nodes],
            "bounds_min": [round(v, 4) for v in lo],
            "bounds_max": [round(v, 4) for v in hi],
        }

    non_identity_rot = [names[i] for i in range(len(nodes))
                        if "rotation" in nodes[i]]
    non_identity_scale = [names[i] for i in range(len(nodes))
                          if "scale" in nodes[i]]
    tips = {}
    for i, n in enumerate(names):
        if n.endswith("MuzzleTip"):
            p = i
            chain = []
            while p in parent:
                p = parent[p]
                chain.append(names[p])
                if names[p] in COMBAT_MODELS:
                    break
            owner = chain[-1] if chain else "?"
            tips.setdefault(owner, []).append(
                [round(v, 4) for v in world_t[i]])
    return {
        "file": os.path.basename(path),
        "bytes": os.path.getsize(path),
        "triangles": tris,
        "materials": [m.get("name", "?") for m in materials],
        "has_images": bool(js.get("images")),
        "has_textures": bool(js.get("textures")),
        "nodes": names,
        "world_translation": {names[i]: [round(v, 4) for v in world_t[i]]
                              for i in range(len(nodes))},
        "non_identity_rotations": non_identity_rot,
        "non_identity_scales": non_identity_scale,
        "muzzle_tips": tips,
        "models": models,
    }


def blender_bounds(coll):
    bpy.context.view_layer.update()
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo.x = min(lo.x, world.x)
            lo.y = min(lo.y, world.y)
            lo.z = min(lo.z, world.z)
            hi.x = max(hi.x, world.x)
            hi.y = max(hi.y, world.y)
            hi.z = max(hi.z, world.z)
    return [round(v, 4) for v in lo], [round(v, 4) for v in hi]


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main(argv):
    args = parse_args(argv)
    print("blender %s" % ".".join(str(v) for v in bpy.app.version), flush=True)
    ensure_gltf_addon()
    clear_scene()
    mats = build_materials()
    coll = new_collection("CombatLibrary")

    build_library(coll, mats, +1, True)
    trial = os.path.join(args.tmp_dir, "giggle-combat-nose-trial.glb")
    export_collection(coll, trial)
    tst = glb_stats(trial)
    nose_z = tst["world_translation"]["CombatNoseMark"][2]
    tail_z = tst["world_translation"]["CombatTailMark"][2]
    print("trial nose: CombatNoseMark z=%s CombatTailMark z=%s"
          % (nose_z, tail_z), flush=True)
    if nose_z < 0:
        print("nose points -Z: rebuilding mirrored (S=-1)", flush=True)
        clear_collection(coll)
        build_library(coll, mats, -1, False)
        S = -1
    else:
        print("nose verified at +Z with S=+1", flush=True)
        clear_collection(coll)
        build_library(coll, mats, +1, False)
        S = +1

    out_path = os.path.join(args.out_dir, "combat.glb")
    export_collection(coll, out_path)

    os.makedirs(os.path.dirname(args.blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)

    st = glb_stats(out_path)
    st["blender_bounds_min"], st["blender_bounds_max"] = blender_bounds(coll)
    st["nose_sign"] = S
    M = st["models"]

    def reach(m):
        lo, hi = M[m]["bounds_min"], M[m]["bounds_max"]
        return max(abs(lo[0]), abs(hi[0]), abs(lo[2]), abs(hi[2]))

    def lateral(m):
        lo, hi = M[m]["bounds_min"], M[m]["bounds_max"]
        return max((hi[0] - lo[0]) / 2.0, (hi[1] - lo[1]) / 2.0)

    def length_z(m):
        lo, hi = M[m]["bounds_min"], M[m]["bounds_max"]
        return hi[2] - lo[2]

    checks = {
        "all_13_models_present": all(
            M[m].get("present") for m in COMBAT_MODELS),
        "bolt_variants_present": M["BoltPulse"].get("present") and
        M["BoltScatter"].get("present"),
        "pickup_base_y0": abs(M["Pickup"]["bounds_min"][1]) < 0.03,
        "pickup_inside_2_4": reach("Pickup") <= 2.4,
        "mine_base_y0": abs(M["Mine"]["bounds_min"][1]) < 0.03,
        "mine_inside_1_0": reach("Mine") <= 1.0,
        "shots_nose_plus_z": all(
            M[m]["bounds_max"][2] > 0 and M[m]["bounds_min"][2] < 0
            for m in ("BoltPulse", "BoltScatter",
                      "RocketShot", "RailShot")),
        "shots_lateral_le_0_45": all(
            lateral(m) <= 0.45 for m in ("BoltPulse", "BoltScatter",
                                        "RocketShot", "RailShot")),
        "shots_elongated": all(
            length_z(m) >= 1.4 for m in ("BoltPulse", "BoltScatter",
                                        "RocketShot", "RailShot")),
        "pulse_longer_than_scatter": (
            length_z("BoltPulse") > length_z("BoltScatter") + 0.2),
        "rail_longest": length_z("RailShot") > length_z("BoltPulse"),
        "weapons_muzzle_plus_z": all(
            st["muzzle_tips"].get(w, [[0, 0, -1]])[0][2] >= 0
            for w in ("Pulse", "Scatter", "Mine", "Shield",
                      "Rocket", "Rail")),
        "pickup_meshes_le_6": M["Pickup"]["mesh_count"] <= 6,
        "mine_meshes_le_4": M["Mine"]["mesh_count"] <= 4,
        "bolt_variants_le_3": M["BoltPulse"]["mesh_count"] <= 3 and
        M["BoltScatter"]["mesh_count"] <= 3,
        "rigs_le_3": all(M[m]["mesh_count"] <= 3 for m in
                         ("Pulse", "Scatter", "Shield", "Rocket", "Rail")),
        "shots_le_3": all(M[m]["mesh_count"] <= 3 for m in
                          ("RocketShot", "RailShot")),
        "no_textures": (not st["has_images"]) and
        (not st["has_textures"]),
        "materials_le_16": len(st["materials"]) <= 16,
        "no_baked_rotations": len(st["non_identity_rotations"]) == 0,
        "no_baked_scales": len(st["non_identity_scales"]) == 0,
        "triangles_under_25k": st["triangles"] < 25000,
        "bytes_under_400k": st["bytes"] < 400 * 1024,
    }
    stats = {
        "blender": ".".join(str(v) for v in bpy.app.version),
        "convention": "three +Z nose, ground y=0; "
                      "pickup/mine base y=0, weapons at mount, shots centered",
        "combat": st,
        "checks": checks,
    }
    print(json.dumps(stats, indent=2), flush=True)
    return stats, checks


if __name__ == "__main__":
    _argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    _stats, _checks = main(_argv)
    _out = parse_args(_argv).stats_out
    os.makedirs(os.path.dirname(_out), exist_ok=True)
    with open(_out, "w") as _fh:
        json.dump(_stats, _fh, indent=2)
    print("stats -> %s" % _out, flush=True)
    _failed = [k for k, v in _checks.items() if not v]
    if _failed:
        print("CHECKS FAILED: %s" % ", ".join(_failed), flush=True)
