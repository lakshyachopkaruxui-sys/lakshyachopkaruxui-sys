"""Activate the user-selected B narration without touching any world visuals."""
from pathlib import Path
import json,hashlib,shutil,os
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'validation/dream-voice-2026-11-10'
release=folder/'release';source=release/'public/audio/narration/dream-v1'
destination=ROOT/'public/audio/narration/dream-v1'
backup=folder/'before-activation'
assert destination.resolve().is_relative_to((ROOT/'public/audio/narration').resolve())
manifest=json.loads((source/'manifest.json').read_text())
assert manifest['clips']['shadow']['source']=='shadow-stifled-v2.wav'
assert set(manifest['clips'])=={'opening','ocean','shadow','forest','return'}
for cue,clip in manifest['clips'].items():
 assert hashlib.sha256((source/(cue+'.ogg')).read_bytes()).hexdigest()==clip['sha256']
destination.mkdir(parents=True,exist_ok=True)
for name in ['opening.ogg','ocean.ogg','shadow.ogg','forest.ogg','return.ogg','manifest.json','provenance.json']:
 shutil.copy2(source/name,destination/name)
for name in ['manifest.json','provenance.json']:
 p=destination/name;record=json.loads(p.read_text());record['deployed']=True
 record['activation_authorization']='User selected B and explicitly requested application to the dream narration'
 p.write_text(json.dumps(record,indent=2)+'\n')
# Keep source-model licensing with the new audio's provenance.
shutil.copy2(ROOT/'public/audio/narration/MODEL-LICENSE.txt',destination/'MODEL-LICENSE.txt')
script=ROOT/'src/audio/narrationScript.ts'
assert (backup/'narrationScript.ts').exists(),'Create a source backup before activation'
temporary=script.with_name('narrationScript.next')
temporary.write_bytes((release/'narrationScript.ts').read_bytes());temporary.replace(script)
# The superseded recordings remain recoverable inside Tear, outside its build.
old=ROOT/'public/audio/narration/story-v2';archive=backup/'story-v2';archive.mkdir(exist_ok=True)
assert old.resolve().is_relative_to((ROOT/'public/audio/narration').resolve())
if old.exists():
 for path in old.iterdir():
  assert path.is_file() and path.suffix in {'.ogg','.json'},f'Unexpected old narration asset: {path.name}'
  target=archive/path.name
  if target.exists():assert target.read_bytes()==path.read_bytes(),'Existing archive differs'
  else:shutil.copy2(path,target)
  assert target.read_bytes()==path.read_bytes()
  path.unlink()
 old.rmdir()
os.utime(ROOT/'vite.config.js',None)
print('Activated selected B dream narration; old voice assets archived inside Tear.',flush=True)
