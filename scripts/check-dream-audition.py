"""Check generated words and approximate timings locally; acting needs a listener."""
from pathlib import Path
import os,json,hashlib,time,sys
ROOT=Path(__file__).resolve().parents[1]
os.environ['NUMBA_CACHE_DIR']=str(ROOT/'tools/qwen-cache/numba')
os.environ['TORCH_HOME']=str(ROOT/'tools/qwen-cache/torch')
runtime=ROOT/'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll=os.add_dll_directory(str(runtime)) if os.name=='nt' and runtime.exists() else None
import numpy as np
import soundfile as sf
import torch,whisper
import librosa
torch.set_num_threads(2)
model_name='base.en' if '--base' in sys.argv else 'tiny.en'
if '--wait' in sys.argv:
 while not (ROOT/'tools/whisper-models'/(model_name+'.pt')).exists():time.sleep(3)
model=whisper.load_model(model_name,download_root=str(ROOT/'tools/whisper-models'),device='cpu')
folder=ROOT/'validation/dream-voice-2026-11-10'
names=[arg for arg in sys.argv[1:] if not arg.startswith('--')]
targets=[folder/(name+'.wav') for name in names] if names else ([folder/(name+'.wav') for name in ['shadow-recognition','shadow-whisper','opening-dream','ocean-dream','forest-dream','return-dream']] if '--wait' in sys.argv else list(folder.glob('*.wav')))
for target in targets:
 if '--wait' in sys.argv:
  while not target.exists() or not target.with_suffix('.json').exists():time.sleep(3)
 suffix='-transcription-base.json' if model_name=='base.en' else '-transcription.json'
 destination=folder/(target.stem+suffix)
 digest=hashlib.sha256(target.read_bytes()).hexdigest()
 if destination.exists():
  cached=json.loads(destination.read_text())
  if cached.get('sha256')==digest and cached.get('model')==f'Whisper {model_name}; local CPU':
   print(target.name,'cached transcription',repr(cached['asr_text']),flush=True);continue
 wave,rate=sf.read(target,dtype='float32')
 if wave.ndim==2:wave=wave.mean(axis=1)
 audio=librosa.resample(wave,orig_sr=rate,target_sr=16000)
 result=model.transcribe(audio,language='en',fp16=False,temperature=0,word_timestamps=True,condition_on_previous_text=False)
 report={'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'asr_text':result['text'],'segments':result['segments'],'model':f'Whisper {model_name}; local CPU','limitation':'ASR can misrecognize whispers. This checks content/timing, not fear, acting quality or listening acceptance.'}
 destination.write_text(json.dumps(report,indent=2)+'\n')
 print(target.name,repr(result['text']),flush=True)
