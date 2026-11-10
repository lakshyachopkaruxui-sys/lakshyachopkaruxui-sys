"""Offline scene inspection; not a WebGL/headset renderer or performance test."""
from pathlib import Path
import json,time
from urllib.parse import unquote
import numpy as np
from PIL import Image,ImageDraw
folder=Path('validation/hell-redesign-2026-10-18/scene-inspection');scene=json.loads((folder/'scene.json').read_text())
W,H=1100,760; eye=np.array([.8,1.65,.8]); target=np.array([1.,4.,-30.])
forward=target-eye;forward/=np.linalg.norm(forward);right=np.cross(forward,np.array([0.,1.,0.]));right/=np.linalg.norm(right);up=np.cross(right,forward)
f=H/(2*np.tan(np.deg2rad(65)/2));buffer=np.ones((H,W,3),np.float32)*np.array([.07,.009,.008],np.float32);depth=np.full((H,W),np.inf,np.float32)
cache={}
def sample(tex,uv):
 if not tex:return np.ones((*uv.shape[:-1],4))
 path=unquote(tex['path'])
 if path not in cache:
  if tex.get('raw'):
   typ=tex['type'];a=np.fromfile(path,np.uint16 if typ=='Uint16Array' else np.float32 if typ=='Float32Array' else np.uint8)
   if typ=='Uint16Array':a=a.view(np.float16).astype(np.float32)
   elif typ=='Uint8Array':a=a.astype(np.float32)/255
   a=a.reshape(tex['height'],tex['width'],4)
  else:
   a=np.asarray(Image.open(path).convert('RGBA'),np.float32)/255;a[...,:3]**=2.2
  cache[path]=a
 a=cache[path];q=uv*np.array(tex.get('repeat',[1,1]))+np.array(tex.get('offset',[0,0]));q=np.clip(q,0,1) if tex.get('clamp') else q%1
 if tex.get('flipY'):q[...,1]=1-q[...,1]
 # Bilinear filtering avoids the misleading nearest-neighbour speckle of the
 # earlier diagnostic. This still does not reproduce WebGL anisotropic mipmaps.
 xy=q*np.array([a.shape[1],a.shape[0]])-.5;ij=np.floor(xy).astype(int);f=xy-ij
 if tex.get('clamp'):
  x0=np.clip(ij[...,0],0,a.shape[1]-1);y0=np.clip(ij[...,1],0,a.shape[0]-1);x1=np.clip(ij[...,0]+1,0,a.shape[1]-1);y1=np.clip(ij[...,1]+1,0,a.shape[0]-1)
 else:x0=ij[...,0]%a.shape[1];y0=ij[...,1]%a.shape[0];x1=(x0+1)%a.shape[1];y1=(y0+1)%a.shape[0]
 fx=f[...,0,None];fy=f[...,1,None]
 return (a[y0,x0]*(1-fx)+a[y0,x1]*fx)*(1-fy)+(a[y1,x0]*(1-fx)+a[y1,x1]*fx)*fy
def smooth(a,b,v):
 t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
def noise(p):
 i=np.floor(p);v=p-i;v=v*v*(3-2*v)
 def h(d):return (np.sin((i+d)@np.array([127.1,311.7]))*43758.5453)%1
 return (h([0,0])*(1-v[...,0])+h([1,0])*v[...,0])*(1-v[...,1])+(h([0,1])*(1-v[...,0])+h([1,1])*v[...,0])*v[...,1]
