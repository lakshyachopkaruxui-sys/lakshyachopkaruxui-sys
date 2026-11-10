"""Blender batch: export the creator's LOD2 foliage, simplify only woody parts."""
import bpy
import bmesh
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/forest/conifers'
OUT.mkdir(parents=True, exist_ok=True)
reports = []


def material(name, folder, asset):
    key = name.removesuffix('.001')
    if 'dead_branch' in key:
        key = asset + '_bark'
    maps = {kind: folder / 'textures' / (key + '_' + kind + '_1k.png') for kind in ['diff', 'nor_gl', 'rough', 'alpha']}
    mat = bpy.data.materials.new(name + '_WebPBR')
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    bsdf = tree.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = .93
    tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    for kind, path in maps.items():
        if not path.exists():
            continue
        image = bpy.data.images.load(str(path), check_existing=True)
        # Original nominal 1K files have long rectangular bark maps. Limit only
        # oversized images, preserving aspect and original UVs.
        if max(image.size) > 2048:
            factor = 2048 / max(image.size)
            image.scale(round(image.size[0] * factor), round(image.size[1] * factor))
        if kind != 'alpha':
            converted = ROOT / 'validation/conifer-sources/jpeg'
            converted.mkdir(parents=True, exist_ok=True)
            image.file_format = 'JPEG'
            image.filepath_raw = str(converted / (path.stem + '.jpg'))
            image.save()
        if kind != 'diff':
            image.colorspace_settings.name = 'Non-Color'
        texture = tree.nodes.new('ShaderNodeTexImage'); texture.image = image
        if kind == 'nor_gl':
            normal = tree.nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = .8
            tree.links.new(texture.outputs['Color'], normal.inputs['Color'])
            tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
        else:
            tree.links.new(texture.outputs['Color'], bsdf.inputs[{'diff': 'Base Color', 'rough': 'Roughness', 'alpha': 'Alpha'}[kind]])
    if maps['alpha'].exists():
        mat.blend_method = 'CLIP'
        mat.alpha_threshold = .43
        mat.use_backface_culling = False
    return mat


def export(asset, suffix):
    folder = ROOT / 'validation/conifer-sources' / asset
    source = folder / (asset + '_1k.blend')
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    candidates = [o for o in bpy.data.objects if o.type == 'MESH' and o.name in
                  {asset + '_' + variant + suffix for variant in 'abc'}]
    if not candidates:
        raise RuntimeError('No authored LOD objects: ' + asset)
    # Heavy source geometry must not be evaluated or included in the web file.
    for obj in list(bpy.data.objects):
        if obj not in candidates:
            bpy.data.objects.remove(obj, do_unlink=True)
    for collection in bpy.data.collections:
        collection.hide_viewport = False; collection.hide_render = False
    exported = bpy.data.collections.new('TEAR_EXPORT')
    bpy.context.scene.collection.children.link(exported)
    for obj in candidates:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        exported.objects.link(obj)
    bpy.context.view_layer.update()
    materials = {}
    for obj in candidates:
        obj.hide_set(False); obj.hide_viewport = False; obj.hide_render = False
        # These published LODs store UVMap as a generic corner-vector attribute.
        # glTF does not export that attribute as TEXCOORD_0 automatically.
        original_uv = obj.data.attributes.get('UVMap')
        if not original_uv or original_uv.domain != 'CORNER':
            raise RuntimeError('Missing original corner UVs: ' + obj.name)
        coordinates = [tuple(item.vector[:2]) for item in original_uv.data]
        original_uv.name = 'OriginalSourceUV'
        uv = obj.data.uv_layers.new(name='UVMap')
        for polygon in obj.data.polygons:
            name = obj.material_slots[polygon.material_index].material.name
            sx, sy = (1.2, .1) if name == asset + '_bark' else (1, 1)
            for loop_index in polygon.loop_indices:
                u, v = coordinates[loop_index]
                uv.data[loop_index].uv = (u * sx, v * sy)
        uv.active_render = True
        # The source kit is arranged for authoring. Ground each tree separately.
        obj.location.x = 0; obj.location.y = 0
        for slot in obj.material_slots:
            original = slot.material.name
            if original not in materials:
                materials[original] = material(original, folder, asset)
            slot.material = materials[original]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in candidates:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = candidates[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in objects:
        obj.data.validate(verbose=False)
        name = obj.material_slots[0].material.name if obj.material_slots else ''
        if 'twig' not in name:
            bpy.context.view_layer.objects.active = obj
            decimate = obj.modifiers.new('Web trunk geometry reduction', 'DECIMATE')
            # Hero trunk scans need enough surface vertices to preserve their
            # photographed UV detail. Distant variant C and branches stay lean.
            decimate.ratio = .50 if 'trunk_a' in name or 'trunk_b' in name else .13
            bpy.ops.object.modifier_apply(modifier=decimate.name)
            obj.data.validate(verbose=False)
        obj.data.calc_loop_triangles()
    path = OUT / (asset + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_animations=False, export_image_format='AUTO', export_yup=True, export_apply=True)
    reports.append({'asset': asset, 'source': 'https://polyhaven.com/a/' + asset,
        'source_blend_md5': hashlib.md5(source.read_bytes()).hexdigest(), 'source_lod': suffix,
        'runtime': path.relative_to(ROOT).as_posix(), 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'triangles': sum(len(o.data.loop_triangles) for o in objects),
        'objects': [{'name': o.name, 'material': o.material_slots[0].material.name,
            'triangles': len(o.data.loop_triangles)} for o in objects]})
    if asset == 'fir_tree_01':
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            if 'twig' not in obj.material_slots[0].material.name:
                obj.select_set(True)
        bare = OUT / 'fir_tree_01_bare.glb'
        bpy.ops.export_scene.gltf(filepath=str(bare), export_format='GLB', use_selection=True,
            export_animations=False, export_image_format='AUTO', export_yup=True, export_apply=True)
        reports.append({'asset': asset, 'source': 'https://polyhaven.com/a/' + asset,
            'runtime': bare.relative_to(ROOT).as_posix(), 'bytes': bare.stat().st_size,
            'sha256': hashlib.sha256(bare.read_bytes()).hexdigest(), 'modification': 'Needle/twig-card material excluded; woody branches retained.'})


export('fir_tree_01', '_LOD2')
# Pine sapling's available LOD names are inspected before selecting them.
report = {'license': 'CC0-1.0', 'license_url': 'https://polyhaven.com/license',
    'authors': ['Rico Cilliers (modeling)', 'Rob Tuytel (photography)'],
    'converter': 'Blender 4.2.0 --background --disable-autoexec',
    'changes': ['Original LOD2 foliage cards retained.', 'Hero A/B trunk scans retain 50% of source geometry; other woody meshes retain 13%.',
        'Original corner-vector UVMap converted to standard UV layer; original bark UV scale baked into coordinates.',
        'Scanned maps retained in direct glTF PBR materials.', 'Texture longest edge limited to 2048px.',
        'Authoring layout offsets removed from individual tree variants.'], 'exports': reports}
(OUT / 'SOURCE-MANIFEST.json').write_text(json.dumps(report, indent=2) + '\n')
print('CONIFER_EXPORT ' + json.dumps(reports))
