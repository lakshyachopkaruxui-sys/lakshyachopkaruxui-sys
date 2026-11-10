"""Download a pinned public speech model into project-local authoring tools."""
from pathlib import Path
from urllib.request import Request,urlopen
import json,hashlib,time,concurrent.futures
ROOT=Path(__file__).resolve().parents[1]
REPO='Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice'
TARGET=ROOT/'tools/qwen-models/custom-voice'
TARGET.mkdir(parents=True,exist_ok=True)
def read_json(url):
 with urlopen(Request(url,headers={'User-Agent':'Tear-local-narration-authoring/1'}),timeout=60) as response:return json.load(response)
metadata=TARGET/'download-metadata.json'
info=json.loads(metadata.read_text()) if metadata.exists() else read_json('https://huggingface.co/api/models/'+REPO+'?blobs=true')
metadata.write_text(json.dumps(info,indent=2)+'\n')
revision=info['sha'];print('Pinned',REPO,revision,flush=True)
files=info['siblings']
def ranged_download(url,partial,size):
 offset=partial.stat().st_size if partial.exists() else 0
 step=32*1024*1024
 ranges=[(start,min(start+step,size)-1) for start in range(offset,size,step)]
 def chunk(pair):
  start,end=pair;path=partial.with_name(partial.name+f'.range-{start}-{end}')
  if path.exists() and path.stat().st_size==end-start+1:return path
  for attempt in range(3):
   try:
    request=Request(url,headers={'User-Agent':'Tear-local-narration-authoring/1','Range':f'bytes={start}-{end}'})
    with urlopen(request,timeout=120) as response:
     if response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/'):raise RuntimeError('Server did not honor the bounded byte range')
     with path.open('wb') as output:
      while block:=response.read(4*1024*1024):output.write(block)
    if path.stat().st_size!=end-start+1:raise RuntimeError('Incomplete byte range')
    print(partial.name,'range complete',start,end,flush=True);return path
   except Exception:
    if attempt==2:raise
  return path
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:parts=list(pool.map(chunk,ranges))
 with partial.open('ab') as output:
  for path in parts:
   with path.open('rb') as source:
    while block:=source.read(4*1024*1024):output.write(block)
 if partial.stat().st_size!=size:raise RuntimeError('Assembled model length mismatch')
 for path in parts:path.unlink()
def download(item):
 name=item['rfilename']
 if name.startswith('.') or '..' in Path(name).parts:return
 target=TARGET/name;target.parent.mkdir(parents=True,exist_ok=True)
 expected=item.get('lfs',{}).get('sha256');size=item.get('size',item.get('lfs',{}).get('size'))
 def valid():
  if not target.exists() or (size and target.stat().st_size!=size):return False
  if not expected:return True
  with target.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()==expected
 if valid():print('Cached',name,flush=True);return
 partial=target.with_name(target.name+'.part')
 for attempt in range(3):
  try:
   offset=partial.stat().st_size if partial.exists() else 0
   headers={'User-Agent':'Tear-local-narration-authoring/1'}
   if offset:headers['Range']=f'bytes={offset}-'
   url=f'https://huggingface.co/{REPO}/resolve/{revision}/{name}'
   if size and size>64*1024*1024:ranged_download(url,partial,size)
   else:
    with urlopen(Request(url,headers=headers),timeout=120) as response:
     append=offset>0 and response.status==206
     if not append:offset=0
     with partial.open('ab' if append else 'wb') as output:
      while block:=response.read(4*1024*1024):output.write(block)
   if size and partial.stat().st_size!=size:raise RuntimeError(f'Incomplete {name}: {partial.stat().st_size}/{size}')
   partial.replace(target)
   if not valid():raise RuntimeError(f'Checksum mismatch: {name}')
   print('Saved',name,target.stat().st_size,flush=True);return
  except Exception as error:
   print('Retry',name,attempt+1,type(error).__name__,str(error),flush=True)
   if attempt==2:raise
 with target.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(download,files))
(TARGET/'download-provenance.json').write_text(json.dumps({'repo':REPO,'revision':revision,'license':info.get('cardData',{}).get('license'),'files':files},indent=2)+'\n')
print('Model download complete',flush=True)
