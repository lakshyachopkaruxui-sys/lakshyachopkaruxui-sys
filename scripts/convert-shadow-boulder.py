"""Join imported glTF UV seam vertices before decimating the CC0 boulder scan."""
import bpy,bmesh,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'public/models/shadow/boulder_01/boulder_01_1k.gltf'),merge_vertices=True)
report=[]
for obj in bpy.context.scene.objects:
    if obj.type!='MESH':continue
    bpy.context.view_layer.objects.active=obj
    before={'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons)}
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    joined={'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons)}
    if obj.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
    modifier=obj.modifiers.new('WebXR mesh budget','DECIMATE');modifier.ratio=.35
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:polygon.use_smooth=True
    obj.data.update();obj.data.calc_loop_triangles()
    report.append({'name':obj.name,'imported':before,'welded':joined,'runtime_triangles':len(obj.data.loop_triangles),'runtime_vertices':len(obj.data.vertices)})
bpy.ops.export_scene.gltf(filepath=str(root/'public/models/shadow/boulder_01/boulder-webxr.glb'),export_format='GLB',export_image_format='JPEG',export_jpeg_quality=94)
(root/'validation/horror-rebuild/boulder-conversion.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
