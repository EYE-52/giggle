#!/usr/bin/env python3
"""Build original Giggle Karts art assets in Blender and export GLBs.

Authored original content (no ripped assets): a stylized open-wheel kart
with a bean/helmet driver, a gold pickup star, and a sapphire question-mark mystery crate.

Usage (from the repo root):
  /Applications/Blender.app/Contents/MacOS/Blender --background \
      --python scripts/build-kart-assets.py -- \
      --out-dir public/assets/karts \
      --blend assets-source/karts/giggle-karts.blend \
      --stats-out /tmp/giggle-karts-art-20261006/vehicle-stats.json

Conventions (verified by this script, see vehicle-report.md):
  - Three.js runtime: kart nose points +Z at yaw 0, ground plane y=0,
    origin under the kart centre. Wheels touch the ground.
  - Blender working space is Z-up; the kart nose is built at Blender +/-Y
    and a trial export FLIPS the sign automatically when the verified GLB
    nose marker does not land on +Z. Never trust memory: inspect.
  - All part rotations/scales are baked into mesh vertices; exported node
    transforms are translations only (identity on Mesh objects except
    wheel offsets, pivots at part centres).
  - Pivots: FrontSteer_L/R (rotation.y steer) -> WheelSpin_* (rotation.x
    spin, +x = forward roll) -> WheelMesh_*.
  - Materials use NO textures/UVs (smaller files); KartPaint is the only
    per-driver recolored material. All GLB materials are opaque; runtime
    boost/shield cosmetics are procedural (see kart-model.mjs).
"""

import argparse
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

# --------------------------------------------------------------------------
# Tunables (segment counts kept low for the <200KB / <15k tri kart budget)
# --------------------------------------------------------------------------

SPH_U = 12
SPH_V = 8
SPH_SMALL_U = 10
SPH_SMALL_V = 6
CYL_SEG = 12
CYL_SMALL_SEG = 10
TREAD_N = 8

# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_args(argv):
    ap = argparse.ArgumentParser(description="Build Giggle Karts GLB assets.")
    ap.add_argument("--out-dir", default=os.path.join(REPO_ROOT, "public", "assets", "karts"))
    ap.add_argument("--blend", default=os.path.join(REPO_ROOT, "assets-source", "karts", "giggle-karts.blend"))
    ap.add_argument("--stats-out", default="/tmp/giggle-karts-art-20261006/vehicle-stats.json")
    ap.add_argument("--tmp-dir", default=os.environ.get("TMPDIR", "/tmp"))
    ap.add_argument("--optimize", action="store_true", help="Lossless GLB cleanup with glTF Transform 4.5.0 (requires Node/npx).")
    return ap.parse_args(argv)


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

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
    m = m @ Matrix(( (sx, 0, 0, 0), (0, sy, 0, 0), (0, 0, sz, 0), (0, 0, 0, 1) ))
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
        bsdf.inputs["Emission Color"].default_value = srgb_to_linear(hex_rgb(emissive_hex))
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    _MATS[name] = mat
    return mat


def build_materials():
    return {
        "KartPaint": make_mat("KartPaint", "#F02077", metallic=0.08, roughness=0.27),
        "CreamStripe": make_mat("CreamStripe", "#FFF9E7", roughness=0.35),
        "TireDark": make_mat("TireDark", "#171B23", roughness=0.82),
        "HubLight": make_mat("HubLight", "#CAD4E1", metallic=0.55, roughness=0.38),
        "DarkTrim": make_mat("DarkTrim", "#2F3542", roughness=0.6),
        "EngineMetal": make_mat("EngineMetal", "#7F8C9B", metallic=0.8, roughness=0.45),
        "ExhaustChrome": make_mat("ExhaustChrome", "#E9EFF3", metallic=1.0, roughness=0.22),
        "HelmetYellow": make_mat("HelmetYellow", "#FFB923", metallic=0.04, roughness=0.22),
        "VisorDark": make_mat("VisorDark", "#152028", metallic=0.35, roughness=0.12),
        "StarGold": make_mat("StarGold", "#F5A623", metallic=0.9, roughness=0.28),
        "StarEdge": make_mat("StarEdge", "#FFE66D", metallic=0.2, roughness=0.35,
                             emissive_hex="#FFE66D", emissive_strength=0.55),
        "CrateBlue": make_mat("CrateBlue", "#225DEA", metallic=0.08, roughness=0.3),
        "CrateInset": make_mat("CrateInset", "#102B8A", roughness=0.42),
        "CrateYellow": make_mat("CrateYellow", "#FFD32A", roughness=0.3),
        "BoltGlow": make_mat("BoltGlow", "#FFE600", roughness=0.4,
                             emissive_hex="#FFE600", emissive_strength=0.9),
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
    (0, 3, 2, 1),  # bottom -z
    (4, 5, 6, 7),  # top +z
    (0, 1, 5, 4),  # back -y
    (3, 7, 6, 2),  # front +y
    (1, 2, 6, 5),  # right +x
    (0, 4, 7, 3),  # left -x
)


