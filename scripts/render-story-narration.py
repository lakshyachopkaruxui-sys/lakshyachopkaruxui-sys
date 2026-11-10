"""Offline phrase-directed synthetic narration. Models/tools never enter the browser."""
from pathlib import Path
import sys, os, json, hashlib, math
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools/narrator-deps312'))
runtime=ROOT/'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll=os.add_dll_directory(str(runtime)) if os.name=='nt' and runtime.exists() else None
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
RATE=24000
folder=ROOT/'validation/narration-story-2026-11-10'
public=ROOT/'public/audio/narration/story-v2'
folder.mkdir(parents=True,exist_ok=True);public.mkdir(parents=True,exist_ok=True)
config=json.loads((ROOT/'scripts/narration-story.json').read_text())
model=Kokoro(str(ROOT/'tools/narrator-models/kokoro-v1.0.onnx'),str(ROOT/'tools/narrator-models/voices-v1.0.bin'))
report={'voice':'Kokoro am_michael; af_nicole whisper','kind':'local synthetic narration with phrase direction; not a recorded actor','pitch_semitones':0,'bass_boost_db':0,'nonlinear_compression':False,'sample_rate':RATE,'channels':2,'echo_seconds':[],'tail_seconds':.4,'wet_gain':.022,'clips':{}}
def bandpass(signal,lo,hi):
    n=1<<(len(signal)-1).bit_length();f=np.fft.rfftfreq(n,1/RATE)
    filt=(f*f/(f*f+lo*lo))/np.sqrt(1+(f/hi)**8)
    return np.fft.irfft(np.fft.rfft(signal,n)*filt,n)[:len(signal)]
def air(seed):
    rng=np.random.default_rng(seed);t=np.arange(int(.3*RATE))/RATE
    return bandpass(rng.normal(size=len(t)),450,4500)*np.sin(np.pi*t/.3)**2*.014
for cue,settings in config.items():
    pieces=[np.zeros(int(settings['lead']*RATE))];timeline=[];cursor=settings['lead']
    for i,part in enumerate(settings['segments']):
        text=part['text'];voice=part.get('voice','am_michael');speed=part.get('speed',settings['speed'])
        dry=folder/'dry'/f'{cue}-{i}.wav';dry.parent.mkdir(parents=True,exist_ok=True)
        cache=folder/'dry'/f'{cue}-{i}.json';signature={'text':text,'voice':voice,'speed':speed}
        if dry.exists() and cache.exists() and json.loads(cache.read_text())==signature:
            samples,rate=sf.read(dry)
        else:
            samples,rate=model.create(text,voice=voice,speed=speed,lang='en-us')
            sf.write(dry,samples,rate,subtype='PCM_16');cache.write_text(json.dumps(signature))
        assert rate==RATE
        samples=np.asarray(samples,dtype=np.float64)
        keep=np.flatnonzero(np.abs(samples)>.0012)
        assert len(keep)>0,f'Silent segment {cue}-{i}'
        samples=samples[max(0,keep[0]-int(.035*RATE)):min(len(samples),keep[-1]+int(.09*RATE))]
        samples-=samples.mean()
        samples*=.125/max(np.sqrt(np.mean(samples*samples)),1e-8)
        samples*=settings.get('gain',1)*part.get('gain',1)
        if part.get('kind')=='whisper':samples=bandpass(samples,170,6500)
        fade=min(int(.012*RATE),len(samples)//8);samples[:fade]*=np.linspace(0,1,fade);samples[-fade:]*=np.linspace(1,0,fade)
        if part.get('breath'):
            breath=air(840+i);pieces.extend([breath,np.zeros(int(.1*RATE))]);cursor+=len(breath)/RATE+.1
        duration=len(samples)/RATE
        timeline.append({'start':round(cursor,6),'end':round(cursor+duration+.12,6),'text':('[Whisper] '+text) if part.get('kind')=='whisper' else text,'kind':part.get('kind','narrator')})
        pieces.append(samples);cursor+=duration
        pause=part['after'];pieces.append(np.zeros(int(pause*RATE)));cursor+=pause
        print(cue,i,round(duration,2),voice,flush=True)
    mono=np.concatenate(pieces);mono-=mono.mean()
    # Tiny, diffuse reflections only; all performance shaping is baked offline.
    stereo=np.zeros((len(mono)+int(.4*RATE),2))
    for channel in range(2):
        stereo[:len(mono),channel]=mono
        for delay,gain in [(0.023+channel*.009,.022),(0.071+channel*.013,.009)]:
            shift=int(delay*RATE);stereo[shift:shift+len(mono),channel]+=bandpass(mono,100,4800)*gain
    stereo*=min(1,.7/max(np.abs(stereo).max(),1e-8))
    wav=folder/f'{cue}.wav';sf.write(wav,stereo,RATE,subtype='PCM_16')
    target=public/f'{cue}.ogg'
    # The Windows encoder allocates per-call scratch on the stack: bound writes.
    with sf.SoundFile(target,'w',samplerate=RATE,channels=2,format='OGG',subtype='VORBIS') as stream:
        for offset in range(0,len(stereo),4096):stream.write(stereo[offset:offset+4096])
    with sf.SoundFile(target) as stream:
        sr=stream.samplerate;decoded=np.concatenate(list(stream.blocks(blocksize=4096)))
    assert sr==RATE and decoded.shape==stereo.shape
    text=' '.join(p['text'] for p in settings['segments'])
    report['clips'][cue]={'text':text,'segments':timeline,'voice_seconds':round(cursor,6),'total_seconds':round(len(stereo)/RATE,6),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'wav_sha256':hashlib.sha256(wav.read_bytes()).hexdigest(),'peak':float(np.abs(decoded).max()),'mood':settings['mood']}
    print(cue,'complete',round(len(stereo)/RATE,2),'seconds',target.stat().st_size,'bytes',flush=True)
(public/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
(folder/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
header="""import { assetUrl } from '../utils/assetUrl';
export type NarrationCueId = 'opening' | 'ocean' | 'shadow' | 'forest' | 'return';
export interface NarrationSegment { start: number; end: number; text: string; kind?: string }
export interface NarrationCue { id: NarrationCueId; text: string; durationSeconds: number; file?: string; segments?: readonly NarrationSegment[] }
/** Approved archive story. Timing generated from the actual offline audio render. */
export const NARRATION_SCRIPT: Readonly<Record<NarrationCueId, NarrationCue>> = {
"""
for cue,data in report['clips'].items():
    record={'id':cue,'text':data['text'],'durationSeconds':round(data['total_seconds']+.5,6),'segments':data['segments']}
    line=json.dumps(record,ensure_ascii=False)
    line=line[:-1]+', "file": assetUrl('+json.dumps('/audio/narration/story-v2/'+cue+'.ogg')+')}';header+='  '+cue+': '+line+',\n'
header+="};\nexport const WORLD_NARRATION: readonly NarrationCueId[] = ['return', 'forest', 'ocean', 'shadow'];\n"
(ROOT/'src/audio/narrationScript.ts').write_text(header,encoding='utf-8')
