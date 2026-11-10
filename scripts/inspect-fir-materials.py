import bpy, json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root / 'validation/conifer-sources/fir_tree_01/fir_tree_01_1k.blend'), load_ui=False)
report = {'materials': [], 'uvs': []}
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    report['materials'].append({'name': mat.name, 'nodes': [{'name': n.name, 'type': n.type,
        'image': n.image.name if n.type == 'TEX_IMAGE' and n.image else None,
        'uv_map': n.uv_map if n.type == 'UVMAP' else None,
        'attribute_name': n.attribute_name if n.type == 'ATTRIBUTE' else None,
        'inputs': {i.name: list(i.default_value) if hasattr(i.default_value, '__len__') else i.default_value for i in n.inputs if not i.is_linked and hasattr(i, 'default_value') and i.name in ['Scale', 'Location', 'Vector']}} for n in mat.node_tree.nodes],
        'links': [(l.from_node.name, l.from_socket.name, l.to_node.name, l.to_socket.name) for l in mat.node_tree.links]})
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.name.endswith('_LOD2'):
        report['uvs'].append({'name': obj.name, 'attributes': [(a.name, a.domain, a.data_type, len(a.data)) for a in obj.data.attributes], 'uvs': [{'name': uv.name, 'active_render': uv.active_render,
          'min': [min(p.uv[i] for p in uv.data) for i in range(2)], 'max': [max(p.uv[i] for p in uv.data) for i in range(2)]} for uv in obj.data.uv_layers]})
(root / 'validation/conifer-sources/material-inspection.json').write_text(json.dumps(report, indent=2))
