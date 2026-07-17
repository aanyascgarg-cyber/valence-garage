"""Headless Blender probe: prove bpy + glTF export work from CLI."""
import bpy, sys

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=0.1)
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
print("PROBE_OK", out)
