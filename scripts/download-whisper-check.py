"""Fetch the official tiny English ASR checkpoint for offline word checks."""
from pathlib import Path
from urllib.request import urlopen
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1]
name=sys.argv[1] if len(sys.argv)>1 else 'tiny.en'
digest={'tiny.en':'d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03','base.en':'25a8566e1d0c1e2231d1c762132cd20e0f96a85d16145c3a00adf5d1ac670ead'}[name]
url=f'https://openaipublic.azureedge.net/main/whisper/models/{digest}/{name}.pt'
target=ROOT/'tools/whisper-models'/(name+'.pt');target.parent.mkdir(parents=True,exist_ok=True)
def sha(path):
 with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
if not target.exists() or sha(target)!=digest:
 part=target.with_suffix('.part')
 with urlopen(url,timeout=120) as response,part.open('wb') as output:
  while block:=response.read(1024*1024):output.write(block)
 assert sha(part)==digest,'Official checkpoint checksum mismatch'
 part.replace(target)
(target.with_suffix('.provenance.json')).write_text(json.dumps({'source':url,'source_code':'https://github.com/openai/whisper/blob/main/whisper/__init__.py','sha256':digest,'license':'MIT','purpose':'Local content and timing verification; no emotional quality claim'},indent=2)+'\n')
print('Verified',name,'checkpoint',target.stat().st_size,'bytes',flush=True)
