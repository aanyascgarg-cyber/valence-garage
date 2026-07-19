"""Valence Garage: forged turbine hypercar wheel, modeled and lit in Blender.

Built live over the Blender MCP, consolidated here for reproducibility. A
matte tire recedes into shadow, a champagne-gold rim ring glows, ten forged
turbine spokes with gold pinstripes surround a hex center-lock, and a fixed
gold brake caliper hugs a carbon-ceramic disc. Baked to a 32-frame turntable
(the wheel spins on its axle, caliper fixed) → assets/wheel-spin.webp, the
car-viewer loading emblem.

Key lesson baked in: with a near-black (0.008 albedo) tire, lights must stay
LOW or the huge rounded rubber floods to clay-grey. Let the emissive gold and
sharp metal highlights carry the image instead.

Run:  blender -b -P blender_wheel.py -- <frames_dir>
Emits <frames_dir>/f00.png .. f31.png (32 transparent frames, 460x460).
"""
import bpy, math, sys, os, mathutils

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene


def mat(name, color, metallic, rough, emis=None, estr=0.0, spec=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if spec is not None and "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = spec
    if emis:
        b.inputs["Emission Color"].default_value = (*emis, 1.0)
        b.inputs["Emission Strength"].default_value = estr
    return m


M_RUBBER = mat("w_rubber", (0.008, 0.009, 0.010), 0.0, 0.95, spec=0.06)
M_BARREL = mat("w_barrel", (0.012, 0.014, 0.017), 0.9, 0.30)
M_GOLD   = mat("w_gold", (0.83, 0.62, 0.22), 1.0, 0.16, emis=(0.85, 0.64, 0.24), estr=0.9)
M_HUB    = mat("w_hub", (0.05, 0.055, 0.06), 1.0, 0.25)
M_CARBON = mat("w_carbon", (0.015, 0.015, 0.018), 0.2, 0.50)
M_SPOKE  = mat("w_spoke", (0.10, 0.105, 0.115), 1.0, 0.20)

# Wheel faces +Y (camera on +Y); axle is the Y axis.
spin_parts = []


def add(obj, m, spin=True):
    obj.data.materials.append(m)
    if spin:
        spin_parts.append(obj)
    return obj


# Tire + tread
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.24,
    major_segments=64, minor_segments=20, rotation=(math.pi/2, 0, 0))
add(bpy.context.active_object, M_RUBBER)
bpy.ops.mesh.primitive_cylinder_add(radius=1.12, depth=0.30, vertices=64,
    rotation=(math.pi/2, 0, 0), end_fill_type='NOTHING')
add(bpy.context.active_object, M_RUBBER)

# Rim barrel (OPEN front, receded so the spokes show), gold lip, hub, spinner
bpy.ops.mesh.primitive_cylinder_add(radius=0.84, depth=0.40, vertices=64,
    location=(0, -0.12, 0), rotation=(math.pi/2, 0, 0), end_fill_type='NOTHING')
add(bpy.context.active_object, M_BARREL)
bpy.ops.mesh.primitive_torus_add(major_radius=0.85, minor_radius=0.045,
    major_segments=64, minor_segments=12, location=(0, 0.16, 0),
    rotation=(math.pi/2, 0, 0))
add(bpy.context.active_object, M_GOLD)
bpy.ops.mesh.primitive_cylinder_add(radius=0.24, depth=0.22, vertices=48,
    location=(0, 0.14, 0), rotation=(math.pi/2, 0, 0))
add(bpy.context.active_object, M_HUB)
bpy.ops.mesh.primitive_cone_add(radius1=0.12, radius2=0.03, depth=0.14,
    vertices=6, location=(0, 0.26, 0), rotation=(math.pi/2, 0, 0))
add(bpy.context.active_object, M_GOLD)

# Brake disc + hat behind the spokes
bpy.ops.mesh.primitive_cylinder_add(radius=0.70, depth=0.06, vertices=64,
    location=(0, -0.12, 0), rotation=(math.pi/2, 0, 0))
add(bpy.context.active_object, M_CARBON)
bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.12, vertices=48,
    location=(0, -0.06, 0), rotation=(math.pi/2, 0, 0))
