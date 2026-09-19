"""
build_all.py — builds all 8 TankMe vehicles as rigged GLB assets.

Run headless:
  blender.exe --background --python build_all.py

Design references (public historical sources; originals rebuilt by TankMe):
  KESTREL   ~ M551 Sheridan   (light, compact hull, forward turret, big gun)
  JACKAL    ~ Type 62         (light, small turret, slim gun)
  BULWARK   ~ M4 Sherman      (medium, rounded cast turret, tall hull)
  VANGUARD  ~ M48 Patton      (medium, long cast turret, cupola)
  IRONWOLF  ~ Tiger I         (heavy, boxy, long gun, wide hull)
  COLOSSUS  ~ Maus            (super heavy, massive)
  MAUL      ~ ISU-152         (TD, casemate, huge gun)
  LANCE     ~ AMX 50 Foch     (TD, low casemate, long gun)
"""
import bpy
import bmesh
import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import tank_kit as K  # noqa: E402

OUT_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

def game_glb_dir(tank_id):
    """GLBs the game actually serves live in public/tanks (Vite static root)."""
    p = os.path.abspath(os.path.join(OUT_ROOT, '..', 'public', 'tanks', tank_id))
    os.makedirs(p, exist_ok=True)
    return p

# ------------------------------------------------------------- paint schemes
SCHEMES = {
    'green': {
        'name': 'green', 'base': (98, 112, 66), 'blotch': (74, 86, 52),
        'blotch2': (58, 66, 44), 'mud': (92, 80, 56),
    },
    'desert': {
        'name': 'desert', 'base': (176, 158, 108), 'blotch': (142, 126, 88),
        'blotch2': (112, 100, 74), 'mud': (98, 88, 62),
    },
    'grey': {
        'name': 'grey', 'base': (140, 147, 152), 'blotch': (108, 114, 120),
        'blotch2': (86, 92, 98), 'mud': (96, 88, 70),
    },
}

_cache = {}

def scheme_materials(scheme_key, seed):
    key = (scheme_key, seed)
    if key in _cache:
        return _cache[key]
    s = SCHEMES[scheme_key]
    tex_dir = os.path.join(OUT_ROOT, 'textures', s['name'])
    a, r, n = K.make_pbr_textures(tex_dir, s, seed)
    ta, tn = K.make_track_textures(tex_dir, seed)
    mats = {
        'paint': K.pbr_material(f'paint_{scheme_key}', a, r, n, metallic=0.18),
        'gun': K.pbr_material(f'gun_{scheme_key}', a, r, n, metallic=0.3),
        'track': K.pbr_material('track', ta, ta.replace('albedo', 'normal'), metallic=0.45)
        if False else K.pbr_material('track', ta, ta, tn, metallic=0.45, scale=1.4),
        'rubber': K.simple_material('rubber', (0.06, 0.06, 0.065), metallic=0.0, rough=0.95),
        'dark': K.simple_material('darksteel', (0.09, 0.095, 0.1), metallic=0.5, rough=0.5),
        'rust': K.simple_material('rust', (0.32, 0.2, 0.12), metallic=0.35, rough=0.85),
    }
    _cache[key] = mats
    return mats

# ------------------------------------------------------------- hull builders

