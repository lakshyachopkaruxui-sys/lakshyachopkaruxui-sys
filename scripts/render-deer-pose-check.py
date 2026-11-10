import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
folder=Path('validation/forest-quality-2026-10-16/deer-poses');poses=json.loads((folder/'poses.json').read_text());frames=[]
for pose in poses:
 im=Image.new('RGB',(600,460),(221,226,220));draw=ImageDraw.Draw(im)
 draw.rectangle((0,368,600,460),fill=(188,199,177));draw.line((0,368,600,368),fill=(138,155,129),width=1)
 tris=[]
 for part in pose['parts']:
  v=np.fromfile(folder/part['positions'],dtype='<f4').reshape(-1,3);uv=np.fromfile(folder/part['uv'],dtype='<f4').reshape(-1,2);idx=np.fromfile(folder/part['indices'],dtype='<u4').reshape(-1,3)
  tex=np.asarray(Image.open(folder/part['texture']).convert('RGB'))
  t=v[idx];q=uv[idx].mean(axis=1);pixels=tex[np.clip((q[:,1]*tex.shape[0]).astype(int),0,tex.shape[0]-1),np.clip((q[:,0]*tex.shape[1]).astype(int),0,tex.shape[1]-1)]
  normal=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);normal/=np.maximum(1e-9,np.linalg.norm(normal,axis=1,keepdims=True))
  light=np.array([.4,.85,.25]);light/=np.linalg.norm(light)
  lit=(.48+.52*np.maximum(0,normal@light))[:,None]
  color=np.clip(pixels*lit,0,255).astype('uint8')
  screen=np.stack([300+(t[:,:,2]*.94-t[:,:,0]*.34)*225,368-t[:,:,1]*225],axis=-1)
  depth=(t[:,:,0]*.94+t[:,:,2]*.34).mean(axis=1)
  for n in range(len(idx)):tris.append((depth[n],screen[n],tuple(color[n])))
 for _,tri,col in sorted(tris,key=lambda a:a[0]):draw.polygon([tuple(p) for p in tri],fill=col)
 draw.text((16,16),'DEER WALK / runtime bone poses / offline inspection',fill=(35,47,38))
 draw.text((16,424),f'Pose {pose["frame"]+1} / 18 - not a browser or headset capture',fill=(35,47,38))
 frames.append(im)
frames[0].save(folder/'walk.gif',save_all=True,append_images=frames[1:],duration=50,loop=0)
sheet=Image.new('RGB',(1800,920))
for k,i in enumerate([0,3,6,9,12,15]):sheet.paste(frames[i],((k%3)*600,(k//3)*460))
sheet.save(folder/'walk-contact-sheet.jpg',quality=92)
print('Offline walking contact sheet rendered.')
