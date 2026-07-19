"""Valence Garage: the gold V monogram, rendered as a slow turntable
sprite sequence — the brand mark floating behind the Garage marquee.

Two chiseled gold blades rise from a polished joint, threaded through
a floating octagonal halo ring. Real EEVEE metal + rim light baked
into 32 transparent frames.

Run:  blender -b -P blender_vmono_spin.py -- <frames_dir>
Emits <frames_dir>/f00.png .. f31.png (32 frames, transparent).
"""
import bpy
import math
import sys
import mathutils

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metallic, roughness, emissive=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emissive:
        b.inputs["Emission Color"].default_value = (*emissive, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    return m


M_GOLD = mat("v_gold", (0.75, 0.57, 0.22), 1.0, 0.14,
             emissive=(0.75, 0.57, 0.22), strength=0.35)
M_DARKGOLD = mat("v_darkgold", (0.42, 0.30, 0.10), 1.0, 0.30)

parts = []

# --- V geometry, solved so the two blades meet cleanly at a bottom vertex
#     and open upward to two tips. Each blade is a line from the shared
#     vertex A to a tip B; we place the prism at the midpoint and rotate it
#     to align with B-A. ---
A = mathutils.Vector((0.0, 0.0, 0.12))   # shared bottom vertex


def blade(sign):
    tip = mathutils.Vector((sign * 0.52, 0.0, 1.04))   # upper outer tip
    mid = (A + tip) * 0.5
    d = tip - A
    L = d.length
    theta = sign * math.atan2(abs(d.x), d.z)           # tilt about Y
    bpy.ops.mesh.primitive_cube_add(size=1, location=(mid.x, mid.y, mid.z))
    ob = bpy.context.active_object
    ob.scale = (0.068, 0.052, L * 0.5)                 # chiseled blade
    ob.rotation_euler = (0, theta, 0)
    ob.data.materials.append(M_GOLD)
    parts.append(ob)
    return tip


tip_l = blade(-1)
tip_r = blade(1)

# Polished joint sphere exactly at the shared vertex where the blades meet.
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.075, location=(A.x, A.y, A.z),
                                     segments=28, ring_count=18)
joint = bpy.context.active_object
bpy.ops.object.shade_smooth()
joint.data.materials.append(M_GOLD)
parts.append(joint)

# Finial spheres capping each upper tip.
for tip in (tip_l, tip_r):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05,
                                         location=(tip.x, tip.y, tip.z),
                                         segments=24, ring_count=14)
    cap = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    cap.data.materials.append(M_GOLD)
    parts.append(cap)

# Camera-facing halo ring behind the V: normal along Y so it reads as a full
# circle (not an edge-on line) from the low front camera. A thin dark-gold
# maison crest ring.
bpy.ops.mesh.primitive_torus_add(major_radius=0.76, minor_radius=0.018,
                                 major_segments=64, minor_segments=12,
                                 location=(0, 0.14, 0.60),
                                 rotation=(math.pi / 2, 0, 0))
halo = bpy.context.active_object
halo.data.materials.append(M_DARKGOLD)
parts.append(halo)

# Parent to a turntable empty.
bpy.ops.object.empty_add(location=(0, 0, 0))
pivot = bpy.context.active_object
pivot.name = "turntable"
for ob in parts:
    ob.parent = pivot


def area(name, loc, rot, energy, color=(1, 1, 1), size=2.0):
    L = bpy.data.lights.new(name, 'AREA')
    L.energy = energy
    L.color = color
    L.size = size
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.collection.objects.link(ob)


area("key", (2.2, -1.8, 1.8), (0.85, 0.3, 0.85), 900, (0.85, 0.95, 1.0))
area("rim", (-1.8, 1.7, 1.0), (1.25, 0, -2.45), 800, (1.0, 0.8, 0.42))
area("fill", (0, 0, 3.0), (0, 0, 0), 200, (0.9, 0.95, 1.0), size=4.0)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0.0, -2.35, 0.66)
bpy.context.collection.objects.link(cam)
direction = mathutils.Vector((0, 0, 0.56)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 420
scene.render.resolution_y = 420
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)

out_dir = sys.argv[sys.argv.index("--") + 1]
FRAMES = 32
# A flat V-in-halo collapses to a thin profile at 90deg, so we do NOT spin it
# a full turn. Instead the crest SWAYS: a seamless sine yaw of +/-25deg that
# reveals real 3D parallax on the blades and ring while always reading as a V.
# sin() over one full period loops perfectly (f=0 and f=FRAMES both yaw 0).
SWAY = math.radians(25)
for f in range(FRAMES):
    yaw = SWAY * math.sin(2 * math.pi * f / FRAMES)
    pivot.rotation_euler = (0, 0, yaw)
    scene.render.filepath = "%s/f%02d.png" % (out_dir, f)
    bpy.ops.render.render(write_still=True)

print("VSPIN_OK", out_dir)