def hull_loft(name, cfg, w_bot, w_top, l, h, front_in, rear_in, mat, bevel=0.03):
    """Lofted hull: bottom rect + top rect (front/rear pulled in → sloped plates)."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    hw_b, hw_t = w_bot / 2, w_top / 2
    hl = l / 2
    v = []
    # bottom: 0-3  (front = -Y)
    v.append(bm.verts.new((-hw_b, -hl, 0)))
    v.append(bm.verts.new((hw_b, -hl, 0)))
    v.append(bm.verts.new((hw_b, hl, 0)))
    v.append(bm.verts.new((-hw_b, hl, 0)))
    # top: 4-7
    v.append(bm.verts.new((-hw_t, -hl + front_in, h)))
    v.append(bm.verts.new((hw_t, -hl + front_in, h)))
    v.append(bm.verts.new((hw_t, hl - rear_in, h)))
    v.append(bm.verts.new((-hw_t, hl - rear_in, h)))
    faces = [
        (v[0], v[1], v[5], v[4]),   # front slope
        (v[1], v[2], v[6], v[5]),   # right side
        (v[2], v[3], v[7], v[6]),   # rear
        (v[3], v[0], v[4], v[7]),   # left side
        (v[7], v[4], v[5], v[6]),   # top
        (v[3], v[2], v[1], v[0]),   # bottom
    ]
    for f in faces:
        try:
            bm.faces.new(f)
        except ValueError:
            pass
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    if bevel > 0 and cfg.get('detail', 0) == 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
        K._apply_mods(o)
    K.assign_mat(o, mat)
    return o

def add_engine_deck(o_list, cfg, mat, detail):
    """Louvres / grill at the rear top."""
    if detail > 1:
        return
    y0 = cfg['hull_len'] / 2 - cfg.get('deck_len', 1.3) / 2 - 0.25
    z = cfg['hull_h'] + cfg['hull_z'] + 0.02
    w = cfg['hull_w_top'] * 0.6
    for i in range(3):
        o_list.append(K.bx_local(f'deck_{i}', w, 0.1, 0.05,
                                 0, y0 - i * 0.22, z + 0.03))

# ------------------------------------------------------------- turrets

def cast_turret(name, cfg, mat, mat_dark, detail):
    """Rounded cast turret (Sherman / Patton / Type62 style)."""
    r_xy = cfg['turret_r']
    scale_y = cfg.get('turret_sy', 1.35)
    th = cfg['turret_h']
    body = K.sphere(f'{name}_body', r_xy, r_xy * scale_y, th * 1.1,
                    seg=32 if detail == 0 else 20, cut_below=th * 0.3)
    body.location = (0, 0, th * 0.28)
    K.assign_mat(body, mat)
    parts = [body]
    # mantlet
    parts.append(K.cyl(f'{name}_mantlet', cfg['gun_r'] * 2.1, 0.34,
                       0, -r_xy * scale_y * 0.92, th * 0.42, seg=16, rx=math.pi / 2))
    for p in parts:
        K.assign_mat(p, mat)
    # bustle (Patton)
    if cfg.get('bustle'):
        parts.append(K.bx_local(f'{name}_bustle', r_xy * 1.0, cfg.get('bustle_len', 0.7), th * 0.5,
                                0, r_xy * scale_y * 0.95 + cfg.get('bustle_len', 0.7) / 2 - 0.1, th * 0.45))
    K.assign_mat(parts[-1], mat)
    # cupola
    if cfg.get('cupola', True) and detail < 2:
        cp = K.cupola(f'{name}_cupola', th * 0.26, cfg.get('cupola_x', r_xy * 0.42),
                      cfg.get('cupola_y', r_xy * scale_y * 0.3), th * 1.02, mat, mat_dark)
        parts += cp
    elif detail < 2:
        parts += K.hatch(f'{name}_hatch', th * 0.24, -cfg.get('cupola_x', r_xy * 0.4),
                         cfg.get('cupola_y', 0.2), th * 1.02, mat_dark)
    # antenna
    if detail == 0:
        parts += K.antenna(f'{name}_ant', -r_xy * 0.7, r_xy * scale_y * 0.5, th * 1.05, mat_dark)
    # stowage rail at rear
    if detail == 0:
        parts += K.stowage(f'{name}_stow', 0, r_xy * scale_y * 1.05, th * 0.4,
                           r_xy * 1.2, 0.16, th * 0.42, mat_dark)
    j = K.join(parts, 'TurretMesh')
    return j

def boxy_turret(name, cfg, mat, mat_dark, detail):
    """Welded/boxy turret (Tiger / Maus style) with sloped cheeks."""
    w, d, h = cfg['turret_w'], cfg['turret_d'], cfg['turret_h']
    parts = []
    body = hull_loft(f'{name}_body', cfg, w, w * 0.86, d, h,
                     front_in=d * 0.22, rear_in=d * 0.1, mat=mat)
    body.location = (0, cfg.get('turret_y', 0), h / 2)
    K.assign_mat(body, mat)
    parts.append(body)
    # gun cheeks
    for s in (-1, 1):
        c = K.wedge(f'{name}_cheek{s}', w * 0.34, 0.5, h * 0.8, s * w * 0.24, -d * 0.42, h * 0.52, ry=0, rx=0)
        c.rotation_euler = (0, s * 0.42, 0)
        K.assign_mat(c, mat)
        parts.append(c)
    # mantlet block
    parts.append(K.bx_local(f'{name}_mantlet', w * 0.4, 0.4, h * 0.42, 0, -d * 0.48, h * 0.42))
    K.assign_mat(parts[-1], mat_dark)
    # commander cupola
    if detail < 2:
        cp = K.cupola(f'{name}_cupola', h * 0.26, w * 0.2, d * 0.18, h + 0.08, mat, mat_dark)
        parts += cp
        parts += K.hatch(f'{name}_hatch', h * 0.2, -w * 0.22, d * 0.15, h + 0.08, mat_dark)
    if detail == 0:
        parts += K.stowage(f'{name}_bins', w * 0.48, 0.1, h * 0.45, 0.14, d * 0.5, h * 0.45, mat)
        parts += K.stowage(f'{name}_bins2', -w * 0.48, 0.1, h * 0.45, 0.14, d * 0.5, h * 0.45, mat)
    j = K.join(parts, 'TurretMesh')
    return j

def casemate(name, cfg, mat, mat_dark, detail):
    """Fixed superstructure (ISU-152 / Foch style). Returns joined mesh + gun pivot pos."""
    parts = []
    w, d, h = cfg['turret_w'], cfg['turret_d'], cfg['turret_h']
    y0 = cfg.get('turret_y', 0.2)
    body = K.wedge(f'{name}_cas', w, d, h, 0, y0, cfg['hull_h'] + cfg['hull_z'] + h / 2 - 0.02, ry=0)
    K.assign_mat(body, mat)
    parts.append(body)
    # sloped front plate
    fp = K.wedge(f'{name}_front', w * 0.96, 0.62, h * 0.96, 0, y0 - d / 2 + 0.2,
                 cfg['hull_h'] + cfg['hull_z'] + h / 2, rx=-0.42)
    K.assign_mat(fp, mat)
    parts.append(fp)
    # roof hatch + periscopes
    if detail < 2:
        parts += K.hatch(f'{name}_hatch', 0.2, -w * 0.25, y0 + d * 0.18,
                         cfg['hull_h'] + cfg['hull_z'] + h + 0.02, mat_dark)
        parts += K.periscopes(f'{name}_peri', 0, y0 - d / 2 + 0.5, cfg['hull_h'] + cfg['hull_z'] + h + 0.04, mat_dark, n=2)
    if detail == 0:
        parts += K.stowage(f'{name}_rail', 0, y0 + d / 2 - 0.1, cfg['hull_h'] + cfg['hull_z'] + h + 0.12, w * 0.7, 0.14, 0.2, mat)
    j = K.join(parts, 'CasemateMesh')
    return j

# ------------------------------------------------------------- running gear

def build_running_gear(cfg, mats, detail):
    w_out = []
    n = cfg['wheels']
    span = cfg['hull_len'] - 2 * cfg['wheel_inset']
    r = cfg['wheel_r']
    for s in (-1, 1):
        x = s * (cfg['hull_w_bot'] / 2 + cfg['track_w'] / 2)
        parts = []
        for i in range(n):
            t = i / (n - 1)
            y = -span / 2 + t * span
            lift = cfg.get('end_lift', 0.0) * (1 if t in (0.0, 1.0) else 0)
            parts += K.road_wheel(f'w{s}_{i}', r, cfg['track_w'] * 0.82, x, y, r + 0.06 + lift,
                                  mats['rubber'], mats['dark'], seg=18 if detail == 0 else 10)
        pw = K.join(parts, f'Wheels_{"L" if s < 0 else "R"}')
        w_out.append(pw)
    return w_out

def build_tracks(cfg, mats, detail):
    objs = K.track_run('Track', cfg, mats['track'], detail)
    return objs

# ------------------------------------------------------------- assembly

def assemble(tank_id, cfg, scheme_key, seed, detail):
    K._clean_scene()
    _cache.clear()  # factory reset freed all material datablocks
    mats = scheme_materials(scheme_key, seed)
    d = cfg
    d['detail'] = detail

    # ---- hull
    hull = hull_loft('HullMesh', d, d['hull_w_bot'], d['hull_w_top'], d['hull_len'], d['hull_h'],
                     d.get('front_in', 0.7), d.get('rear_in', 0.3), mats['paint'],
                     bevel=0.03 if detail == 0 else 0.015)
    hull.location = (0, 0, d['hull_z'])
    hull_parts = [hull]
    # rear engine deck box (raised stern plate look)
    deck_h = d.get('sponson_h', d['hull_h'] * 0.4)
    deck = K.bx_local('deckbox', d['hull_w_top'] * 0.94, d['hull_len'] * 0.3, deck_h,
                      0, d['hull_len'] / 2 - d['hull_len'] * 0.15,
                      d['hull_z'] + d['hull_h'] + deck_h / 2 - 0.01)
    K.assign_mat(deck, mats['paint'])
    hull_parts.append(deck)
    add_engine_deck(hull_parts, d, mats['dark'], detail)
    # front details
    if detail == 0:
        hull_parts += K.tow_hooks('tow', 0, -d['hull_len'] / 2 - 0.05, d['hull_z'] + 0.16, d['hull_w_bot'] * 0.22, mats['dark'])
        hull_parts += K.periscopes('peri', 0, -d['hull_len'] / 2 + d.get('front_in', 0.7) + 0.15,
                                   d['hull_z'] + d['hull_h'] + 0.05, mats['dark'])
    # headlights
    if detail < 2:
        for s in (-1, 1):
            h0 = K.bx_local(f'head{s}', 0.14, 0.12, 0.12, s * d['hull_w_top'] * 0.3, -d['hull_len'] / 2 + 0.12,
                            d['hull_z'] + d['hull_h'] * 0.62, bevel=0.01)
            K.assign_mat(h0, mats['dark'])
            hull_parts.append(h0)
    hull_j = K.join(hull_parts, 'HullMesh')

    # ---- exhaust
    ex = []
    if detail < 2 and not d.get('no_exhaust'):
        ex = K.exhaust_pair('exh', d.get('exh_x', d['hull_w_top'] * 0.25), d['hull_len'] / 2 - 0.35,
                            d['hull_z'] + d['hull_h'], mats['dark'], d.get('exh_gap', 0.3))

    # ---- turret / gun
    turret_top = d['hull_z'] + d['hull_h']
    turret_empty = K.empty('Turret', 0, d.get('turret_y', 0), turret_top)
    gun_pivot_z = d.get('gun_pivot_z', d['turret_h'] * 0.42)
    if d.get('kind') == 'casemate':
        cm = casemate('Cas', d, mats['paint'], mats['dark'], detail)
        cm.parent = turret_empty
        cm.matrix_parent_inverse = turret_empty.matrix_world.inverted()
        cannon_empty = K.empty('Cannon', 0, -d['turret_d'] / 2 + 0.15, gun_pivot_z)
        cannon_empty.parent = turret_empty
    else:
        if d.get('turret_style', 'cast') == 'cast':
            tm = cast_turret('Tur', d, mats['paint'], mats['dark'], detail)
        else:
            tm = boxy_turret('Tur', d, mats['paint'], mats['dark'], detail)
        tm.parent = turret_empty  # parts were built pivot-relative
        cannon_empty = K.empty('Cannon', 0,
                               -(d.get('turret_d', 2) / 2 + 0.3) if d.get('turret_style') == 'boxy' else -(d.get('turret_r', 1) * d.get('turret_sy', 1.3) * 0.92),
                               gun_pivot_z)
        cannon_empty.parent = turret_empty

    # cannon meshes (built pivot-relative at origin, nose along -Y)
    gparts = K.gun_assembly('Gun', d, mats['gun'], mats['dark'], detail)
    for p in gparts:
        p.parent = cannon_empty
    muzzle = K.empty('Muzzle', 0, -d['gun_len'] + 0.05, 0)
    muzzle.parent = cannon_empty

    # ---- running gear
    wheels = build_running_gear(d, mats, detail)
    tracks = build_tracks(d, mats, detail)

    # ---- root
    root = K.empty('TankRoot')
    K.parent_to([hull_j] + ex, root)
    K.parent_to([turret_empty], root)
    K.parent_to(wheels, root)
    K.parent_to(tracks, root)

    # ---- export: source copy under assets/, served copy under public/tanks
    out_dir = os.path.join(OUT_ROOT, tank_id)
    os.makedirs(out_dir, exist_ok=True)
    outs = []
    for target in (out_dir, game_glb_dir(tank_id)):
        out = os.path.join(target, f'{tank_id}_LOD{detail}.glb')
        outs.append(out)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    K._select_only(root)
    for o in bpy.context.view_layer.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=outs[0], export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True,
        export_materials='EXPORT', export_image_format='AUTO',
    )
    import shutil
    for extra in outs[1:]:
        shutil.copyfile(outs[0], extra)
    print(f'EXPORTED {outs[0]}')
    return outs[0]


TANKS = {
    # KESTREL — M551 Sheridan inspired: low aluminum hull, forward turret, big gun
    'kestrel': dict(
        scheme='desert', seed=11,
        hull_len=5.8, hull_w_bot=2.7, hull_w_top=2.45, hull_h=0.85, hull_z=0.62,
        front_in=1.05, rear_in=0.35, sponson_h=0.3,
        wheels=5, wheel_r=0.42, wheel_inset=0.85, track_w=0.42,
        turret_style='cast', turret_y=-0.5, turret_r=1.05, turret_sy=1.15, turret_h=0.62,
        gun_r=0.15, gun_len=3.9, muzzle='heavy', gun_pivot_z=0.3,
        top_run_z=1.25, sag=0.03,
        cls='light',
    ),
    # JACKAL — Type 62 inspired: compact, small rounded turret, slim gun
    'jackal': dict(
        scheme='green', seed=22,
        hull_len=5.5, hull_w_bot=2.6, hull_w_top=2.35, hull_h=0.8, hull_z=0.6,
        front_in=0.8, rear_in=0.3, sponson_h=0.26,
        wheels=5, wheel_r=0.4, wheel_inset=0.8, track_w=0.4,
        turret_style='cast', turret_y=0.25, turret_r=0.85, turret_sy=1.2, turret_h=0.6,
        gun_r=0.11, gun_len=3.6, muzzle='extractor', gun_pivot_z=0.3,
        top_run_z=1.18, sag=0.03,
        cls='light',
    ),
    # BULWARK — M4 Sherman inspired: tall rounded hull, cast turret, bogie feel
    'bulwark': dict(
        scheme='green', seed=33,
        hull_len=5.9, hull_w_bot=2.75, hull_w_top=2.6, hull_h=0.95, hull_z=0.66,
        front_in=0.55, rear_in=0.3, sponson_h=0.34,
        wheels=6, wheel_r=0.4, wheel_inset=0.8, track_w=0.44,
        turret_style='cast', turret_y=0.1, turret_r=0.95, turret_sy=1.25, turret_h=0.72,
        gun_r=0.115, gun_len=3.7, muzzle='extractor', gun_pivot_z=0.34,
        top_run_z=1.3, sag=0.03,
        cls='medium',
    ),
    # VANGUARD — M48 Patton inspired: long cast turret with bustle + cupola
    'vanguard': dict(
        scheme='green', seed=44,
        hull_len=6.4, hull_w_bot=3.0, hull_w_top=2.8, hull_h=0.9, hull_z=0.68,
        front_in=0.9, rear_in=0.35, sponson_h=0.32,
        wheels=6, wheel_r=0.46, wheel_inset=0.9, track_w=0.48,
        turret_style='cast', turret_y=0.15, turret_r=1.1, turret_sy=1.4, turret_h=0.78,
        bustle=True, bustle_len=0.75,
        gun_r=0.13, gun_len=4.3, muzzle='extractor', gun_pivot_z=0.36,
        top_run_z=1.38, sag=0.03,
        cls='medium',
    ),
    # IRONWOLF — Tiger I inspired: boxy hull & turret, long gun, wide
    'ironwolf': dict(
        scheme='grey', seed=55,
        hull_len=6.2, hull_w_bot=3.15, hull_w_top=3.0, hull_h=0.95, hull_z=0.72,
        front_in=0.35, rear_in=0.2, sponson_h=0.36,
        wheels=8, wheel_r=0.42, wheel_inset=0.7, track_w=0.52,
        turret_style='boxy', turret_y=0.1, turret_w=2.2, turret_d=2.1, turret_h=0.8,
        gun_r=0.13, gun_len=4.7, muzzle='brake2', gun_pivot_z=0.4,
        top_run_z=1.42, sag=0.03,
        cls='heavy',
    ),
    # COLOSSUS — Maus inspired: massive, huge boxy turret
    'colossus': dict(
        scheme='grey', seed=66,
        hull_len=7.0, hull_w_bot=3.4, hull_w_top=3.2, hull_h=1.05, hull_z=0.8,
        front_in=0.75, rear_in=0.3, sponson_h=0.4,
        wheels=8, wheel_r=0.5, wheel_inset=0.85, track_w=0.56,
        turret_style='boxy', turret_y=0.1, turret_w=2.6, turret_d=2.7, turret_h=0.95,
        gun_r=0.16, gun_len=4.6, muzzle='heavy', gun_pivot_z=0.46,
        top_run_z=1.55, sag=0.035,
        cls='heavy',
    ),
    # MAUL — ISU-152 inspired: casemate, huge gun, no rotating turret
    'maul': dict(
        scheme='green', seed=77,
        hull_len=6.6, hull_w_bot=3.05, hull_w_top=2.9, hull_h=0.95, hull_z=0.68,
        front_in=0.35, rear_in=0.25, sponson_h=0.34,
        wheels=6, wheel_r=0.46, wheel_inset=0.85, track_w=0.5,
        kind='casemate', turret_w=2.7, turret_d=2.6, turret_h=0.85, turret_y=0.15,
        gun_r=0.17, gun_len=4.0, muzzle='brake2', gun_pivot_z=0.4,
        top_run_z=1.4, sag=0.03,
        cls='td',
    ),
    # LANCE — AMX 50 Foch inspired: low long casemate, very long gun
    'lance': dict(
        scheme='desert', seed=88,
        hull_len=6.7, hull_w_bot=3.0, hull_w_top=2.85, hull_h=0.8, hull_z=0.66,
        front_in=0.55, rear_in=0.35, sponson_h=0.3,
        wheels=5, wheel_r=0.5, wheel_inset=1.0, track_w=0.48,
        kind='casemate', turret_w=2.7, turret_d=2.9, turret_h=0.7, turret_y=0.3,
        gun_r=0.115, gun_len=5.2, muzzle='brake2', gun_pivot_z=0.34,
        top_run_z=1.32, sag=0.03,
        cls='td',
    ),
}

def main():
    only = None
    for a in sys.argv:
        if a.startswith('--tank='):
            only = a.split('=')[1]
        if a.startswith('--lod='):
            global LOD_ONLY
    for tank_id, cfg in TANKS.items():
        if only and tank_id != only:
            continue
        for detail in (0, 1, 2):
            assemble(tank_id, dict(cfg), cfg['scheme'], cfg['seed'], detail)
            print(f'DONE {tank_id} LOD{detail}')
    print('ALL BUILDS COMPLETE')

main()