def bm_box(bm, matrix, mat_idx):
    base = [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
            (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]
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
                          radius1=r1, radius2=r2, depth=depth, matrix=matrix,
                          calc_uvs=False)
    for face in bm.faces:
        if face not in before:
            face.material_index = mat_idx


def bm_ball(bm, radius, matrix, mat_idx, u=SPH_U, v=SPH_V):
    before = set(bm.faces)
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v,
                              radius=radius, matrix=matrix, calc_uvs=False)
    for face in bm.faces:
        if face not in before:
            face.material_index = mat_idx


def bm_profile(bm, rows, matrix, mat_idx, segs=16):
    """Rounded closed shell along local Y: (Y, X radius, Z radius, Z centre)."""
    rings = []
    for y, rx, rz, z in rows:
        rings.append([bm.verts.new(matrix @ Vector((rx * math.cos(a * math.tau / segs),
                                                    y, z + rz * math.sin(a * math.tau / segs))))
                      for a in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            f = bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
            f.material_index = mat_idx
    for ring in (rings[0], rings[-1]):
        f = bm.faces.new(ring)
        f.material_index = mat_idx


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


# --------------------------------------------------------------------------
# Mesh finishing: bevel + smooth + weighted normals (applied, all baked)
# --------------------------------------------------------------------------

def _activate(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def _deactivate(obj):
    obj.select_set(False)


def add_bevel(obj, width, segments=2, limit="ANGLE", angle_deg=30.0):
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


def shade_all(obj, smooth=True):
    for poly in obj.data.polygons:
        poly.use_smooth = smooth


def weighted_normals(obj):
    try:
        mod = obj.modifiers.new("WN", "WEIGHTED_NORMAL")
        try:
            mod.keep_sharp = False
        except (AttributeError, TypeError):
            pass
        _activate(obj)
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        finally:
            _deactivate(obj)
    except (RuntimeError, TypeError):
        pass


def finish(obj, bevel_width=0.0, bevel_segments=1, smooth=True, weighted=True):
    if bevel_width > 0.0:
        add_bevel(obj, bevel_width, segments=bevel_segments)
    shade_all(obj, smooth=smooth)
    if weighted and smooth:
        weighted_normals(obj)

# --------------------------------------------------------------------------
# Kart (Blender Z-up; nose toward S * +Y where S = +/-1 trial sign)
# --------------------------------------------------------------------------

FRONT_R = 0.34
REAR_R = 0.42
FRONT_W = 0.32
REAR_W = 0.40
TREAD_PROUD = 0.045  # tread blocks stick out this far past the carcass


def build_wheel_mesh(name, coll, mats, center, radius, width):
    """One pivot-local mesh: rounded rubber shoulder, tread and satin hub."""
    tire_i, hub_i = 0, 1
    bm = bmesh.new()
    rel = Matrix.Translation(Vector(center)).inverted()
    # The curved shoulder is authored rather than a sharp cylinder softened
    # by a runtime scale. The exact rolling radius and wheel centre stay put.
    rows = [(-width * .5, radius * .78, radius * .78, 0),
            (-width * .42, radius * .94, radius * .94, 0),
            (-width * .24, radius, radius, 0),
            (width * .24, radius, radius, 0),
            (width * .42, radius * .94, radius * .94, 0),
            (width * .5, radius * .78, radius * .78, 0)]
    bm_profile(bm, rows, rel @ compose(center, (0, 0, math.pi / 2)), tire_i, segs=16)
    # Shallow rubber cleats preserve the established .045 proud radius.
    for i in range(TREAD_N):
        th = (float(i) / TREAD_N) * math.pi * 2.0
        radial = Vector((0.0, -math.sin(th), math.cos(th)))
        pos = Vector(center) + radial * (radius + 0.01)
        m = rel @ compose(pos, (th, 0.0, 0.0),
                          (width * 0.82, 0.15, 0.07))
        bm_box(bm, m, tire_i)
    # Hub barrel + centre cap, along X.
    hub_r = radius * 0.54
    bm_cyl(bm, hub_r, hub_r, width + 0.03, CYL_SMALL_SEG,
           rel @ compose(center, (0.0, math.pi / 2.0, 0.0)), hub_i)
    bm_cyl(bm, hub_r * 0.42, hub_r * 0.42, width + 0.11, CYL_SMALL_SEG,
           rel @ compose(center, (0.0, math.pi / 2.0, 0.0)), hub_i)
    # Lug bumps ringed around the outboard hub face only (inboard face is
    # never visible; the hub barrel + cap still dress both sides).
    out = 1.0 if center[0] > 0.0 else -1.0
    for i in range(5):
        a = (float(i) / 5.0) * math.pi * 2.0 + math.pi / 5.0
        lp = (center[0] + out * (width / 2.0 + 0.015),
              center[1] + math.cos(a) * hub_r * 0.62,
              center[2] + math.sin(a) * hub_r * 0.62)
        bm_cyl(bm, 0.035, 0.035, 0.05, 6,
               rel @ compose(lp, (0.0, math.pi / 2.0, 0.0)), hub_i)
    obj = mesh_from_bm(name, bm, [mats["TireDark"], mats["HubLight"]], coll,
                       location=center)
    finish(obj, bevel_width=0.015, bevel_segments=1, smooth=True)
    return obj


def build_kart(coll, mats, S):
    """Build the full kart with nose toward S*+Y. Returns dict of pivots."""
    Y = lambda v: S * v  # noqa: E731 - nose-sign mirror for every Y coord
    RX = lambda a: S * a  # noqa: E731 - mirror X-axis tilts with the nose

    root = new_empty("KartRoot", coll, (0.0, 0.0, 0.0))
    root["giggle_asset"] = "kart"
    root["nose"] = "+Z(three)"
    root["wheelbase_hint"] = "front +Z"
    body = new_empty("KartBody", coll, (0.0, 0.0, 0.0))
    parent_keep(root, body)

    paint = mats["KartPaint"]
    cream = mats["CreamStripe"]
    dark = mats["DarkTrim"]

    # -- Chassis floor + skid plate -------------------------------------
    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(0.05), 0.34), scale=(1.5, 2.3, 0.16)), 0)
    floor_o = mesh_from_bm("ChassisFloor", bm, [paint], coll)
    finish(floor_o, bevel_width=0.06, bevel_segments=1)
    parent_keep(body, floor_o)

    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(0.0), 0.22), scale=(1.3, 2.0, 0.07)), 0)
    skid_o = mesh_from_bm("ChassisSkid", bm, [dark], coll)
    finish(skid_o, bevel_width=0.03, bevel_segments=1)
    parent_keep(body, skid_o)

    # -- Sculpted nose: broad shoulder flows into a rounded front lip -----
    bm = bmesh.new()
    nose_rows = [(0.24, .39, .12, .53), (.58, .48, .20, .54),
                 (.96, .46, .18, .53), (1.28, .37, .13, .48),
                 (1.50, .24, .08, .44)]
    bm_profile(bm, nose_rows, compose((0, 0, 0), scale=(1, S, 1)), 0, segs=12)
    for sx in (-1.0, 1.0):
        bm_ball(bm, 0.085, compose((sx * 0.27, Y(1.30), 0.57), scale=(1, .7, .7)), 1,
                u=SPH_SMALL_U, v=SPH_SMALL_V)
    nose_o = mesh_from_bm("NoseCone", bm, [paint, cream], coll)
    finish(nose_o, weighted=False)
    parent_keep(body, nose_o)

    bm = bmesh.new()
    stripe_rows = []
    for y, rx, rz, z in nose_rows:
        stripe_rows.append([bm.verts.new(Vector((x, Y(y), z + rz * math.sqrt(1 - (x / rx) ** 2) + .006)))
                            for x in (-.075, .075)])
    for a, b in zip(stripe_rows, stripe_rows[1:]):
        quad = (a[0], a[1], b[1], b[0])
        bm.faces.new(quad if S > 0 else quad[::-1])
    stripe_o = mesh_from_bm("NoseStripe", bm, [cream], coll)
    finish(stripe_o, weighted=False)
    parent_keep(body, stripe_o)

    # -- Bumpers (front wide bar with paint tips, rear plain) ------------
    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(1.62), 0.34), scale=(1.7, 0.18, 0.16)), 0)
    for sx in (-1.0, 1.0):
        bm_box(bm, compose((sx * 0.86, Y(1.62), 0.34), scale=(0.24, 0.22, 0.20)), 1)
    fb_o = mesh_from_bm("FrontBumper", bm, [dark, paint], coll)
    finish(fb_o, bevel_width=0.06, bevel_segments=1)
    parent_keep(body, fb_o)

    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(-1.58), 0.36), scale=(1.9, 0.16, 0.18)), 0)
    rb_o = mesh_from_bm("RearBumper", bm, [dark], coll)
    finish(rb_o, bevel_width=0.06, bevel_segments=1)
    parent_keep(body, rb_o)

    # -- Substantial rounded sidepods with ivory racing flashes ----------
    for sx in (-1.0, 1.0):
        tag = "L" if sx < 0 else "R"
        bm = bmesh.new()
        bm_box(bm, compose((sx * 0.83, Y(0.02), 0.49), scale=(0.51, 1.38, 0.42)), 0)
        bm_box(bm, compose((sx * 0.83, Y(0.12), 0.703), scale=(0.31, 0.71, 0.018)), 1)
        pod_o = mesh_from_bm("SidePod_%s" % tag, bm, [paint, cream], coll)
        finish(pod_o, bevel_width=0.09, bevel_segments=2)
        parent_keep(body, pod_o)

    # -- Rear wing: plane + stripe + struts + endplates -------------------
    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(-1.30), 1.10), scale=(2.0, 0.38, 0.12)), 0)
    bm_box(bm, compose((0.0, Y(-1.30), 1.165), scale=(0.30, 0.36, 0.018)), 1)
    for sx in (-1.0, 1.0):
        bm_box(bm, compose((sx * 0.55, Y(-1.30), 0.88), scale=(0.12, 0.25, 0.34)), 2)
        bm_box(bm, compose((sx * 1.0, Y(-1.30), 1.14), scale=(0.075, 0.50, 0.30)), 0)
    wing_o = mesh_from_bm("RearWing", bm, [paint, cream, dark], coll)
    finish(wing_o, bevel_width=0.03, bevel_segments=1)
    parent_keep(body, wing_o)

    # -- Seat: base + tilted backrest + headrest pad ----------------------
    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(-0.30), 0.55), scale=(0.72, 0.60, 0.22)), 0)
    bm_box(bm, compose((0.0, Y(-0.62), 0.95), (RX(-0.12), 0.0, 0.0),
                       (0.72, 0.22, 0.75)), 0)
    bm_box(bm, compose((0.0, Y(-0.72), 1.32), (RX(-0.12), 0.0, 0.0),
                       (0.40, 0.16, 0.20)), 0)
    seat_o = mesh_from_bm("DriverSeat", bm, [dark], coll)
    finish(seat_o, bevel_width=0.05, bevel_segments=1)
    parent_keep(body, seat_o)

    # -- Exposed engine + cooling fins behind the seat --------------------
    bm = bmesh.new()
    bm_box(bm, compose((0.0, Y(-1.04), 0.74), scale=(0.83, 0.55, 0.38)), 0)
    bm_box(bm, compose((0.0, Y(-1.05), 0.94), scale=(0.76, 0.52, 0.07)), 1)
    for z in (.65, .76, .87):
        bm_box(bm, compose((0.0, Y(-1.04), z), scale=(0.90, 0.57, 0.045)), 0)
    bm_cyl(bm, .15, .15, .25, CYL_SEG, compose((.22, Y(-.95), 1.035)), 0)
    eng_o = mesh_from_bm("EngineBlock", bm, [mats["EngineMetal"], dark], coll)
    finish(eng_o, bevel_width=0.03, bevel_segments=1)
    parent_keep(body, eng_o)

    # -- Twin exhausts pointing backward ----------------------------------
    for sx in (-1.0, 1.0):
        tag = "L" if sx < 0 else "R"
        bm = bmesh.new()
        pipe_c = (sx * 0.35, Y(-1.31), 0.58)
        tip_c = (sx * 0.35, Y(-1.60), 0.58)
        mouth_c = (sx * 0.35, Y(-1.671), 0.58)
        bm_cyl(bm, 0.12, 0.12, 0.53, CYL_SMALL_SEG,
               compose(pipe_c, (math.pi / 2.0, 0.0, 0.0)), 0)
        bm_cyl(bm, 0.148, 0.148, 0.14, CYL_SMALL_SEG,
               compose(tip_c, (math.pi / 2.0, 0.0, 0.0)), 1)
        bm_cyl(bm, 0.102, 0.102, 0.014, CYL_SMALL_SEG,
               compose(mouth_c, (math.pi / 2.0, 0.0, 0.0)), 2)
        ex_o = mesh_from_bm("Exhaust_%s" % tag, bm,
                            [mats["EngineMetal"], mats["ExhaustChrome"], dark], coll)
        finish(ex_o, bevel_width=0.015, bevel_segments=1)
        parent_keep(body, ex_o)

    # -- Steering column + chunky sport wheel ------------------------------
    bm = bmesh.new()
    bm_cyl(bm, 0.05, 0.05, 0.62, CYL_SMALL_SEG,
           compose((0.0, Y(0.26), 0.75), (RX(0.5), 0.0, 0.0)), 0)
    bm_ball(bm, 0.07, compose((0.0, Y(0.11), 0.97)), 0,
            u=SPH_SMALL_U, v=SPH_SMALL_V)
    col_o = mesh_from_bm("SteeringColumn", bm, [dark], coll)
    finish(col_o, bevel_width=0.02, bevel_segments=1)
    parent_keep(body, col_o)

    bm = bmesh.new()
    bm_cyl(bm, 0.24, 0.24, 0.08, CYL_SEG,
           compose((0.0, Y(0.02), 1.02), (RX(1.05), 0.0, 0.0)), 0)
    bm_cyl(bm, 0.09, 0.09, 0.13, CYL_SMALL_SEG,
           compose((0.0, Y(0.02), 1.02), (RX(1.05), 0.0, 0.0)), 1)
    wheel_o = mesh_from_bm("SteeringWheel", bm, [dark, paint], coll)
    finish(wheel_o, bevel_width=0.03, bevel_segments=1)
    parent_keep(body, wheel_o)

    # -- Driver: paint suit torso + cream bib ------------------------------
    bm = bmesh.new()
    bm_ball(bm, 0.36, compose((0.0, Y(-0.28), 1.02), scale=(1.0, 0.85, 1.25)), 0)
    bm_ball(bm, 0.20, compose((0.0, Y(-0.02), 1.00), scale=(0.9, 0.5, 1.1)), 1,
            u=SPH_SMALL_U, v=SPH_SMALL_V)
    torso_o = mesh_from_bm("DriverTorso", bm, [paint, cream], coll)
    finish(torso_o, bevel_width=0.02, bevel_segments=1)
    parent_keep(body, torso_o)

    # -- Marigold helmet: an ivory stripe is visible from both cameras -----
    # No antenna: the helmet, shoulders and wing form the readable silhouette.
    bm = bmesh.new()
    helmet_r = (.44, .445, .47)
    helmet_y, helmet_z = -.30, 1.64
    bm_ball(bm, 1, compose((0.0, Y(helmet_y), helmet_z), scale=helmet_r), 0, u=16, v=10)
    strip = []
    for i in range(21):
        theta = -2.07 + i * 4.14 / 20
        ring = []
        for x in (-.085, .085):
            bulge = math.sqrt(1 - (x / helmet_r[0]) ** 2)
            ring.append(bm.verts.new(Vector((x, Y(helmet_y + (helmet_r[1] * bulge + .019) * math.sin(theta)),
                                                   helmet_z + (helmet_r[2] * bulge + .019) * math.cos(theta)))))
        strip.append(ring)
    for a, b in zip(strip, strip[1:]):
        f = bm.faces.new((a[0], a[1], b[1], b[0]) if S > 0 else (a[1], a[0], b[0], b[1]))
        f.material_index = 1
    # Two small dark rear vent recesses conform to the shell. Their bright
    # surrounding shell stays continuous rather than reading as an antenna.
    for sx in (-1, 1):
        outline = []
        for i in range(10):
            th = i * math.tau / 10
            x, dz = sx * .20 + .070 * math.cos(th), .055 + .029 * math.sin(th)
            y = helmet_y - helmet_r[1] * math.sqrt(1 - (x / helmet_r[0]) ** 2 - (dz / helmet_r[2]) ** 2) - .007
            outline.append(bm.verts.new(Vector((x, Y(y), helmet_z + dz))))
        f = bm.faces.new(outline if S > 0 else outline[::-1])
        f.material_index = 2
        # Side visor hinge/ear cup: a readable satin disc, not a loose stalk.
        bm_cyl(bm, .115, .115, .055, CYL_SMALL_SEG,
               compose((sx * .422, Y(helmet_y), 1.64), (0, math.pi / 2, 0)), 2)
        bm_cyl(bm, .070, .070, .069, CYL_SMALL_SEG,
               compose((sx * .426, Y(helmet_y), 1.64), (0, math.pi / 2, 0)), 1)
    helm_o = mesh_from_bm("DriverHelmet", bm,
                          [mats["HelmetYellow"], cream, dark], coll)
    finish(helm_o, weighted=False)
    parent_keep(body, helm_o)

    # -- Dark visor + cream glint -------------------------------------------
    bm = bmesh.new()
    bm_ball(bm, 0.35, compose((0.0, Y(-0.01), 1.66), scale=(1.03, .59, .66)), 2)
    bm_ball(bm, 0.33, compose((0.0, Y(0.015), 1.67), scale=(1.02, .59, .63)), 0)
    bm_ball(bm, 0.032, compose((0.15, Y(.19), 1.74)), 1,
            u=SPH_SMALL_U, v=SPH_SMALL_V)
    vis_o = mesh_from_bm("DriverVisor", bm, [mats["VisorDark"], cream, dark], coll)
    finish(vis_o, bevel_width=0.015, bevel_segments=1)
    parent_keep(body, vis_o)

    # -- Arms reaching to the wheel + mitten hands ---------------------------
    shoulder_y, shoulder_z = Y(-0.25), 1.18
    hand_y, hand_z = Y(0.0), 1.00
    for sx in (-1.0, 1.0):
        tag = "L" if sx < 0 else "R"
        shoulder = Vector((sx * 0.32, shoulder_y, shoulder_z))
        hand = Vector((sx * 0.20, hand_y, hand_z))
        mid = (shoulder + hand) / 2.0
        direction = hand - shoulder
        quat = direction.to_track_quat("Z", "Y")
        rot_m = quat.to_matrix().to_4x4()
        bm = bmesh.new()
        before = set(bm.faces)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=CYL_SMALL_SEG,
                              radius1=0.105, radius2=0.105,
                              depth=direction.length,
                              matrix=Matrix.Translation(mid) @ rot_m,
                              calc_uvs=False)
        for face in bm.faces:
            if face not in before:
                face.material_index = 0
        bm_ball(bm, 0.12, compose(hand, scale=(1.0, 1.0, 1.15)), 1,
                u=SPH_SMALL_U, v=SPH_SMALL_V)
        arm_o = mesh_from_bm("DriverArm_%s" % tag, bm, [paint, cream], coll)
        finish(arm_o, bevel_width=0.02, bevel_segments=1)
        parent_keep(body, arm_o)

    # -- Wheels + spin/steer pivots ------------------------------------------
    pivots = {"root": root, "body": body, "spin": {}, "steer": {}}
    track_x = 1.05
    axles = (("F", Y(1.02), FRONT_R, FRONT_W), ("R", Y(-0.92), REAR_R, REAR_W))
    for ax_tag, ax_y, radius, width in axles:
        for sx in (-1.0, 1.0):
            side = "L" if sx < 0 else "R"
            key = "%s%s" % (ax_tag, side)
            center = (sx * track_x, ax_y, radius + TREAD_PROUD)
            if ax_tag == "F":
                steer = new_empty("FrontSteer_%s" % side, coll, center)
                parent_keep(root, steer)
                pivots["steer"][side] = steer
                spin_parent = steer
            else:
                spin_parent = root
            spin = new_empty("WheelSpin_%s%s" % (ax_tag, side), coll, center)
            parent_keep(spin_parent, spin)
            pivots["spin"][key] = spin
            wheel = build_wheel_mesh("WheelMesh_%s" % key, coll, mats,
                                     center, radius, width)
            parent_keep(spin, wheel)

    # -- Nose/tail verification markers (empties export as nodes, no mesh) ---
    nose_mark = new_empty("NoseMark", coll, (0.0, Y(1.78), 0.5))
    tail_mark = new_empty("TailMark", coll, (0.0, Y(-1.78), 0.5))
    parent_keep(root, nose_mark)
    parent_keep(root, tail_mark)

    bpy.context.view_layer.update()
    return pivots


