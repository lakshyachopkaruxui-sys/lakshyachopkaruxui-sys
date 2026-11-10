"""Export the CC0 Kelgar doe with Blender's own baked constraint evaluation.

Run Blender with --disable-autoexec. The source .blend stays unchanged. This
script rebuilds legacy Blender Internal materials for glTF, retains the native
UVs and weights, and exports only the deer plus four documented source actions.
"""
from pathlib import Path
import bpy, json

output = Path('public/models/realistic-deer')
output.mkdir(parents=True, exist_ok=True)
keep = {'Idle.001': 'Idle', 'LookAround.001': 'LookAround', 'Run': 'Run', 'Eat.001': 'Eat'}
actions = [(bpy.data.actions[name], label) for name, label in keep.items()]
for action in list(bpy.data.actions):
    if action not in [a for a, _ in actions]:
        bpy.data.actions.remove(action)
for action, label in actions:
    action.name = label
    action.use_fake_user = True
    for curve in list(action.fcurves):
        if 'IK-Fronleg_L' in curve.data_path:
            action.fcurves.remove(curve)
armature = bpy.data.objects['Armature']
armature.animation_data_create()
armature.animation_data.action = actions[0][0]
for track in list(armature.animation_data.nla_tracks):
    armature.animation_data.nla_tracks.remove(track)
bpy.context.scene.frame_set(0)

for name, image_name in [('body', 'doe-body'), ('head', 'doe-head'), ('Eye', 'doe-head')]:
    material = bpy.data.materials[name]
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value = .35 if name == 'Eye' else .92
    shader.inputs['Metallic'].default_value = 0
    image = nodes.new('ShaderNodeTexImage')
    image.image = bpy.data.images[image_name]
    material.node_tree.links.new(image.outputs['Color'], shader.inputs['Base Color'])
    material.node_tree.links.new(shader.outputs['BSDF'], out.inputs['Surface'])

if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)
for name in ['Armature', 'Body', 'Head', 'Eyes']:
    obj = bpy.data.objects[name]
    obj.hide_set(False)
    obj.select_set(True)
    if obj.type == 'MESH':
        obj.name = 'Doe' + name
        obj.data.validate(clean_customdata=False)
        for poly in obj.data.polygons:
            poly.use_smooth = True
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(filepath=str(output / 'doe.glb'), export_format='GLB',
    use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_range=False, export_def_bones=True,
    export_image_format='JPEG', export_jpeg_quality=92, export_extras=False)
print('EXPORTED_CC0_DOE', json.dumps({'actions': [label for _,label in actions], 'path': str(output / 'doe.glb')}))
