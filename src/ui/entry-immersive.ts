// Homepage-only motion. Never mounts a world or changes the XR session.
const intro=document.getElementById('intro')!;
const canvas=document.getElementById('entry-atmosphere') as HTMLCanvasElement;
const ctx=canvas.getContext('2d');
const motion=document.getElementById('entry-motion')!;
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const quest=/OculusBrowser|Quest/i.test(navigator.userAgent);
const phone=/iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent)&&!quest;
intro.dataset.headset=String(quest);
const layers=[...intro.querySelectorAll<HTMLElement>('[data-world-image]')];
const choices=[...intro.querySelectorAll<HTMLButtonElement>('[data-glimpse]')];
const worlds=['ocean','shadow','forest'];
const names=["How Am I Breathing?","Something Knows I'm Here","Is This Finally Real?"];
const moods=['Wonder','Unease','Renewal'];
const captions=['Beneath the surface, another world is waiting.','Some places look back at you.','Find your way back through a living forest.'];
let paused=reduce.matches,manual=false,current=0,frame=0,last=0,time=0,lastSwitch=0,width=0,height=0;
let pointerX=.7,pointerY=.4,version=0;
let transitions:Animation[]=[];
function active(){return !paused&&!phone&&!document.hidden&&intro.dataset.busy!=='true'&&!intro.classList.contains('hidden');}
function finish(){for(const animation of transitions){try{animation.finish();}catch{animation.cancel();}}transitions=[];}
function select(index:number,byUser=false){
  if(byUser){manual=true;intro.dataset.auto='false';}
  if(index===current&&byUser)return;
  finish();const previous=layers[current],next=layers[index];current=index;const token=++version;lastSwitch=time;
  for(const [i,button] of choices.entries())button.setAttribute('aria-pressed',String(i===index));
  for(const layer of layers){layer.classList.toggle('is-active',layer===next);layer.classList.toggle('is-previous',layer===previous&&layer!==next);}
  intro.dataset.world=worlds[index];
  document.getElementById('world-number')!.textContent=String(index+1).padStart(2,'0');
  document.getElementById('world-mood')!.textContent=moods[index];
  document.getElementById('world-name')!.textContent=names[index];
  const caption=document.getElementById('glimpse-caption')!;
  caption.setAttribute('aria-live',byUser?'polite':'off');caption.textContent=captions[index];
  if(active()&&!reduce.matches&&previous!==next){
    const animation=next.animate([{clipPath:'polygon(0 0,0 0,0 40%,0 70%,0 100%,0 100%)'},{clipPath:'polygon(0 0,100% 0,100% 40%,100% 70%,100% 100%,0 100%)'}],{duration:1100,easing:'cubic-bezier(.23,1,.32,1)'});
    transitions.push(animation);void animation.finished.then(()=>{if(token===version)previous.classList.remove('is-previous');}).catch(()=>{});
  }else previous.classList.remove('is-previous');
  if(paused)draw();
}
for(const [i,button] of choices.entries())button.addEventListener('click',()=>select(i,true));
function draw(){
  if(!ctx)return;ctx.clearRect(0,0,width,height);
  const color=current===1?'255,150,88':current===2?'228,240,170':'184,240,247';
  // Different near/far speeds give the static world captures a living foreground.
  for(let i=0;i<(quest?42:65);i++){
    const depth=.25+(i%9)/9;
    const x=((Math.sin(i*78.23)*43758.54%1+1)*width+Math.sin(time*.15+i)*24+(pointerX-.5)*depth*30)%width;
    const y=((Math.sin(i*31.7)*12345.67%1+1)*height-time*(5+depth*8)+(pointerY-.5)*20)%height;
    ctx.fillStyle=`rgba(${color},${.12+.32*(.5+.5*Math.sin(time*.7+i))})`;
    ctx.beginPath();ctx.arc(x,(y+height)%height,depth*1.7,0,Math.PI*2);ctx.fill();
  }
  // Light drifts across the visual half, keeping text and actions stationary.
  const glow=ctx.createRadialGradient(width*pointerX,height*pointerY,0,width*pointerX,height*pointerY,width*.35);
  glow.addColorStop(0,`rgba(${color},.11)`);glow.addColorStop(1,`rgba(${color},0)`);
  ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
}
function loop(stamp:number){frame=0;if(!active())return;
  if(stamp-last>(quest?40:32)){time+=Math.min((stamp-last)/1000,.06);last=stamp;draw();if(!manual&&time-lastSwitch>=7)select((current+1)%3);}
  frame=requestAnimationFrame(loop);
}
function sync(){cancelAnimationFrame(frame);frame=0;last=performance.now();
  intro.dataset.motion=paused?'paused':'playing';intro.dataset.resting=String(document.hidden);intro.dataset.auto=String(!manual&&!paused&&!reduce.matches&&!phone);
  motion.textContent=paused?'Resume motion':'Pause motion';motion.setAttribute('aria-pressed',String(paused));
  if(active())frame=requestAnimationFrame(loop);else{finish();if(!intro.classList.contains('hidden'))draw();}
}
function resize(){width=Math.min(innerWidth,quest?960:1280);height=Math.min(innerHeight,quest?640:900);canvas.width=width;canvas.height=height;draw();}
motion.addEventListener('click',()=>{paused=!paused;sync();});
reduce.addEventListener('change',()=>{paused=reduce.matches;sync();});
document.addEventListener('visibilitychange',sync);
new MutationObserver(sync).observe(intro,{attributes:true,attributeFilter:['class','data-busy']});
document.addEventListener('keydown',()=>{manual=true;intro.dataset.auto='false';finish();});
intro.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&!paused){pointerX=e.clientX/innerWidth;pointerY=e.clientY/innerHeight;}});
window.addEventListener('resize',resize);
if(active()&&!reduce.matches)intro.querySelectorAll<HTMLElement>('h1 span').forEach((letter,i)=>transitions.push(letter.animate([{transform:'translateY(36px)',opacity:0},{transform:'translateY(0)',opacity:1}],{duration:800,delay:200+i*80,easing:'cubic-bezier(.23,1,.32,1)'})));
resize();sync();
export {};