# --------------------------------------------------------------------------
# Pickup star (Blender: shape in XZ plane, extruded along Y ->
# Three: vertical star facing +/-Z, centred on the origin)
# --------------------------------------------------------------------------

def build_star(coll, mats):
    root = new_empty("StarRoot", coll, (0.0, 0.0, 0.0))
    root["giggle_asset"] = "star"
    outer, inner = 0.55, 0.23
    half_t = 0.08
    bm = bmesh.new()
    centre = bm.verts.new(Vector((0.0, 0.0, 0.0)))
    ring = []
    for i in range(10):
        a = (float(i) / 10.0) * math.pi * 2.0
        rad = outer if i % 2 == 0 else inner
        # Point 0 straight up (+Z).
        x = rad * math.sin(a)
        z = rad * math.cos(a)
        ring.append(bm.verts.new(Vector((x, 0.0, z))))
    bm.verts.ensure_lookup_table()
    faces = []
    for i in range(10):
        try:
            faces.append(bm.faces.new([centre, ring[i], ring[(i + 1) % 10]]))
        except ValueError:
            pass
    bm.faces.ensure_lookup_table()
    ret = bmesh.ops.extrude_face_region(bm, geom=faces)
    new_verts = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    for v in new_verts:
        v.co.y += half_t * 2.0
    for v in bm.verts:
        v.co.y -= half_t
    obj = mesh_from_bm("GiggleStar", bm, [mats["StarGold"], mats["StarEdge"]], coll)
    # Round every edge (bevel AFTER extrude), then classify caps vs rim.
    add_bevel(obj, 0.05, segments=2, limit="NONE")
    cls = bmesh.new()
    cls.from_mesh(obj.data)
    cls.normal_update()
    for f in cls.faces:
        rim = abs(f.normal.y) <= 0.6
        f.material_index = 1 if rim else 0
        f.smooth = rim
    cls.to_mesh(obj.data)
    cls.free()
    obj.data.update()
    parent_keep(root, obj)
    bpy.context.view_layer.update()
    return root


