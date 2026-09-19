"""
tank_kit.py — parametric tank construction kit for TankMe.

Builds original, historically-inspired tank models in Blender:
  hulls (beveled + sloped armor), cast/boxy turrets, guns with muzzle
  devices, running gear (road wheels + segmented tracks), and detail props.
Generates procedural PBR textures (albedo camo, roughness wear, normal
detail) with numpy, assembles a rigged node hierarchy, and exports GLB.

Node contract (used by the game engine):
  TankRoot
   ├─ Hull            static mesh group
   ├─ Turret          empty pivot at turret ring (engine: yaw)
   │   ├─ TurretMesh
   │   └─ Cannon      empty pivot at mantlet (engine: pitch + recoil)
   │       ├─ CannonMesh
   │       └─ Muzzle  empty at barrel tip (engine: shell spawn point)
   ├─ Track_L / Track_R
   └─ Wheels_L / Wheels_R

Orientation: nose along Blender -Y (exports to glTF +Z, the game's forward).
"""
import bpy
import bmesh
import math
import os
import random
import numpy as np
from mathutils import Matrix

# ---------------------------------------------------------------- primitives

def _clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def _select_only(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def _bake_scale(o):
    """Bake object scale into mesh data (uniform bevels, sane bmesh coords)."""
    if o.scale.x != 1 or o.scale.y != 1 or o.scale.z != 1:
        m = Matrix.Diagonal((o.scale.x, o.scale.y, o.scale.z, 1.0))
        o.data.transform(m)
        o.scale = (1, 1, 1)

def _apply_mods(obj):
    _select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)

