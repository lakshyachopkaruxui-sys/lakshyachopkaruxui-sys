"""Assemble five selected review takes without adding effects or music."""
from pathlib import Path
import os,json,hashlib,re
ROOT=Path(__file__).resolve().parents[1]
runtime=ROOT/'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll=os.add_dll_directory(str(runtime)) if os.name=='nt' and runtime.exists() else None
import soundfile as sf
import numpy as np
folder=ROOT/'validation/dream-voice-2026-11-10'
cue_ids=['opening','ocean','shadow','forest','return']
prepared=json.loads((folder/'release-manifest.json').read_text())
order=[prepared['clips'][cue]['source'].removesuffix('.wav') for cue in cue_ids]
pieces=[np.zeros(12000)];rate=24000;cursor=.5;chapters=[];issues=[]
def words(text):return re.findall(r"[a-z]+(?:'[a-z]+)?",text.lower().replace('\u2019',"'"))
for cue,name in zip(cue_ids,order):
 target=folder/(name+'.wav');metadata=json.loads(target.with_suffix('.json').read_text())
 audio,sr=sf.read(folder/'release/review-wav'/(cue+'.wav'),dtype='float32')
 assert sr==rate and audio.ndim==1 and np.isfinite(audio).all()
 assert hashlib.sha256(target.read_bytes()).hexdigest()==metadata['sha256']
 assert np.max(np.abs(audio))<.9 and np.sqrt(np.mean(audio*audio))>.001
 preferred=folder/(name+'-transcription-base.json')
 transcription=json.loads((preferred if preferred.exists() else folder/(name+'-transcription.json')).read_text())
 match=words(metadata['text'])==words(transcription['asr_text'])
 if not match:issues.append({'file':name,'expected':metadata['text'],'asr':transcription['asr_text'],'note':'ASR discrepancy needs review; not proof of incorrect speech'})
 segments=[{**segment,'start':cursor+segment['start'],'end':cursor+segment['end']} for segment in prepared['clips'][cue]['segments']]
 chapters.append({'id':name,'start':cursor,'end':cursor+len(audio)/rate,'text':metadata['text'],'segments':segments,'asr_word_match':match})
 pieces.extend([audio,np.zeros(int(2.5*rate))]);cursor+=len(audio)/rate+2.5
output=folder/'full-dream-preview.wav';sf.write(output,np.concatenate(pieces),rate,subtype='PCM_16')
report={'file':output.name,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'seconds':cursor,'channels':1,'sample_rate':rate,'execution':'All component takes generated locally with Qwen3-TTS; no cloud inference','effects':'No echo, reverb, music, voice doubling or separate breath noise. Linear scene level matching, reveal pauses edited only in quiet gaps, and 2.5-second chapter gaps.','chapters':chapters,'content_review':issues,'listening_approval':prepared['listening_approval'],'voice_direction':prepared.get('voice_direction'),'deployed':False}
(folder/'full-preview-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
