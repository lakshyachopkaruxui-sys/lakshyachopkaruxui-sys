"""Prepare reviewable audio/caption candidates; never activate them in the app."""
from pathlib import Path
import os,json,hashlib,re,copy
ROOT=Path(__file__).resolve().parents[1]
runtime=ROOT/'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll=os.add_dll_directory(str(runtime)) if os.name=='nt' and runtime.exists() else None
import numpy as np
import soundfile as sf
folder=ROOT/'validation/dream-voice-2026-11-10'
release=folder/'release';assets=release/'public/audio/narration/dream-v1';assets.mkdir(parents=True,exist_ok=True)
review_wav=release/'review-wav';review_wav.mkdir(parents=True,exist_ok=True)
selection={'opening':'opening-stifled-v3','ocean':'ocean-stifled-v3','shadow':'shadow-stifled-v2','forest':'forest-stifled-v4','return':'return-stifled-v3'}
def words(text):return re.findall(r"[a-z]+(?:'[a-z]+)?",text.lower().replace('\u2019',"'"))
model=json.loads((ROOT/'tools/qwen-models/custom-voice/download-provenance.json').read_text())
report={'model':model['repo'],'revision':model['revision'],'speaker':'Ryan builtin preset','voice_direction':'B — trying not to be heard; stronger fear in Shadow and return','execution':'Local CPU, offline speech synthesis','sample_rate':24000,'channels':1,'pitch_semitones':0,'nonlinear_compression':False,'tail_seconds':.35,'wet_gain':0,'effects':{'echo':0,'reverb':0,'pitch_shift':0,'external_breath_overlay':False,'level_matching':'One linear gain per scene; preserve performed dynamics'},'deployed':False,'listening_approval':'B direction selected by user; activation explicitly authorized','clips':{}}
records=[]
for cue,name in selection.items():
 source=folder/(name+'.wav');record=json.loads(source.with_suffix('.json').read_text())
 transcript=json.loads((folder/(name+'-transcription-base.json')).read_text())
 source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
 assert source_hash==record['sha256']==transcript['sha256'],f'Stale recording or transcript: {name}'
 aligned=copy.deepcopy([word for segment in transcript['segments'] for word in segment.get('words',[])])
 actual=[token for word in aligned for token in words(word['word'])]
 assert words(record['text'])==actual,f'Unresolved word discrepancy in {name}: {transcript["asr_text"]}'
 # Require one lexical token per alignment item rather than guessing boundaries.
 assert all(len(words(word['word']))==1 for word in aligned),f'Grouped ASR word in {name}'
 audio,rate=sf.read(source,dtype='float32');assert rate==24000 and audio.ndim==1 and np.isfinite(audio).all()
 peak=float(np.max(np.abs(audio)));rms=float(np.sqrt(np.mean(audio*audio)))
 gain=min(.09/max(rms,1e-8),.78/max(peak,1e-8))
 pause_added=0
 if cue in ['shadow','return']:
  marker='why' if cue=='shadow' else 'then'
  boundary=next(index for index,word in enumerate(aligned) if words(word['word'])==[marker])
  previous_end=aligned[boundary-1]['end'];next_start=aligned[boundary]['start']
  missing=max(0,3.4-(next_start-previous_end))
  lo=int((previous_end+.025)*rate);hi=int((next_start-.025)*rate);window=int(.015*rate)
  candidates=range(lo,hi-window,window)
  quiet=[(float(np.sqrt(np.mean(audio[index:index+window]**2))),index+window//2) for index in candidates]
  if missing>.01 and quiet and min(quiet)[0]<.005:
   cut=min(quiet)[1];count=int(missing*rate);fade=int(.003*rate)
   audio[cut-fade:cut]*=np.linspace(1,0,fade);audio[cut:cut+fade]*=np.linspace(0,1,fade)
   audio=np.concatenate([audio[:cut],np.zeros(count),audio[cut:]])
   pause_added=count/rate
   for word in aligned[boundary:]:word['start']+=pause_added;word['end']+=pause_added
 lead=.25;audio=np.concatenate([np.zeros(int(lead*rate)),audio*gain,np.zeros(int(.35*rate))])
 sf.write(review_wav/(cue+'.wav'),audio,rate,subtype='PCM_16')
 phrases=re.split(r'(?<=[.!?])\s+',record['text']);offset=0;timeline=[]
 for index,phrase in enumerate(phrases):
  count=len(words(phrase));chunk=aligned[offset:offset+count];offset+=count
  start=lead+chunk[0]['start'];end=min(len(audio)/rate-.02,lead+chunk[-1]['end']+.1)
  if offset<len(aligned):end=min(end,lead+aligned[offset]['start']-.02)
  assert end>start and len(phrase)<110
  whisper=cue=='shadow' or (cue=='return' and index==len(phrases)-1)
  label_whisper=(cue=='shadow' and index==0) or (cue=='return' and index==len(phrases)-1)
  timeline.append({'start':round(start,6),'end':round(end,6),'text':('[Whisper] '+phrase) if label_whisper else phrase,'kind':'whisper' if whisper else 'narrator'})
 target=assets/(cue+'.ogg')
 with sf.SoundFile(target,'w',samplerate=rate,channels=1,format='OGG',subtype='VORBIS') as stream:
  for index in range(0,len(audio),4096):stream.write(audio[index:index+4096])
 with sf.SoundFile(target) as stream:decoded=np.concatenate(list(stream.blocks(blocksize=4096)))
 report['clips'][cue]={'text':record['text'],'segments':timeline,'seconds':len(audio)/rate,'total_seconds':len(audio)/rate,'peak':float(np.max(np.abs(decoded))),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'source_sha256':source_hash,'linear_gain':gain,'pause_insert_seconds':pause_added,'source':name+'.wav','word_check':'Whisper base.en normalized words match; performance direction B selected by user'}
 records.append({'id':cue,'text':record['text'],'durationSeconds':round(len(audio)/rate+.5,6),'segments':timeline,'file':'/audio/narration/dream-v1/'+cue+'.ogg'})
(assets/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
provenance={key:value for key,value in report.items() if key!='clips'}
provenance.update({'generator':'scripts/render-dream-audition.py','packaging':'scripts/prepare-dream-release.py','model_source':'https://huggingface.co/'+model['repo']+'/tree/'+model['revision'],'package':'qwen-tts 0.1.1','model_license':'Apache-2.0','package_license':'Apache-2.0','voice_cloning':False,'cloud_inference':False,'runtime':'Compressed prerecorded mono audio; no TTS model in the browser','caption_timing':'Local Whisper base.en word alignment, grouped into authored phrases; exact script match verified'})
(assets/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
script="import { assetUrl } from '../utils/assetUrl';\nexport type NarrationCueId = 'opening' | 'ocean' | 'shadow' | 'forest' | 'return';\nexport interface NarrationSegment { start: number; end: number; text: string; kind?: string }\nexport interface NarrationCue { id: NarrationCueId; text: string; durationSeconds: number; file?: string; segments?: readonly NarrationSegment[] }\n/** Selected dream story and B voice direction. Phrase timings follow the final audio. */\nexport const NARRATION_SCRIPT: Readonly<Record<NarrationCueId, NarrationCue>> = {\n"
for record in records:
 url=record.pop('file');script+='  '+record['id']+': '+json.dumps(record)[:-1]+', "file": assetUrl('+json.dumps(url)+')},\n'
script+="};\nexport const WORLD_NARRATION: readonly NarrationCueId[] = ['return', 'forest', 'ocean', 'shadow'];\n"
(release/'narrationScript.ts').write_text(script)
(folder/'release-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print('Prepared five audio/caption candidates; production files unchanged;',sum(clip['bytes'] for clip in report['clips'].values()),'audio bytes',flush=True)
