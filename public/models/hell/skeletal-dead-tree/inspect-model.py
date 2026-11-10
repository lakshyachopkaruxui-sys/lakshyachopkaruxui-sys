from pathlib import Path
import io,json,struct
import numpy as np
from PIL import Image,ImageDraw

root=Path(__file__).parent
raw=(root/'dead-tree.glb').read_bytes()
json_length=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+json_length])
binary=raw[28+json_length:]
p=doc['meshes'][0]['primitives'][0]
a=doc['accessors'][p['attributes']['POSITION']]; view=doc['bufferViews'][a['bufferView']]
positions=np.ndarray((a['count'],3),dtype='<f4',buffer=binary,offset=view.get('byteOffset',0)+a.get('byteOffset',0),strides=(view.get('byteStride',12),4)).copy()
a=doc['accessors'][p['indices']]; view=doc['bufferViews'][a['bufferView']]
indices=np.frombuffer(binary,dtype='<u2',count=a['count'],offset=view.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,3)
im=Image.new('RGB',(1000,650),'#e4e0da');draw=ImageDraw.Draw(im)
for i,angle in enumerate([35,120]):
    a=np.deg2rad(angle);right=np.array([np.cos(a),0,np.sin(a)]);forward=np.array([-np.sin(a),0,np.cos(a)])
    screen=np.stack([positions@right*125+250+i*500,600-positions[:,1]*145],axis=1)
    depth=positions@forward
    for index in np.argsort(depth[indices].mean(axis=1)):
        tri=indices[index];normal=np.cross(positions[tri[1]]-positions[tri[0]],positions[tri[2]]-positions[tri[0]])
        normal/=max(np.linalg.norm(normal),1e-9)
        shade=int(45+35*max(0,normal@np.array([-.3,.7,.4])))
        draw.polygon([tuple(p) for p in screen[tri]],fill=(shade+8,shade+2,shade-3))
    draw.text((180+i*500,615),'Geometry silhouette',fill='#181512')
im.save(root/'review-shape.png')
print(json.dumps({'triangles':len(indices),'bounds':{'min':positions.min(axis=0).tolist(),'max':positions.max(axis=0).tolist()}}))
for image in doc['images']:
    view=doc['bufferViews'][image['bufferView']]; content=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
    im=Image.open(io.BytesIO(content));print(json.dumps({'name':image.get('name'),'dimensions':im.size}))