def hbox(name, w, d, h, x=0.0, y=0.0, z=0.0, bevel=0.02, rx=0.0, ry=0.0, rz=0.0, seg=2):
    """Beveled box. w=X (width), d=Y (depth, nose is -Y), h=Z (up)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w / 2, d / 2, h / 2)
    _bake_scale(o)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = seg
        _apply_mods(o)
    return o

def wedge(name, w, d, h, x=0.0, y=0.0, z=0.0, ry=0.0, rx=0.0):
    """Sloped plate (cube with top edge pushed along Y), then rotated."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w / 2, d / 2, h / 2)
    _bake_scale(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for v in bm.verts:
        if v.co.z > 0:
            v.co.y += d * 0.5
    bm.to_mesh(o.data)
    bm.free()
    o.rotation_euler = (rx, ry, 0)
    o.location = (x, y, z)
    return o

def cyl(name, r, h, x=0.0, y=0.0, z=0.0, seg=24, rx=0.0, ry=0.0, rz=0.0, r2=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    if rx or ry or rz:
        o.rotation_euler = (rx, ry, rz)
    return o

def sphere(name, rx_, ry_, rz_, x=0.0, y=0.0, z=0.0, seg=32, cut_below=None):
    """Scaled dome (cast turret body). cut_below in meters (baked)."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(8, seg // 2), radius=1, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    _bake_scale(o)
    o.data.transform(Matrix.Diagonal((rx_, ry_, rz_, 1.0)))
    if cut_below is not None:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -cut_below], context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
    return o

def cone(name, r, h, x=0.0, y=0.0, z=0.0, seg=16, rx=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, depth=h, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    if rx:
        o.rotation_euler = (rx, 0, 0)
    return o

def join(objs, name):
    """Join objects into one; returns joined object."""
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    _select_only(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    j = bpy.context.active_object
    j.name = name
    return j

def assign_mat(obj, mat):
    if obj is None:
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)

def parent_to(children, parent, keep_transform=True):
    for c in children:
        if c is None:
            continue
        c.parent = parent
        if keep_transform:
            c.matrix_parent_inverse = parent.matrix_world.inverted()

def empty(name, x=0.0, y=0.0, z=0.0):
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(x, y, z))
    e = bpy.context.active_object
    e.name = name
    e.empty_display_size = 0.3
    return e

# ---------------------------------------------------------------- textures

def _fbm(w, h, cells, seed, octaves=4):
    """Tileable-ish fractal value noise via numpy upsampling."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), dtype=np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        grid = rng.random((c, c)).astype(np.float32)
        # bilinear upsample to (h, w)
        ys = np.linspace(0, c - 1, h, endpoint=False)
        xs = np.linspace(0, c - 1, w, endpoint=False)
        y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
        fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        y1 = (y0 + 1) % c; x1 = (x0 + 1) % c
        a = grid[np.ix_(y0, x0)]; b = grid[np.ix_(y0, x1)]
        cc = grid[np.ix_(y1, x0)]; d = grid[np.ix_(y1, x1)]
        acc += amp * (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cc * (1 - fx) * fy + d * fx * fy)
        total += amp
        amp *= 0.55
    return acc / total

def _save_png(img, path):
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()

def make_pbr_textures(out_dir, scheme, seed):
    """Procedural camo albedo + roughness + normal. Returns (albedo, rough, normal) image paths."""
    os.makedirs(out_dir, exist_ok=True)
    S = 1024
    rng = np.random.default_rng(seed)

    base = np.array(scheme['base'], dtype=np.float32) / 255.0
    blotch = np.array(scheme['blotch'], dtype=np.float32) / 255.0
    blotch2 = np.array(scheme['blotch2'], dtype=np.float32) / 255.0

    # ---- albedo: camo blobs + dirt gradient + scratches + chips
    n1 = _fbm(S, S, 5, seed)
    n2 = _fbm(S, S, 9, seed + 7, 3)
    col = np.zeros((S, S, 3), dtype=np.float32)
    m1 = np.clip((n1 - 0.52) * 3.2, 0, 1)[..., None]
    m2 = np.clip((n2 - 0.6) * 2.6, 0, 1)[..., None] * 0.6
    col = base * (1 - m1) + blotch * m1
    col = col * (1 - m2) + blotch2 * m2
    # vertical dirt: darker toward bottom (v=0 in image = bottom of UV)
    yy = np.linspace(0, 1, S)[:, None, None]
    dirt = (1 - yy) ** 2.2
    mud = np.array(scheme['mud'], dtype=np.float32) / 255.0
    col = col * (1 - dirt * 0.55) + mud * (dirt * 0.55)
    # dust overall
    col = col * 0.94 + 0.03
    # scratches: bright thin lines
    scr = _fbm(S, S, 40, seed + 13, 2)
    col += (np.clip(scr - 0.72, 0, 1) * 0.5)[..., None]
    # chipped metal speckle on edges of noise
    chip = (np.abs(n2 - 0.5) < 0.012).astype(np.float32)
    col = col * (1 - chip[..., None] * 0.5) + np.array([0.30, 0.28, 0.26]) * (chip[..., None] * 0.5)

    # store sRGB values as linear (Blender image buffers are linear)
    albedo = np.concatenate([np.clip(col, 0, 1) ** 2.2, np.ones((S, S, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new('albedo', S, S, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(albedo[::-1], dtype=np.float32).ravel())
    albedo_path = os.path.join(out_dir, f'{scheme["name"]}_albedo.png')
    _save_png(img, albedo_path)

    # ---- roughness: paint base ~0.72, worn metal ~0.45, mud ~0.95
    r = np.full((512, 512), 0.74, dtype=np.float32)
    wear = _fbm(512, 512, 6, seed + 31, 3)
    r -= np.clip(wear - 0.45, 0, 1) * 0.35
    r += (yy[:512].reshape(512, 1) * 0)  # keep shape
    rr = np.concatenate([np.clip(r, 0.3, 1.0)[..., None]] * 3 + [np.ones((512, 512, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new('rough', 512, 512)
    img.pixels.foreach_set(np.ascontiguousarray(rr[::-1], dtype=np.float32).ravel())
    rough_path = os.path.join(out_dir, f'{scheme["name"]}_rough.png')
    _save_png(img, rough_path)

    # ---- normal from bump noise (dents + subtle cast texture)
    bs = 512
    bump = _fbm(bs, bs, 10, seed + 51, 4) * 0.7 + _fbm(bs, bs, 28, seed + 61, 2) * 0.3
    gx = np.gradient(bump, axis=1) * scheme.get('normalStrength', 1.6)
    gy = np.gradient(bump, axis=0) * scheme.get('normalStrength', 1.6)
    nx, ny, nz = -gx, -gy, np.ones_like(bump)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    nm = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5), np.ones_like(nz)], axis=2)
    img = bpy.data.images.new('normal', bs, bs)
    img.pixels.foreach_set(np.ascontiguousarray(nm[::-1], dtype=np.float32).ravel())
    normal_path = os.path.join(out_dir, f'{scheme["name"]}_normal.png')
    _save_png(img, normal_path)

    return albedo_path, rough_path, normal_path

def make_track_textures(out_dir, seed):
    """Track link albedo + normal (pads, guide horns, mud)."""
    os.makedirs(out_dir, exist_ok=True)
    W, H = 256, 128
    albedo = np.full((H, W, 4), 0.09, dtype=np.float32)
    albedo[..., :3] = 0.09
    # pads across X
    pad = np.array([0.22, 0.23, 0.25])
    for x0 in range(0, W, 24):
        albedo[:, x0 + 2:x0 + 18, :3] = pad
        albedo[:, x0 + 16:x0 + 18, :3] = pad * 0.55
    # mud splashes
    mud = _fbm(W, H, 8, seed, 3)
    albedo[..., :3] += (np.clip(mud - 0.55, 0, 1)[..., None] * np.array([0.32, 0.27, 0.18], dtype=np.float32))
    img = bpy.data.images.new('track_a', W, H, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(albedo[::-1], dtype=np.float32).ravel())
    ta = os.path.join(out_dir, 'track_albedo.png')
    _save_png(img, ta)

    bump = _fbm(W, H, 24, seed + 5, 3)
    gx = np.gradient(bump, axis=1) * 1.4
    gy = np.gradient(bump, axis=0) * 1.4
    ln = np.sqrt(gx * gx + gy * gy + 1)
    nm = np.stack([(-gx / ln) * 0.5 + 0.5, (-gy / ln) * 0.5 + 0.5, (1 / ln) * 0.5 + 0.5, np.ones((H, W))], axis=2)
    img = bpy.data.images.new('track_n', W, H)
    img.pixels.foreach_set(np.ascontiguousarray(nm[::-1], dtype=np.float32).ravel())
    tn = os.path.join(out_dir, 'track_normal.png')
    _save_png(img, tn)
    return ta, tn

def pbr_material(name, albedo_path, rough_path, normal_path, metallic=0.2, scale=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.35

    n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(albedo_path); n.location = (-700, 300)
    nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    r = nt.nodes.new('ShaderNodeTexImage'); r.image = bpy.data.images.load(rough_path); r.location = (-700, 0)
    nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
    nm = nt.nodes.new('ShaderNodeTexImage'); nm.image = bpy.data.images.load(normal_path); nm.location = (-700, -300)
    nm.image.colorspace_settings.name = 'Non-Color'
    nrm = nt.nodes.new('ShaderNodeNormalMap'); nrm.location = (-380, -300)
    try:
        nrm.inputs['Scale'].default_value = scale
    except KeyError:
        nrm.inputs[0].default_value = scale
    nt.links.new(nm.outputs['Color'], nrm.inputs['Color'])
    nt.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])
    # box-ish projection: use UV (exporter keeps per-object UVs)
    return mat

def simple_material(name, color, metallic=0.3, rough=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = rough
    return mat

# ---------------------------------------------------------------- rig parts

def road_wheel(name, r, w, x, y, z, mat_tire, mat_hub, seg=20, hub_r=0.55):
    tire = cyl(f'{name}_tire', r, w, x, y, z, seg=seg, ry=math.pi / 2)
    assign_mat(tire, mat_tire)
    hub = cyl(f'{name}_hub', r * hub_r, w * 1.04, x, y, z, seg=seg, ry=math.pi / 2)
    assign_mat(hub, mat_hub)
    cap = cyl(f'{name}_cap', r * hub_r * 0.3, w * 1.1, x, y, z, seg=10, ry=math.pi / 2)
    assign_mat(cap, mat_hub)
    return [tire, hub, cap]

def track_run(name, cfg, mat_track, detail):
    """Segmented track around the running gear path (both sides share cfg)."""
    xs = cfg.get('track_x', cfg['hull_w_bot'] / 2 + cfg['track_w'] / 2)
    half_l = cfg['hull_len'] / 2
    r_d = cfg['wheel_r'] + 0.06
    z_bottom = 0.1
    y_front = -half_l + cfg['wheel_inset']
    y_rear = half_l - cfg['wheel_inset']
    top_z = cfg.get('top_run_z', cfg['wheel_r'] + 0.7)
    R = (top_z - z_bottom) / 2
    cz = (top_z + z_bottom) / 2
    bulge = R * 0.8

    pts = []
    # bottom run rear→front (under the road wheels)
    n_b = 7
    for i in range(n_b + 1):
        t = i / n_b
        pts.append(((y_rear - 0.12) + (y_front + 0.12 - (y_rear - 0.12)) * t, z_bottom))
    # front idler arc (bulging forward, bottom → top)
    for i in range(1, 6):
        a = (math.pi / 2) * (i / 5)
        pts.append((y_front - bulge * math.sin(a), z_bottom + (top_z - z_bottom) * math.sin(a)))
    # top run front→rear (with slight sag)
    n_t = 6
    for i in range(1, n_t + 1):
        t = i / n_t
        sag = math.sin(t * math.pi) * cfg.get('sag', 0.035)
        pts.append((y_front + (y_rear - y_front) * t, top_z - sag))
    # rear sprocket arc (bulging rearward, top → bottom)
    for i in range(1, 6):
        a = (math.pi / 2) * (1 - i / 5)
        pts.append((y_rear + bulge * math.sin(a), z_bottom + (top_z - z_bottom) * math.sin(a)))

    objs = []
    link_len = {0: 0.20, 1: 0.34, 2: 0.0}[detail]
    if detail == 2:
        # merged smooth loop approximated with one box per run segment
        for s in (-1, 1):
            parts = []
            for i in range(len(pts) - 1):
                (y0, z0), (y1, z1) = pts[i], pts[i + 1]
                mid = ((y0 + y1) / 2, (z0 + z1) / 2)
                ang = math.atan2(z1 - z0, y1 - y0)
                ln = math.hypot(y1 - y0, z1 - z0) + 0.1
                b = bx_local(f'{name}_{s}_{i}', cfg['track_w'], ln, 0.16, xs * s, mid[0], mid[1], ry=ang)
                parts.append(b)
            j = join(parts, f'{name}{"L" if s < 0 else "R"}')
            assign_mat(j, mat_track)
            objs.append(j)
        return objs

    per_seg = max(1, int(1 / link_len)) if False else 1
    for s in (-1, 1):
        parts = []
        idx = 0
        for i in range(len(pts) - 1):
            (y0, z0), (y1, z1) = pts[i], pts[i + 1]
            ln = math.hypot(y1 - y0, z1 - z0)
            ang = math.atan2(z1 - z0, y1 - y0)
            n_links = max(1, int(round(ln / link_len)))
            for k in range(n_links):
                t = (k + 0.5) / n_links
                yy = y0 + (y1 - y0) * t
                zz = z0 + (z1 - z0) * t
                # link plate + guide horn
                b = bx_local(f'{name}_link', cfg['track_w'], link_len * 0.82, 0.09, xs * s, yy, zz, ry=ang)
                parts.append(b)
                horn = bx_local(f'{name}_horn', cfg['track_w'] * 0.24, link_len * 0.4, 0.07, xs * s, yy, zz + 0.075, ry=ang)
                parts.append(horn)
                idx += 1
        j = join(parts, f'{name}{"L" if s < 0 else "R"}')
        assign_mat(j, mat_track)
        objs.append(j)
    return objs

def bx_local(name, w, d, h, x, y, z, ry=0.0, bevel=0.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w / 2, d / 2, h / 2)
    _apply_mods(o)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 1
        _apply_mods(o)
    if ry:
        o.rotation_euler = (0, ry, 0)
    return o

def gun_assembly(name, cfg, mat_gun, mat_dark, detail):
    """Barrel pointing -Y, origin at mantlet face. Returns list of objects."""
    parts = []
    gl = cfg['gun_len']
    r0 = cfg['gun_r']
    # main tube (two tapers)
    t1 = cyl(f'{name}_tube1', r0 * 1.12, gl * 0.55, 0, -gl * 0.275, 0, seg=16, rx=math.pi / 2)
    t1.data.transform(__import__('mathutils').Matrix.Scale(1.0, 4))
    parts.append(t1)
    t2 = cyl(f'{name}_tube2', r0, gl * 0.45, 0, -gl * 0.775, 0, seg=16, rx=math.pi / 2)
    parts.append(t2)
    # muzzle device
    mt = cfg.get('muzzle', 'brake')
    if mt == 'extractor':
        parts.append(cyl(f'{name}_ext', r0 * 1.45, gl * 0.14, 0, -gl * 0.5, 0, seg=16, rx=math.pi / 2))
        parts.append(cyl(f'{name}_brk', r0 * 1.25, 0.18, 0, -gl + 0.09, 0, seg=14, rx=math.pi / 2))
    elif mt == 'brake2':
        parts.append(cyl(f'{name}_brk1', r0 * 1.7, 0.14, 0, -gl + 0.10, 0, seg=14, rx=math.pi / 2))
        parts.append(cyl(f'{name}_brk2', r0 * 1.7, 0.14, 0, -gl + 0.34, 0, seg=14, rx=math.pi / 2))
        parts.append(cyl(f'{name}_brk3', r0 * 1.5, 0.14, 0, -gl + 0.22, 0, seg=14, rx=math.pi / 2))
    elif mt == 'heavy':
        parts.append(cyl(f'{name}_ext', r0 * 1.35, gl * 0.12, 0, -gl * 0.55, 0, seg=16, rx=math.pi / 2))
        parts.append(cyl(f'{name}_brk', r0 * 1.75, 0.5, 0, -gl + 0.28, 0, seg=14, rx=math.pi / 2))
    for p in parts:
        assign_mat(p, mat_gun)
    # bore
    bore = cyl(f'{name}_bore', r0 * 0.55, 0.06, 0, -gl + 0.02, 0, seg=12, rx=math.pi / 2)
    assign_mat(bore, mat_dark)
    parts.append(bore)
    return parts

def hatch(name, r, x, y, z, mat, open_angle=0.0):
    parts = [cyl(name, r, 0.07, x, y, z, seg=12)]
    if open_angle > 0:
        lid = cyl(name + '_lid', r * 0.98, 0.04, x + r * 0.8, y, z + r * 0.75, seg=12, rx=open_angle)
        parts.append(lid)
    for p in parts:
        assign_mat(p, mat)
    return parts

def cupola(name, r, x, y, z, mat, mat_dark, with_mg=True, mg_mat=None):
    parts = []
    parts.append(cyl(f'{name}_body', r, 0.22, x, y, z, seg=14))
    for i in range(6):
        a = i / 6 * math.pi * 2
        parts.append(bx_local(f'{name}_viz', r * 0.5, r * 0.3, 0.09, x + math.sin(a) * r * 0.82, y + math.cos(a) * r * 0.82, z + 0.02, ry=a))
    if with_mg:
        parts.append(cyl(f'{name}_mg', 0.035, 0.85, x + r * 0.5, y - r * 0.6, z + 0.28, seg=8, rx=math.pi / 2 - 0.15))
        parts.append(bx_local(f'{name}_mgmount', 0.08, 0.2, 0.08, x + r * 0.5, y - r * 0.25, z + 0.24))
    for p in parts:
        assign_mat(p, mg_mat if with_mg and ('mg' in p.name) and mg_mat else mat if '_viz' not in p.name else mat_dark)
    return parts

def stowage(name, x, y, z, w, d, h, mat, ry=0.0):
    o = bx_local(name, w, d, h, x, y, z, ry=ry, bevel=0.012)
    assign_mat(o, mat)
    return [o]

def antenna(name, x, y, z, mat):
    o = cyl(name, 0.012, 1.5, x, y, z, seg=5, rz=0.08)
    assign_mat(o, mat)
    return [o]

def exhaust_pair(name, x, y, z, mat, gap, h=0.62):
    parts = []
    for s in (-1, 1):
        e = cyl(f'{name}{s}', 0.1, h, x + s * gap, y, z + h / 2, seg=8)
        tip = cyl(f'{name}{s}_tip', 0.11, 0.05, x + s * gap, y, z + h + 0.02, seg=8)
        assign_mat(e, mat); assign_mat(tip, mat)
        parts += [e, tip]
    return parts

def periscopes(name, x, y, z, mat, n=2, gap=0.24):
    parts = []
    for i in range(n):
        p = bx_local(f'{name}{i}', 0.15, 0.1, 0.06, x + (i - (n - 1) / 2) * gap, y, z, bevel=0.006)
        assign_mat(p, mat)
        parts.append(p)
    return parts

def tow_hooks(name, x, y, z, gap, mat):
    parts = []
    for s in (-1, 1):
        p = bx_local(f'{name}{s}', 0.12, 0.3, 0.14, x + s * gap, y, z, bevel=0.01)
        assign_mat(p, mat)
        parts.append(p)
    return parts

def fuel_drum(name, x, y, z, mat):
    o = cyl(name, 0.24, 0.6, x, y, z, seg=12, rx=math.pi / 2)
    assign_mat(o, mat)
    return [o]
