"""Valence Garage: the Duel trophy, modeled in Blender.

A faceted obelisk of dark crystal rising from a gold collar and
near-black plinth, crowned with a floating gold 'V' prism. Low-poly
faceting is deliberate: crisp planar highlights, jewel-like under the
app's environment lighting, tiny on disk.

Run:  blender -b -P blender_trophy.py -- <out.glb>
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


M_PLINTH = mat("t_plinth", (0.01, 0.012, 0.015), 0.7, 0.4)
M_GOLD = mat("t_gold", (0.72, 0.55, 0.22), 1.0, 0.15,
             emissive=(0.72, 0.55, 0.22), emissive_strength=0.35)
M_CRYSTAL = mat("t_crystal", (0.06, 0.16, 0.19), 0.0, 0.06,
                transmission=0.65, ior=1.6)


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


# Plinth: two stacked octagonal blocks.
cyl("base_lower", 0.30, 0.06, 0.03, M_PLINTH, verts=8)
cyl("base_upper", 0.24, 0.05, 0.085, M_PLINTH, verts=8, rot=math.pi / 8)

# Gold collar.
cyl("collar", 0.175, 0.045, 0.13, M_GOLD, verts=8)

# Crystal obelisk: a tall tapering octagonal prism with a pyramidal tip.
cone("obelisk", 0.15, 0.055, 0.62, 0.46, M_CRYSTAL, verts=8)
cone("tip", 0.055, 0.0, 0.14, 0.84, M_CRYSTAL, verts=8)

# Floating gold V: two mirrored slender prisms above the tip.
def v_arm(name, sign):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sign * 0.052, 0, 1.02))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (0.028, 0.028, 0.16)
    ob.rotation_euler = (0, sign * 0.42, 0)
    ob.data.materials.append(M_GOLD)
    return ob


v_arm("v_left", -1)
v_arm("v_right", 1)

# Small gold sphere at the V's base joint.
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, location=(0, 0, 0.945),
                                     segments=24, ring_count=16)
joint = bpy.context.active_object
joint.name = "v_joint"
bpy.ops.object.shade_smooth()
joint.data.materials.append(M_GOLD)

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
print("TROPHY_OK", out)
