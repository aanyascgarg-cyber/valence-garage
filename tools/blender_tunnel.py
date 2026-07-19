"""Valence Garage: wind-tunnel test chamber, modeled and lit in Blender.

Camera sits inside the test section looking downstream: octagonal
structural ribs recede in perspective with gold edge lighting, and a
honeycomb flow straightener glows faintly at the far end. Rendered as
the Lab's backdrop plate so the real car sits INSIDE a real chamber.

Run:  blender -b -P blender_tunnel.py -- <out.png>
"""
import bpy
import math
import sys

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


M_WALL = mat("wall", (0.015, 0.02, 0.024), 0.6, 0.55)
M_RIB = mat("rib", (0.03, 0.036, 0.042), 0.85, 0.35)
M_GOLD = mat("gold", (0.75, 0.57, 0.22), 1.0, 0.2,
             emissive=(0.75, 0.57, 0.22), strength=1.2)
M_TEAL = mat("teal", (0.17, 0.59, 0.67), 0.0, 0.4,
             emissive=(0.17, 0.59, 0.67), strength=0.8)

R = 3.2          # tunnel radius
LEN = 26.0       # tunnel length


def ring(z, material=M_RIB, gold_stripe=True):
    # Octagonal structural rib: a torus with 8 major segments reads as a
    # faceted frame and, critically, has an OPEN bore (capped cylinders
    # plug the tunnel and render as black walls).
    bpy.ops.mesh.primitive_torus_add(major_radius=R + 0.08,
                                     minor_radius=0.2,
                                     major_segments=8, minor_segments=12,
                                     location=(0, z, 0),
                                     rotation=(math.pi / 2, 0, math.pi / 8))
    rib = bpy.context.active_object
    rib.data.materials.append(material)
    if gold_stripe:
        bpy.ops.mesh.primitive_torus_add(major_radius=R + 0.02,
                                         minor_radius=0.03,
                                         major_segments=64, minor_segments=8,
                                         location=(0, z, 0),
                                         rotation=(math.pi / 2, 0, 0))
        stripe = bpy.context.active_object
        stripe.data.materials.append(M_GOLD)


# Tunnel shell: an OPEN tube (no end caps), normals facing inward matter
# less than the bore staying clear.
bpy.ops.mesh.primitive_cylinder_add(radius=R + 0.9, depth=LEN, vertices=8,
                                    end_fill_type='NOTHING',
                                    location=(0, LEN * 0.32, 0),
                                    rotation=(math.pi / 2, 0, math.pi / 8))
shell = bpy.context.active_object
shell.data.materials.append(M_WALL)

# Ribs receding downstream.
for i in range(9):
    ring(1.5 + i * 2.6, gold_stripe=(i % 2 == 0))

# Honeycomb flow straightener at the far end.
hex_r = 0.34
far = LEN * 0.78
rows = 9
for row in range(-rows // 2, rows // 2 + 1):
    for col in range(-rows // 2, rows // 2 + 1):
        x = col * hex_r * 1.78 + (row % 2) * hex_r * 0.89
        zz = row * hex_r * 1.54
        if math.hypot(x, zz) > R - 0.25:
            continue
        bpy.ops.mesh.primitive_cylinder_add(radius=hex_r, depth=0.5,
                                            vertices=6,
                                            location=(x, far, zz),
                                            rotation=(math.pi / 2, 0, 0))
        h = bpy.context.active_object
        h.data.materials.append(M_TEAL)

# Floor walkway strip with gold guides.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, LEN * 0.3, -R + 0.05))
floor = bpy.context.active_object
floor.scale = (2.4, LEN * 0.5, 0.05)
floor.data.materials.append(M_RIB)
for s in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(s * 2.2, LEN * 0.3, -R + 0.09))
    g = bpy.context.active_object
    g.scale = (0.03, LEN * 0.5, 0.012)
    g.data.materials.append(M_GOLD)

# Lights: cool interior wash + far glow.
def area(name, loc, rot, energy, color, size=6.0):
    L = bpy.data.lights.new(name, 'AREA')
    L.energy = energy
    L.color = color
    L.size = size
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.collection.objects.link(ob)


area("wash", (0, 3, 2.6), (0.5, 0, 0), 4500, (0.75, 0.9, 1.0))
area("wash2", (0, 10, 2.6), (0.5, 0, 0), 4500, (0.75, 0.9, 1.0))
area("wash3", (0, 16, 2.6), (0.5, 0, 0), 4000, (0.8, 0.9, 1.0))
# Area lights emit along local -Z; -pi/2 about X faces it UPSTREAM at us.
area("far", (0, far - 1.5, 0), (-math.pi / 2, 0, 0), 9000, (0.35, 0.8, 0.9))

# Camera dead on the bore axis, looking straight downstream.
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 21
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0, -2.2, 0)
cam.rotation_euler = (math.pi / 2, 0, 0)
bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.002, 0.004, 0.005, 1)

out = sys.argv[sys.argv.index("--") + 1]
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("TUNNEL_OK", out)
