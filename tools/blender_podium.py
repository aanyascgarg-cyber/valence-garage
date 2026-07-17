"""Valence Garage: bespoke showroom turntable podium, modeled in Blender.

A three-tier luxury display base:
  - wide near-black plinth with a soft bevel
  - dark brushed-steel main disc
  - inset polished GOLD ring at the rim plus a slim gold center medallion

Exported as GLB with Principled PBR materials. Run:
  blender -b -P blender_podium.py -- <out.glb>
"""
import bpy
import math
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, metallic, roughness, emissive=None, emissive_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    return m


M_PLINTH = mat("plinth", (0.012, 0.014, 0.016), 0.6, 0.55)
M_DISC = mat("disc", (0.035, 0.04, 0.045), 0.85, 0.34)
M_GOLD = mat("gold", (0.72, 0.55, 0.22), 1.0, 0.18,
             emissive=(0.72, 0.55, 0.22), emissive_strength=0.25)


def add_cylinder(name, radius, depth, z, material, bevel=0.012, segs=96):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=segs, location=(0, 0, z))
    ob = bpy.context.active_object
    ob.name = name
    bev = ob.modifiers.new("bevel", 'BEVEL')
    bev.width = bevel
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="bevel")
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    return ob


def add_ring(name, major_r, minor_r, z, material):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_r, minor_radius=minor_r,
        major_segments=128, minor_segments=24, location=(0, 0, z))
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(material)
    return ob


# Geometry (meters). The app scales cars to a 2.6 m footprint; the podium
# top surface must sit exactly at z = 0 so the car rests on it.
DISC_T = 0.075
PLINTH_T = 0.05

add_cylinder("plinth", 2.30, PLINTH_T, -DISC_T - PLINTH_T / 2, M_PLINTH,
             bevel=0.018)
add_cylinder("disc", 2.05, DISC_T, -DISC_T / 2, M_DISC, bevel=0.02)

# Gold rim ring, slightly proud of the disc surface at the outer edge.
add_ring("rim", 1.98, 0.016, -0.004, M_GOLD)

# Slim engraved-style double ring detail midway.
add_ring("mid_ring", 1.35, 0.006, -0.002, M_GOLD)

# Center medallion.
add_cylinder("medallion", 0.16, 0.012, -0.002, M_GOLD, bevel=0.004, segs=64)

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
print("PODIUM_OK", out)
