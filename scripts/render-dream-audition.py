"""Create dry, expressive audition takes locally; never change runtime tracks."""
from pathlib import Path
import os,json,time,hashlib,sys
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'validation/dream-voice-2026-11-10'
OUTPUT.mkdir(parents=True,exist_ok=True)
for key,value in {
 'HF_HOME':ROOT/'tools/qwen-cache/huggingface',
 'TORCH_HOME':ROOT/'tools/qwen-cache/torch',
 'NUMBA_CACHE_DIR':ROOT/'tools/qwen-cache/numba',
 'XDG_CACHE_HOME':ROOT/'tools/qwen-cache',
 'TEMP':ROOT/'tools/qwen-temp','TMP':ROOT/'tools/qwen-temp'
}.items():
 Path(value).mkdir(parents=True,exist_ok=True);os.environ[key]=str(value)
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['OMP_NUM_THREADS']='4';os.environ['MKL_NUM_THREADS']='4'
runtime=ROOT/'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll=os.add_dll_directory(str(runtime)) if os.name=='nt' and runtime.exists() else None
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel
torch.set_num_threads(4);torch.set_num_interop_threads(1)
print('Runtime',torch.__version__,'CPU threads',torch.get_num_threads(),flush=True)
if '--wait' in sys.argv:
 print('Waiting for verified model download',flush=True)
 while not (ROOT/'tools/qwen-models/custom-voice/download-provenance.json').exists():time.sleep(5)