# --------------------------------------------------------------------------
# Mystery zap crate (Blender Z-up; bottom at z=0 -> Three bottom at y=0)
# --------------------------------------------------------------------------

_QUESTION_STROKE = (
    (-0.20, 0.23), (-0.17, 0.36), (-0.07, 0.43), (0.07, 0.43),
    (0.19, 0.36), (0.23, 0.25), (0.20, 0.15), (0.13, 0.08),
    (0.03, 0.02), (0.00, -0.05), (0.00, -0.13),
)


def _question_faces_local():
    # A thick raised question mark, modelled geometry rather than a decal.
    # Rounded joints make it readable on distant pickups and all four faces.
    faces = []
    radius = 0.063
    for a, b in zip(_QUESTION_STROKE, _QUESTION_STROKE[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy)
        nx, ny = -dy / n * radius, dx / n * radius
        faces.append([(a[0]+nx,a[1]+ny,0),(a[0]-nx,a[1]-ny,0),
                      (b[0]-nx,b[1]-ny,0),(b[0]+nx,b[1]+ny,0)])
    for x, y in (*_QUESTION_STROKE, (0.00, -0.32)):
        r = 0.081 if y == -0.32 else radius
        faces.append([(x + math.cos(i * math.tau / 12) * r,
                       y + math.sin(i * math.tau / 12) * r, 0) for i in range(12)])
    return faces


def build_crate(coll, mats):
    root = new_empty("CrateRoot", coll, (0.0, 0.0, 0.0))
    root["giggle_asset"] = "crate"
    blue = mats["CrateBlue"]
    yellow = mats["CrateYellow"]
    glow = mats["BoltGlow"]

    # Body: 1.15 x 1.15 footprint, 1.5 tall, bottom at z=0.
    bm = bmesh.new()
    bm_box(bm, compose((0.0, 0.0, 0.75), scale=(1.15, 1.15, 1.4)), 0)
    body_o = mesh_from_bm("CrateBody", bm, [blue], coll)
    finish(body_o, bevel_width=.075, bevel_segments=2)
    parent_keep(root, body_o)

    # Inset sapphire face panels give the question mark a clean surround.
    bm = bmesh.new()
    for sy in (-1, 1):
        bm_box(bm, compose((0, sy * .575, .75), scale=(.77, .018, 1.08)), 0)
    for sx in (-1, 1):
        bm_box(bm, compose((sx * .575, 0, .75), scale=(.018, .77, 1.08)), 0)
    panel_o = mesh_from_bm("CrateInset", bm, [mats["CrateInset"]], coll)
    finish(panel_o, bevel_width=.07, bevel_segments=2)
    parent_keep(root, panel_o)

    # Corner posts + top/bottom rim frames.
    bm = bmesh.new()
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            bm_box(bm, compose((sx * 0.5, sy * 0.5, 0.75), scale=(0.18, 0.18, 1.5)), 0)
    for z in (0.08, 1.42):
        for sy in (-1.0, 1.0):
            bm_box(bm, compose((0.0, sy * 0.5, z), scale=(1.19, 0.16, 0.16)), 0)
        for sx in (-1.0, 1.0):
            bm_box(bm, compose((sx * 0.5, 0.0, z), scale=(0.16, 1.19, 0.16)), 0)
    trim_o = mesh_from_bm("CrateTrim", bm, [yellow], coll)
    finish(trim_o, bevel_width=.045, bevel_segments=2)
    parent_keep(root, trim_o)

    # Question marks on all four sides: base plane embedded 0.015 into
    # the body face, extruded 0.06 outward along an explicit outward vector
    # (never the winding-dependent face normal).
    face = 0.575
    base = face - 0.015
    sides = (
        (Matrix.Translation(Vector((base, 0.0, 0.75)))
         @ Euler((0.0, math.pi / 2.0, 0.0), "XYZ").to_matrix().to_4x4()
         @ Euler((0.0, 0.0, math.pi / 2.0), "XYZ").to_matrix().to_4x4(),
         Vector((1.0, 0.0, 0.0))),
        (Matrix.Translation(Vector((-base, 0.0, 0.75)))
         @ Euler((0.0, -math.pi / 2.0, 0.0), "XYZ").to_matrix().to_4x4()
         @ Euler((0.0, 0.0, -math.pi / 2.0), "XYZ").to_matrix().to_4x4(),
         Vector((-1.0, 0.0, 0.0))),
        (Matrix.Translation(Vector((0.0, base, 0.75)))
         @ Euler((math.pi / 2.0, 0.0, 0.0), "XYZ").to_matrix().to_4x4(),
         Vector((0.0, 1.0, 0.0))),
        (Matrix.Translation(Vector((0.0, -base, 0.75)))
         @ Euler((-math.pi / 2.0, 0.0, 0.0), "XYZ").to_matrix().to_4x4()
         @ Euler((0.0, 0.0, math.pi), "XYZ").to_matrix().to_4x4(),
         Vector((0.0, -1.0, 0.0))),
    )
    bm = bmesh.new()
    for mtx, outward in sides:
        for polygon in _question_faces_local():
            verts = [bm.verts.new(mtx @ Vector(co)) for co in polygon]
            face_new = bm.faces.new(verts)
            ret = bmesh.ops.extrude_face_region(bm, geom=[face_new])
            for e in ret["geom"]:
                if isinstance(e, bmesh.types.BMVert):
                    e.co += outward * 0.06
    for f in bm.faces:
        f.material_index = 0
    bolt_o = mesh_from_bm("CrateQuestion", bm, [glow], coll)
    finish(bolt_o, smooth=False, weighted=False)
    parent_keep(root, bolt_o)

    bpy.context.view_layer.update()
    return root


# --------------------------------------------------------------------------
# Export (selection-based, one GLB per collection)
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
        if ctype == 0x4E4F534A:  # JSON
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
    tris = 0
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += accessors[prim["indices"]]["count"] // 3
            else:
                pos = prim["attributes"]["POSITION"]
                tris += accessors[pos]["count"] // 3
    # Node world translations (exports bake rotations; assert that below).
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
    non_identity_rot = [nodes[i].get("name", "#%d" % i) for i in range(len(nodes))
                        if "rotation" in nodes[i]]
    # Bounds from POSITION accessor min/max shifted by node world translation.
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for i, node in enumerate(nodes):
        if "mesh" not in node:
            continue
        mesh = meshes[node["mesh"]]
        t = world_t[i]
        for prim in mesh.get("primitives", []):
            acc = accessors[prim["attributes"]["POSITION"]]
            for k in range(3):
                lo[k] = min(lo[k], acc["min"][k] + t[k])
                hi[k] = max(hi[k], acc["max"][k] + t[k])
    names = [n.get("name", "#%d" % i) for i, n in enumerate(nodes)]
    return {
        "file": os.path.basename(path),
        "bytes": os.path.getsize(path),
        "triangles": tris,
        "materials": [m.get("name", "?") for m in materials],
        "nodes": names,
        "world_translation": {names[i]: [round(v, 4) for v in world_t[i]]
                              for i in range(len(nodes))},
        "non_identity_rotations": non_identity_rot,
        "bounds_min": [round(v, 4) for v in lo],
        "bounds_max": [round(v, 4) for v in hi],
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

    kart_coll = new_collection("GiggleKart")
    star_coll = new_collection("GiggleStar")
    crate_coll = new_collection("GiggleCrate")

    # Trial export decides the nose sign empirically: build at +Y, export to
    # temp, and flip to -Y when the NoseMark does not land on Three +Z.
    build_kart(kart_coll, mats, +1)
    trial = os.path.join(args.tmp_dir, "giggle-kart-nose-trial.glb")
    export_collection(kart_coll, trial)
    nose_z = glb_stats(trial)["world_translation"]["NoseMark"][2]
    tail_z = glb_stats(trial)["world_translation"]["TailMark"][2]
    print("trial nose: NoseMark z=%s TailMark z=%s" % (nose_z, tail_z), flush=True)
    if nose_z < 0:
        print("nose points -Z: rebuilding kart mirrored (S=-1)", flush=True)
        clear_collection(kart_coll)
        build_kart(kart_coll, mats, -1)
    else:
        print("nose verified at +Z with S=+1", flush=True)

    build_star(star_coll, mats)
    build_crate(crate_coll, mats)

    kart_path = os.path.join(args.out_dir, "giggle-kart.glb")
    star_path = os.path.join(args.out_dir, "giggle-star.glb")
    crate_path = os.path.join(args.out_dir, "giggle-crate.glb")
    export_collection(kart_coll, kart_path)
    export_collection(star_coll, star_path)
    export_collection(crate_coll, crate_path)

    if args.optimize:
        # Keep every named empty: NoseMark/TailMark and wheel pivots are part
        # of the runtime contract. No quantization, Draco or Meshopt decoder.
        with tempfile.TemporaryDirectory(prefix="giggle-kart-gltf-") as cleanup:
            cli = ["npx", "--yes", "@gltf-transform/cli@4.5.0"]
            for asset in (kart_path, star_path, crate_path):
                deduped = os.path.join(cleanup, os.path.basename(asset))
                subprocess.run(cli + ["dedup", asset, deduped], check=True)
                subprocess.run(cli + ["prune", deduped, asset, "--keep-leaves", "true"], check=True)

    os.makedirs(os.path.dirname(args.blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)

    kart = glb_stats(kart_path)
    star = glb_stats(star_path)
    crate = glb_stats(crate_path)
    kart["blender_bounds_min"], kart["blender_bounds_max"] = blender_bounds(kart_coll)
    star["blender_bounds_min"], star["blender_bounds_max"] = blender_bounds(star_coll)
    crate["blender_bounds_min"], crate["blender_bounds_max"] = blender_bounds(crate_coll)

    checks = {
        "kart_nose_plus_z": kart["world_translation"]["NoseMark"][2] > 1.0,
        "kart_tail_minus_z": kart["world_translation"]["TailMark"][2] < -1.0,
        "kart_wheels_on_ground": abs(kart["bounds_min"][1]) < 0.02,
        "kart_triangles_under_15k": kart["triangles"] < 15000,
        "kart_materials_under_12": len(kart["materials"]) < 12,
        "kart_bytes_under_200k": kart["bytes"] < 200 * 1024,
        "kart_no_baked_rotations": len(kart["non_identity_rotations"]) == 0,
        "star_centered": all(abs((a + b) / 2.0) < 0.06
                             for a, b in zip(star["bounds_min"], star["bounds_max"])),
        "crate_bottom_y0": abs(crate["bounds_min"][1]) < 0.03,
        "crate_height_1_5": abs((crate["bounds_max"][1] - crate["bounds_min"][1]) - 1.5) < 0.1,
        "combined_under_500k": (kart["bytes"] + star["bytes"] + crate["bytes"]) < 500 * 1024,
    }
    stats = {
        "blender": ".".join(str(v) for v in bpy.app.version),
        "convention": "three +Z nose at yaw 0, ground y=0, origin under kart",
        "kart": kart,
        "star": star,
        "crate": crate,
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
        sys.exit(1)
