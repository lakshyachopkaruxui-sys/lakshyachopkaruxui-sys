import bpy
import json
import sys

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
print('CONIFER_INVENTORY ' + json.dumps({
    'objects': [{'name': o.name, 'type': o.type,
        'vertices': len(o.data.vertices) if o.type == 'MESH' else None,
        'faces': len(o.data.polygons) if o.type == 'MESH' else None,
        'collections': [c.name for c in o.users_collection],
        'modifiers': [(m.name, m.type) for m in o.modifiers],
        'hidden': o.hide_viewport, 'render_hidden': o.hide_render,
        'dimensions': list(o.dimensions)} for o in bpy.data.objects],
    'images': [(i.name, i.filepath) for i in bpy.data.images]
}))