start=time.monotonic()
model=Qwen3TTSModel.from_pretrained(str(ROOT/'tools/qwen-models/custom-voice'),device_map='cpu',dtype=torch.float32,attn_implementation='sdpa',local_files_only=True)
print('Loaded',round(time.monotonic()-start,2),'seconds; speakers',model.get_supported_speakers(),flush=True)
takes=[
 {'id':'opening-stifled-v3','speaker':'Ryan','seed':4231,
  'text':"I thought I'd woken up. Same room. Same light. Then I saw it. A cut... in the air.",
  'direction':'An ordinary man speaking his private thoughts just after waking inside a strange dream. Close, intimate and hushed, with an audible small inhale as he notices something impossible. Begin groggy and uncertain, then grow quietly alarmed. The words about the cut in the air become a thin, uneasy whisper, with a slight tremor and breath catching naturally. A person experiencing this now, never a detached announcer. Clear English, natural hesitations. Speak only the supplied dialogue. Dry voice, no echo, no reverb, no music, no doubled voice. Do not speak these instructions.'},
 {'id':'ocean-stifled-v3','speaker':'Ryan','seed':4232,
  'text':"I should be drowning. But I can breathe. For once... I don't want to wake up.",
  'direction':'An ordinary man thinking aloud very quietly inside an underwater dream. The first thought carries a brief catch of fear and a natural audible inhale. Discovering he can breathe releases that tension into intimate breathy wonder. His final wish is soft, sincere and vulnerable, not terrified. Close human voice with the same hushed private-thought quality throughout, clear English and pauses between realizations. Speak only the supplied words. Dry recording, no echo, no reverb, no music and no other voices. Do not read these directions.'},
 {'id':'forest-stifled-v3','speaker':'Ryan','seed':4233,
  'text':'Air. This feels real. If I open it again... will I wake up? Or go deeper?',
  'direction':'A man emerging from a nightmare into a fresh living forest. Keep the voice close, hushed and physically human. Begin with a natural relieved exhale and let his breathing settle. He sounds shaken but increasingly reassured. The questions at the end reveal a small remaining tremor and uncertainty, without overwhelming the relief. Warm, vulnerable private thoughts, clear conversational English. Speak only the supplied dialogue. Dry voice, no echo, no reverb, no music, no extra speakers. Do not say these directions.'},
 {'id':'forest-stifled-v4','speaker':'Ryan','seed':4243,
  'text':'Fresh air. This feels real. If I open it again... will I wake up? Or go deeper?',
  'direction':'A man emerging from a nightmare into a fresh living forest. Keep the voice close, hushed and physically human. Begin with a natural relieved exhale and let his breathing settle. He sounds shaken but increasingly reassured. The questions at the end reveal a small remaining tremor and uncertainty, without overwhelming the relief. Warm, vulnerable private thoughts, clear conversational English. Speak only the supplied dialogue. Dry voice, no echo, no reverb, no music, no extra speakers. Do not say these directions.'},
 {'id':'return-stifled-v3','speaker':'Ryan','seed':4234,
  'text':"I'm back. I thought I'd feel it... when I woke up. Then why is the tear still here?",
  'direction':'A frightened man has returned to his familiar room and desperately wants to believe he is awake. Start with a brief shaky relieved exhale. His voice stays close, hushed, thin and vulnerable. During the next thought relief fails: his breath catches, his throat tightens and the voice begins to tremble. Wait before the last question. Say it as an intensely frightened, strained, breathy whisper, trying not to be heard by something nearby. Genuine stifled panic, never soothing narration or a monster voice. Keep all words intelligible in English. Perform natural uneven breaths in the take, without adding spoken words. Dry recording, no echo, no reverb, no music, no doubled voices. Do not read the instructions.'},
 {'id':'shadow-panic-v2','speaker':'Ryan','seed':4211,
  'text':"No... I remember this part. This is where I always wake up. Why haven't I woken up?",
  'direction':'Act as a genuinely terrified person inside a nightmare, not a calm storyteller. Acute fear is physically affecting his voice: throat tight, voice trembling, words catching, short audible involuntary inhalations between thoughts. He is trying to keep quiet because something is close. The first No is a startled, broken breath. Recognition becomes frightened urgency in the second sentence. After a frightened breath, the last question is a desperate, shaky, breathy whisper. Strong emotional commitment and human vulnerability, not a deep monster voice. Speak only the supplied words in clear English. Keep the breathing in this performed take. Dry close recording, no music, no echo, no reverb, no doubled voices. Do not speak these instructions.'},
 {'id':'shadow-stifled-v2','speaker':'Ryan','seed':4212,
  'text':"No... I remember this part. This is where I always wake up. Why haven't I woken up?",
  'direction':'A person hiding in immediate danger, terrified and barely able to keep his voice steady. Whisper with real panic, not a relaxed or soothing whisper. Breathing is uneven and audible: a caught inhale after the first thought, a tight breath before the final question. Let fear make the voice thin, strained and trembling, almost breaking into a frightened sob while the words stay intelligible. He recognizes the nightmare and desperately needs to wake up. Natural halting English, emotionally intense, close and vulnerable. Speak only the supplied words. Dry voice, no echo, no reverb, no music, no other speakers. Do not say these directions.'},
 {'id':'shadow-recognition','speaker':'Ryan','seed':4201,
  'text':"No... I remember this part. This is where I always wake up. Why haven't I woken up?",
  'direction':'A frightened man speaking his own private thoughts inside a nightmare. Quiet disbelieving recognition at first, a brief caught breath after the first sentence, then increasing controlled fear. He expects to wake up, waits, and realizes he has not. The last question becomes a hushed, intelligible whisper. Restrained human acting, uneven hesitation, natural English. Dry close recording, no echo, no music, no extra voices. Do not read the instructions aloud.'},
 {'id':'shadow-whisper','speaker':'Ryan','seed':4202,
  'text':"No... I remember this part. This is where I always wake up. Why haven't I woken up?",
  'direction':'Whisper the entire passage fearfully, as a man trying not to be heard inside a nightmare. Breath catches briefly and words are slightly unsteady. Let a silence separate the expectation of waking from the final question. Intelligible close human whisper, not a deep narrator voice or monster growl. Dry recording, no echo, no music. Do not say these instructions.'},
 {'id':'opening-dream','speaker':'Ryan','seed':4203,
  'text':"I thought I'd woken up. Same room. Same light. Then I saw it. A cut... in the air.",
  'direction':'An ordinary man thinking quietly just after waking from a vivid dream. Conversational and intimate, initially groggy, then a small involuntary inhale as he notices something impossible. The words about the cut in the air become quietly fascinated and uneasy. Leave space between thoughts. Understated acting, clear English. Dry close recording, no echo, no music, no extra voices. Do not say these instructions.'},
 {'id':'ocean-dream','speaker':'Ryan','seed':4204,
  'text':"I should be drowning. But I can breathe. For once... I don't want to wake up.",
  'direction':'The same ordinary man discovering he is underwater inside a dream. Starts startled, takes a brief natural breath, and becomes quietly astonished that he can breathe. Let the wonder feel real and unforced. The final thought is warm, vulnerable and sincere: he wants to stay in this beautiful place. Private first-person thoughts, conversational clear English, space between thoughts. Dry close recording, no echo, no music, no extra voices. Do not read these directions.'},
 {'id':'forest-dream','speaker':'Ryan','seed':4205,
  'text':'Air. This feels real. If I open it again... will I wake up? Or go deeper?',
  'direction':'The same man just emerging from a nightmare into a living forest. A slow relieved exhale, warm private relief on the first two short sentences. Pause and let him try to believe he is safe. Then a small uncertainty enters the questions about waking. Human, intimate, slightly exhausted rather than a theatrical narrator. Dry close recording, no echo, no music, no extra voices. Do not say these instructions.'},
 {'id':'return-dream','speaker':'Ryan','seed':4206,
  'text':"I'm back. I thought I'd feel it... when I woke up. Then why is the tear still here?",
  'direction':'The same man returning to his familiar room after a vivid nightmare. A relieved exhale after the first short sentence. He expects to feel awake, waits, and realizes something is still wrong. Let a silence precede the last question, which becomes a quiet fearful whisper. Restrained believable acting, clear intimate English, uneven human hesitation. Dry close recording, no echo, no music, no extra voices. Do not say these instructions.'}
]
requested={arg for arg in sys.argv[1:] if arg!='--wait'};report={'model':'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice','execution':'local CPU; offline during synthesis','speaker':'Ryan builtin preset; no voice cloning','effects':{'reverb':0,'echo':0,'pitch_shift':0,'synthetic_breath_layer':False},'takes':[]}
for take in takes:
 if requested and take['id'] not in requested:continue
 target=OUTPUT/(take['id']+'.wav');record_path=OUTPUT/(take['id']+'.json')
 if target.exists() and record_path.exists():
  previous=json.loads(record_path.read_text())
  if all(previous.get(key)==value for key,value in take.items()) and previous.get('sha256')==hashlib.sha256(target.read_bytes()).hexdigest():
   report['takes'].append(previous);print('Cached',take['id'],flush=True);continue
 torch.manual_seed(take['seed']);begin=time.monotonic();print('Rendering',take['id'],flush=True)
 with torch.inference_mode():
  waves,rate=model.generate_custom_voice(text=take['text'],language='English',speaker=take['speaker'],instruct=take['direction'],max_new_tokens=640)
 wave=np.asarray(waves[0],dtype=np.float64).reshape(-1)
 assert np.isfinite(wave).all() and len(wave)>rate and np.max(np.abs(wave))>.01
 # Preserve performed dynamics. Only leave peak headroom and fade file edges.
 wave*=min(1,.78/np.max(np.abs(wave)))
 fade=min(int(.008*rate),len(wave)//8);wave[:fade]*=np.linspace(0,1,fade);wave[-fade:]*=np.linspace(1,0,fade)
 sf.write(target,wave,rate,subtype='PCM_16')
 record={**take,'sample_rate':rate,'channels':1,'seconds':len(wave)/rate,'render_seconds':time.monotonic()-begin,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'peak':float(np.abs(wave).max()),'rms':float(np.sqrt(np.mean(wave*wave))),'effects':report['effects'],'listening_approval':'pending'}
 record_path.write_text(json.dumps(record,indent=2)+'\n');report['takes'].append(record)
 (OUTPUT/'audition-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
 print('Saved',take['id'],round(record['seconds'],2),'audio seconds in',round(record['render_seconds'],2),'seconds',flush=True)
(OUTPUT/'audition-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
