"""Level-match stronger fear auditions and keep their measured word checks."""
from pathlib import Path
import os,json,hashlib,re
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'validation/dream-voice-2026-11-10'
runtime=ROOT/'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll=os.add_dll_directory(str(runtime)) if os.name=='nt' and runtime.exists() else None
import numpy as np
import soundfile as sf
def words(text):return re.findall(r"[a-z]+(?:'[a-z]+)?",text.lower().replace('\u2019',"'"))
report={'revision':2,'requested':'Stronger fear and breath','deployed':False,'takes':[],'listening_approval':'pending','processing':'One linear level adjustment per take, same RMS target and peak ceiling; no echo, reverb, pitch shift, compression or breath overlay'}
for name in ['shadow-panic-v2','shadow-stifled-v2','shadow-recognition']:
 source=folder/(name+'.wav');metadata=json.loads(source.with_suffix('.json').read_text())
 transcript=json.loads((folder/(name+'-transcription-base.json')).read_text())
 digest=hashlib.sha256(source.read_bytes()).hexdigest();assert digest==metadata['sha256']==transcript['sha256']
 audio,rate=sf.read(source,dtype='float32');assert rate==24000 and audio.ndim==1 and np.isfinite(audio).all()
 peak=float(np.max(np.abs(audio)));rms=float(np.sqrt(np.mean(audio*audio)));gain=min(.09/max(rms,1e-8),.78/max(peak,1e-8))
 audio*=gain;target=folder/(name+'-review.wav');sf.write(target,audio,rate,subtype='PCM_16')
 match=words(metadata['text'])==words(transcript['asr_text'])
 record={'id':name,'file':target.name,'source_sha256':digest,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'seconds':len(audio)/rate,'channels':1,'sample_rate':rate,'linear_gain':gain,'peak':float(np.max(np.abs(audio))),'rms':float(np.sqrt(np.mean(audio*audio))),'text':metadata['text'],'asr':transcript['asr_text'],'word_match':match,'delivery_direction':metadata['direction'],'listening_approval':'pending'}
 report['takes'].append(record)
 print(name,round(record['seconds'],2),'seconds; word match',match,flush=True)
(folder/'fear-v2-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
