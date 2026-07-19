"""Valence Garage: the refined Duel trophy, rendered as a turntable
sprite sequence with true EEVEE glass refraction — Blender-quality
lighting baked into frames that play anywhere, including phones.

Run:  blender -b -P blender_trophy_spin.py -- <frames_dir>
Emits <frames_dir>/f00.png .. f31.png (32 frames, transparent).
"""
import bpy
import math
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metallic, roughness, transmission=0.0,
        emissive=None, emissive_strength=0.0, ior=1.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    b.inputs["IOR"].default_value = ior
    if emissive:
        b.inputs["Emission Color"].default_value = (*emissive, 1.0)
        b.inputs["Emission Strength"].default_value = emissive_strength
    return m


M_PLINTH = mat("t_plinth", (0.012, 0.014, 0.018), 0.75, 0.32)
M_GOLD = mat("t_gold", (0.75, 0.57, 0.22), 1.0, 0.12,
             emissive=(0.75, 0.57, 0.22), emissive_strength=0.5)
M_CRYSTAL = mat("t_crystal", (0.10, 0.30, 0.34), 0.0, 0.03,
                transmission=0.92, ior=1.55)


def cyl(name, r, depth, z, material, verts=8, rot=0.0):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r, depth=depth, vertices=verts, location=(0, 0, z),
        rotation=(0, 0, rot))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(material)
    return ob


def cone(name, r1, r2, depth, z, material, verts=8, rot=0.0):
    bpy.ops.mesh.primitive_cone_add(
        radius1=r1, radius2=r2, depth=depth, vertices=verts,
        location=(0, 0, z), rotation=(0, 0, rot))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(material)
    return ob


root_parts = []
root_parts.append(cyl("base_lower", 0.30, 0.06, 0.03, M_PLINTH, verts=8))
root_parts.append(cyl("base_upper", 0.24, 0.05, 0.085, M_PLINTH, verts=8,
                      rot=math.pi / 8))
root_parts.append(cyl("collar", 0.175, 0.045, 0.13, M_GOLD, verts=8))
root_parts.append(cone("obelisk", 0.15, 0.055, 0.62, 0.46, M_CRYSTAL, verts=8))
root_parts.append(cone("tip", 0.055, 0.0, 0.14, 0.84, M_CRYSTAL, verts=8))


def v_arm(name, sign):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sign * 0.045, 0, 1.01))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (0.014, 0.014, 0.155)      # slim gold blades
    ob.rotation_euler = (0, sign * 0.40, 0)
    ob.data.materials.append(M_GOLD)
    return ob


root_parts.append(v_arm("v_left", -1))
root_parts.append(v_arm("v_right", 1))

bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=(0, 0, 0.938),
                                     segments=24, ring_count=16)
joint = bpy.context.active_object
joint.name = "v_joint"
bpy.ops.object.shade_smooth()
joint.data.materials.append(M_GOLD)
root_parts.append(joint)

# Parent everything to a turntable empty for clean rotation.
bpy.ops.object.empty_add(location=(0, 0, 0))
pivot = bpy.context.active_object
pivot.name = "turntable"
for ob in root_parts:
    ob.parent = pivot

# Lighting: cool key, warm gold rim, soft top fill.
def area(name, loc, rot, energy, color=(1, 1, 1), size=2.0):
    L = bpy.data.lights.new(name, 'AREA')
    L.energy = energy
    L.color = color
    L.size = size
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.collection.objects.link(ob)
    return ob


area("key", (2.4, -1.6, 2.2), (0.9, 0.35, 0.9), 1000, (0.85, 0.95, 1.0))
area("rim", (-2.0, 1.6, 1.2), (1.25, 0, -2.45), 700, (1.0, 0.8, 0.42))
area("fill", (0, 0, 3.4), (0, 0, 0), 250, (0.9, 0.95, 1.0), size=4.0)

# Camera: low hero angle.
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (1.35, -1.5, 0.72)
bpy.context.collection.objects.link(cam)
import mathutils
direction = mathutils.Vector((0, 0, 0.52)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
if hasattr(scene.eevee, "use_ssr"):
    scene.eevee.use_ssr = True
    scene.eevee.use_ssr_refraction = True
if hasattr(scene.eevee, "use_raytracing"):
    scene.eevee.use_raytracing = True
M_CRYSTAL.use_screen_refraction = True

scene.render.resolution_x = 360
scene.render.resolution_y = 460
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.0, 0.0, 0.0, 1)

out_dir = sys.argv[sys.argv.index("--") + 1]
FRAMES = 32
for f in range(FRAMES):
    pivot.rotation_euler = (0, 0, 2 * math.pi * f / FRAMES)
    scene.render.filepath = "%s/f%02d.png" % (out_dir, f)
    bpy.ops.render.render(write_still=True)

print("SPIN_OK", out_dir)