add(bpy.context.active_object, M_HUB)

# 10 forged turbine spokes: blade + outer flare + gold pinstripe
N = 10
for i in range(N):
    th = i * (2*math.pi/N)
    bpy.ops.mesh.primitive_cube_add(size=1)
    sp = bpy.context.active_object; sp.scale = (0.10, 0.10, 0.31)
    sp.location = (0.55*math.sin(th), 0.11, 0.55*math.cos(th)); sp.rotation_euler = (0, th, 0)
    add(sp, M_SPOKE)
    bpy.ops.mesh.primitive_cube_add(size=1)
    fl = bpy.context.active_object; fl.scale = (0.135, 0.085, 0.075)
    fl.location = (0.78*math.sin(th), 0.11, 0.78*math.cos(th)); fl.rotation_euler = (0, th, 0)
    add(fl, M_SPOKE)
    bpy.ops.mesh.primitive_cube_add(size=1)
    ps = bpy.context.active_object; ps.scale = (0.014, 0.02, 0.30)
    ps.location = (0.55*math.sin(th), 0.165, 0.55*math.cos(th)); ps.rotation_euler = (0, th, 0)
    add(ps, M_GOLD)

# Lug bolts
for i in range(6):
    a = i*(2*math.pi/6) + 0.2
    bpy.ops.mesh.primitive_cylinder_add(radius=0.028, depth=0.05, vertices=6,
        location=(0.19*math.sin(a), 0.20, 0.19*math.cos(a)), rotation=(math.pi/2, 0, 0))
    add(bpy.context.active_object, M_GOLD)

# Brake caliper — FIXED (does not spin with the wheel)
ca = math.radians(-52)
bpy.ops.mesh.primitive_cube_add(size=1)
cal = bpy.context.active_object; cal.scale = (0.10, 0.16, 0.26)
cal.location = (0.70*math.sin(ca), -0.12, 0.70*math.cos(ca)); cal.rotation_euler = (0, ca, 0)
add(cal, M_GOLD, spin=False)

# Turntable pivot: only the wheel parts spin about the axle.
bpy.ops.object.empty_add(location=(0, 0, 0))
pivot = bpy.context.active_object
for ob in spin_parts:
    ob.parent = pivot

# Lights: LOW energy (see module note), cool key + warm gold rim + faint fill.
def area(name, loc, energy, color, size):
    L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.color = color; L.size = size
    ob = bpy.data.objects.new(name, L); ob.location = loc
    d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scn.collection.objects.link(ob)

area("key", (2.6, 3.6, 3.0), 320, (0.85, 0.92, 1.0), 3.0)
area("rim", (-2.9, 2.0, 0.7), 240, (1.0, 0.76, 0.34), 2.2)
area("fill", (0.0, 3.6, 1.0), 16, (0.9, 0.94, 1.0), 4.5)
area("edge", (-2.4, 1.2, -1.4), 90, (0.8, 0.9, 1.0), 1.0)

# Camera: near head-on so the spin reads as a wheel.
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 58
cam = bpy.data.objects.new("cam", cam_data); cam.location = (0.9, 4.9, 0.85)
d = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cam.location)
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scn.collection.objects.link(cam); scn.camera = cam

world = bpy.data.worlds.new("w"); scn.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.006, 0.008, 1)

scn.render.engine = 'BLENDER_EEVEE'
ev = scn.eevee
for attr, val in (("use_ssr", True), ("use_ssr_refraction", True),
                  ("use_raytracing", True), ("use_bloom", True)):
    if hasattr(ev, attr):
        setattr(ev, attr, val)
if hasattr(ev, "taa_render_samples"):
    ev.taa_render_samples = 48
scn.render.resolution_x = 460
scn.render.resolution_y = 460
scn.render.film_transparent = True
scn.render.image_settings.file_format = 'PNG'
scn.render.image_settings.color_mode = 'RGBA'

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)
FRAMES = 32
for f in range(FRAMES):
    pivot.rotation_euler = (0, 2*math.pi*f/FRAMES, 0)
    scn.render.filepath = os.path.join(out_dir, "f%02d.png" % f)
    bpy.ops.render.render(write_still=True)

print("WHEEL_OK", out_dir)
