"""preview.py — render a GLB tank preview (Cycles CPU, headless-safe).
Usage: blender.exe --background --python preview.py -- <glb_path> <out_png>
"""
import bpy
import sys
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb_path, out_png = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)

# frame the imported root
roots = [o for o in bpy.context.scene.objects if o.parent is None]
mins = Vector((1e9, 1e9, 1e9))
maxs = Vector((-1e9, -1e9, -1e9))
for o in roots:
    if o.type == 'EMPTY':
        for c in o.children_recursive:
            if c.type == 'MESH':
                for corner in c.bound_box:
                    wc = c.matrix_world @ Vector(corner)
                    mins = Vector(map(min, mins, wc))
                    maxs = Vector(map(max, maxs, wc))
center = (mins + maxs) / 2
size = max((maxs - mins).length, 1)

# camera: 3/4 front-left view (nose is -Y)
cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
ang = math.radians(215)
dist = size * 1.18
cam.location = (center.x + math.sin(ang) * dist, center.y + math.cos(ang) * dist, center.z + size * 0.55)
direction = center - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 50
bpy.context.scene.camera = cam

# world + sun
world = bpy.data.worlds.new('w')
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.52, 0.6, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 3.5
sun_data.angle = 0.2
sun = bpy.data.objects.new('sun', sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 720
scene.render.resolution_y = 480
scene.view_settings.view_transform = 'Filmic'
scene.render.filepath = out_png
bpy.ops.render.render(write_still=True)
print('PREVIEW SAVED', out_png)