sun=np.array([-20.,28.,18.]);sun/=np.linalg.norm(sun)
lighting=scene.get('lighting',{'hemisphere':.65,'sun':1.65,'environment':.48,'fog':[.19,.227,.156]})
fill=.42*lighting['hemisphere']/.65+.13*lighting['environment']/.48
sunlight=.75*lighting['sun']/1.65
count=0;t0=time.time()
for objectIndex,o in enumerate(scene['objects']):
 pos=np.fromfile(folder/o['positions'],'<f4').reshape(-1,3);idx=np.fromfile(folder/o['indices'],'<u4').reshape(-1,3)
 uv=np.fromfile(folder/o['uv'],'<f4').reshape(-1,2) if o['uv'] else np.zeros((len(pos),2))
 vc=np.fromfile(folder/o['colors'],'<f4').reshape(-1,3) if o.get('colors') else None
 vn=np.fromfile(folder/o['normals'],'<f4').reshape(-1,3) if o.get('normals') else None
 mat=scene['materials'][o['material']];sky='distant pine canopy' in o['name'];layered=mat['layered']
 for instance,transform in enumerate(o['transforms']):
  m=np.array(transform).reshape(4,4).T;world=pos@m[:3,:3].T+m[:3,3];relative=world-eye
  fade=mat.get('detailFade');detailOpacity=1.
  if fade:
   d=np.linalg.norm(m[[0,2],3]-np.array(fade['viewer'])[[0,2]])
   detailOpacity=1-float(smooth(*fade['range'],d))
   if detailOpacity<=0:continue
  z=relative@forward;screen=np.stack([W/2+(relative@right)*f/np.maximum(z,.01),H/2-(relative@up)*f/np.maximum(z,.01)],axis=-1)
  if np.all(z<.1):continue
  points=screen[idx];zs=z[idx];lo=np.floor(points.min(axis=1)).astype(int);hi=np.ceil(points.max(axis=1)).astype(int)
  valid=(zs.min(axis=1)>.1)&(lo[:,0]<W)&(hi[:,0]>=0)&(lo[:,1]<H)&(hi[:,1]>=0)
  lo=np.maximum(lo,[0,0]);hi=np.minimum(hi,[W-1,H-1]); triWorld=world[idx]
  normals=np.cross(triWorld[:,1]-triWorld[:,0],triWorld[:,2]-triWorld[:,0]);normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-8)
  leafNormals=vn@np.linalg.inv(m[:3,:3]) if vn is not None else None
  if leafNormals is not None:leafNormals/=np.maximum(np.linalg.norm(leafNormals,axis=1,keepdims=True),1e-8)
  for k in np.flatnonzero(valid):
   x0,y0=lo[k];x1,y1=hi[k];p=points[k];area=(p[1,1]-p[2,1])*(p[0,0]-p[2,0])+(p[2,0]-p[1,0])*(p[0,1]-p[2,1])
   if abs(area)<.15:continue
   yy,xx=np.mgrid[y0:y1+1,x0:x1+1];xx=xx+.5;yy=yy+.5
   a=((p[1,1]-p[2,1])*(xx-p[2,0])+(p[2,0]-p[1,0])*(yy-p[2,1]))/area
   b=((p[2,1]-p[0,1])*(xx-p[2,0])+(p[0,0]-p[2,0])*(yy-p[2,1]))/area;c=1-a-b
   invz=a/zs[k,0]+b/zs[k,1]+c/zs[k,2];d=1/np.maximum(invz,1e-9)
   mask=(a>=0)&(b>=0)&(c>=0)&(d<depth[y0:y1+1,x0:x1+1])
   if not mask.any():continue
   weights=np.stack([a/zs[k,0],b/zs[k,1],c/zs[k,2]],-1)*d[...,None]
   texuv=weights@uv[idx[k]];color=sample(mat['map'],texuv);alpha=color[...,3]*mat['opacity']
   if mat['alphaMap']:alpha*=sample(mat['alphaMap'],texuv)[...,1]**(1/2.2)
   mask&=(alpha>=max(.001,mat['alphaTest']))
   if detailOpacity<1:
    point=weights@world[idx[k]]
    threshold=(np.sin(np.floor(point*350)@np.array([12.9898,78.233,37.719]))*43758.5453)%1
    mask&=(threshold<detailOpacity)
   if not mask.any():continue
   rgb=color[...,:3]*np.array(mat['color'])
   if mat.get('tawnyFur'):
    light=rgb@np.array([.2126,.7152,.0722]);chroma=np.max(rgb,axis=-1)-np.min(rgb,axis=-1)
    weight=smooth(.025,.20,chroma)*.62
    rgb=rgb*(1-weight[...,None])+light[...,None]*np.array([1.23,.98,.76])*weight[...,None]
   if mat.get('vertexColors') and vc is not None:rgb*=weights@vc[idx[k]]
   if o.get('instanceColors'):rgb*=np.array(o['instanceColors'][instance*3:instance*3+3])
   if mat.get('bladeSurface'):
    rib=1-smooth(0,.22,np.abs(texuv[...,0]-.5))
    fibre=.96+.04*np.sin(texuv[...,0]*75+texuv[...,1]*5)
    rgb*=((.78+.30*rib)*fibre)[...,None]
   if layered:
    local=weights@pos[idx[k]];xz=local[...,[0,2]]
    context=sample(scene['layers']['forestCanopy'],(xz/112+.5)*(255/256)+.5/256);mix=context[...,1,None]
    if mat.get('sampleSoil'):
     config=mat['sampleSoil'];bounds=config['bounds'];x=xz[...,0];z=xz[...,1]
     edge=np.minimum.reduce([x-bounds['minX'],bounds['maxX']-x,z-bounds['minZ'],bounds['maxZ']-z]);weight=smooth(0,.45,edge)
     colony=np.maximum.reduce([1-smooth(p['radius']*.35,p['radius'],np.hypot(x-p['x'],z-p['z'])) for p in config['colonies']])
     variation=.5+.25*np.sin(x*3.3+np.sin(z*1.7))+.25*np.cos(z*3.9-x*1.1)
     soil=np.clip(.78-.30*colony+.12*(variation-.5),.42,.84)[...,None]
     mix=mix+(np.maximum(mix,soil)-mix)*weight[...,None]
    soilColor=sample(scene['layers']['forestSoilColor'],xz/3.2)[...,:3]
    if mat.get('forestLitter'):
     growth=.5+.25*np.sin(xz[...,0]*.53+np.sin(xz[...,1]*.31))+.25*np.cos(xz[...,1]*.61-xz[...,0]*.23)
     cover=1-weight
     woodland=(.60-.22*smooth(.22,.78,growth)+context[...,2]*.14)[...,None]
     mix=mix+(woodland-mix)*cover[...,None]
     soilColor=soilColor*(1-cover[...,None])+sample(mat['forestLitter'][0],xz/1.5)[...,:3]*np.array([.82,.72,.56])*cover[...,None]
    if mat.get('sampleLitter'):
     soilColor=soilColor*(1-weight[...,None])+sample(mat['sampleLitter'][0],xz/1.5)[...,:3]*np.array([.82,.72,.56])*weight[...,None]
    rgb=rgb*np.array([.62,.66,.50])*(1-mix)+soilColor*np.array([.70,.68,.60])*mix
    rgb*=(context[...,0]*(1-context[...,2]*.16))[...,None]
   if not mat.get('basic',False):
    if leafNormals is not None:
     n=weights@leafNormals[idx[k]];n/=np.maximum(np.linalg.norm(n,axis=-1,keepdims=True),1e-8)
     rgb*=(fill+sunlight*np.maximum(0,n@sun))[...,None]
    else:rgb*=fill+sunlight*max(.0,float(normals[k]@sun))
   if mat.get('emissiveMap'):rgb+=sample(mat['emissiveMap'],texuv)[...,:3]*np.array(mat['emissive'])*mat['emissiveIntensity']
   if not sky:
    fog=1-np.exp(-(.012*d)**2);rgb=rgb*(1-fog[...,None])+np.array(lighting['fog'])*fog[...,None]
   view=buffer[y0:y1+1,x0:x1+1]
   if mat['transparent']:view[mask]=(rgb*alpha[...,None]+view*(1-alpha[...,None]))[mask]
   else:view[mask]=rgb[mask];depth[y0:y1+1,x0:x1+1][mask]=d[mask]
   count+=1
 if objectIndex%25==0:print('objects',objectIndex,'triangles',count,'seconds',round(time.time()-t0),flush=True)
x=buffer*1.05;rgb=np.clip((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0,1)**(1/2.2)
im=Image.fromarray((rgb*255).astype('uint8'));draw=ImageDraw.Draw(im);draw.rectangle((0,H-30,W,H),fill=(20,27,23));draw.text((12,H-23),'OFFLINE COMPOSITION CHECK - approximate lighting; sky, planets, sparks excluded; not browser capture',fill=(230,235,227));im.save(folder/'hell-composition.jpg',quality=94)
print('done',count,round(time.time()-t0),flush=True)

