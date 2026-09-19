"""probe_glb.py — print node hierarchy + world bounds of a GLB.
Usage: blender.exe --background --python probe_glb.py -- <glb_path>
"""
import bpy
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

def bounds(objs):
    mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
    for c in objs:
        if c.type == 'MESH':
            for corner in c.bound_box:
                wc = c.matrix_world @ Vector(corner)
                mins = Vector(map(min, mins, wc))
                maxs = Vector(map(max, maxs, wc))
    return mins, maxs

for o in bpy.context.scene.objects:
    if o.parent is None:
        print(f'NODE {o.name} type={o.type}')
        for c in [o] + list(o.children_recursive):
            if c.type == 'MESH':
                mn, mx = bounds([c])
                vs = len(c.data.vertices)
                print(f'  - {c.name} vs={vs} min={tuple(round(v, 2) for v in mn)} max={tuple(round(v, 2) for v in mx)}')
            else:
                print(f'  - {c.name} ({c.type})')
