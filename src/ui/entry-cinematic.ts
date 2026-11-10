// A bounded, entry-only atmosphere. It stops completely during the experience.
const intro = document.getElementById('intro')!;
const canvas = document.getElementById('entry-atmosphere') as HTMLCanvasElement;
const context = canvas.getContext('2d');
const motion = document.getElementById('entry-motion')!;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const phone = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent) && !/OculusBrowser|Quest/i.test(navigator.userAgent);
const quest = /OculusBrowser|Quest/i.test(navigator.userAgent);
intro.dataset.headset = String(quest);
let paused = reduce.matches, frame = 0, last = 0, time = 0, width = 0, height = 0;
let pointerX = .5, pointerY = .5;
const captions: Record<string,string> = {ocean:'Something moves beneath the surface.',shadow:'You may not be alone here.',forest:'A different kind of awakening.'};
let hue = 210;
const rift = intro.querySelector<HTMLElement>('.rift-float')!;
const images = [...intro.querySelectorAll<HTMLImageElement>('[data-world-image]')];
const indicator = document.getElementById('world-indicator')!;
let keyboard = false, wipeVersion = 0;
let finiteAnimations: Animation[] = [];
const canAnimate = () => !paused && !reduce.matches && !keyboard && !phone && !document.hidden && intro.dataset.busy!=='true' && !intro.classList.contains('hidden');
function settleAnimations() {
  for (const animation of finiteAnimations) { try { animation.finish(); } catch { animation.cancel(); } }
  finiteAnimations = [];
}
function applyOpening(value:number, animate=false) {
  const prior = new DOMMatrixReadOnly(getComputedStyle(rift).transform).a || .2;
  settleAnimations();
  const amount = Math.max(0,Math.min(1,value));
  const scale = .2 + amount * 1.05;
  rift.style.transform = `scaleX(${scale})`;
  for (const image of images) image.style.transform = `scaleX(${1/scale})`;
  // Counter-scale the image: the aperture opens without squeezing the world.
  if (animate && Math.abs(scale-prior) > .001 && canAnimate()) {
    const keys = Array.from({length:25},(_,i) => prior + (scale-prior)*i/24);
    const options = { duration:650, easing:'cubic-bezier(.23,1,.32,1)' };
    finiteAnimations.push(rift.animate(keys.map(s=>({transform:`scaleX(${s})`})),options));
    for (const image of images) finiteAnimations.push(image.animate(keys.map(s=>({transform:`scaleX(${1/s})`})),options));
  }
  intro.dataset.open = String(amount > .05);
}
function setOpen(value:boolean) {
  applyOpening(value?1:0,true);
}
function moveIndicator(choice:HTMLElement) {
  indicator.style.transform = `translateX(${choice.offsetLeft}px) scaleX(${choice.offsetWidth})`;
}
for(const choice of document.querySelectorAll<HTMLButtonElement>('[data-glimpse]')) choice.addEventListener('click',()=>{
  const world = choice.dataset.glimpse!; hue = world==='ocean'?195:world==='shadow'?15:145;
  for(const button of document.querySelectorAll('[data-glimpse]')) button.setAttribute('aria-pressed',String(button===choice));
  const previous = images.find(image=>image.classList.contains('is-active'));
  const next = images.find(image=>image.dataset.worldImage===world)!;
  setOpen(true);
  const version=++wipeVersion;
  for(const image of images) {
    image.classList.toggle('is-previous',image===previous && image!==next);
    image.classList.toggle('is-active',image===next);
  }
  if(previous!==next && canAnimate()) {
    const wipe=next.animate([{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)'}],{duration:650,easing:'cubic-bezier(.23,1,.32,1)'});
    finiteAnimations.push(wipe);
    void wipe.finished.then(()=>{if(version===wipeVersion)previous?.classList.remove('is-previous');}).catch(()=>{});
  } else previous?.classList.remove('is-previous');
  moveIndicator(choice);
  document.getElementById('glimpse-caption')!.textContent=captions[world]; if(paused) draw();
});
function resize() {
  width = Math.min(innerWidth,quest?960:1280); height = Math.min(innerHeight,quest?640:900);
  canvas.width=width; canvas.height=height; draw();
  const selected=intro.querySelector<HTMLElement>('[data-glimpse][aria-pressed=true]');
  if(selected)moveIndicator(selected);
}
function draw() {
  if(!context || !width || !height)return;
  const ctx=context;
  ctx.fillStyle='#080b11';ctx.fillRect(0,0,width,height);
  // Layered moving ribbons create depth without loading a second 3D scene.
  ctx.globalCompositeOperation='screen';
  for(let layer=0;layer<3;layer++) {
    const shift=time*.1+layer*2;
    const glow=ctx.createRadialGradient(width*(.28+layer*.23),height*.44,0,width*.5,height*.5,width*.48);
    glow.addColorStop(0,`hsla(${hue+layer*18},50%,32%,.2)`);glow.addColorStop(1,'transparent');
    ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
    for(let i=0;i<22;i++) {
      const offset=(i-11)*width*.011;
      const x=width*(.5+Math.sin(shift+i*.018)*.22)+(pointerX-.5)*25;
      ctx.beginPath();ctx.moveTo(x+offset,-40);
      ctx.bezierCurveTo(width*.15+offset,height*.25+Math.sin(shift)*100,width*.85+offset,height*.62+Math.cos(shift)*80,width*.48+offset,height+40);
      ctx.strokeStyle=`hsla(${hue+i*1.2},50%,${45+i*.5}%,${.018+Math.sin(i/22*Math.PI)*.045})`;
      ctx.lineWidth=1+Math.sin(i*.2+shift)**2*3;ctx.stroke();
    }
  }
  const cursorGlow=ctx.createRadialGradient(width*pointerX,height*pointerY,0,width*pointerX,height*pointerY,width*.35);
  cursorGlow.addColorStop(0,`hsla(${hue},60%,60%,.08)`);cursorGlow.addColorStop(1,'transparent');
  ctx.fillStyle=cursorGlow;ctx.fillRect(0,0,width,height);
  // Deterministic motes drift at varied depths, with restrained pointer attraction.
  for(let i=0;i<85;i++) {
    const depth=.3+(i%7)/10;
    const x=((Math.sin(i*78.233)*43758.54%1+1)*width+Math.sin(time*.16+i)*18+(pointerX-.5)*depth*22)%width;
    const y=((Math.sin(i*31.7)*12345.67%1+1)*height-time*(2+depth*5)+(pointerY-.5)*10)%height;
    const alpha=.12+.22*(.5+.5*Math.sin(time*.7+i));
    ctx.fillStyle=`rgba(203,220,239,${alpha})`;ctx.beginPath();ctx.arc(x,(y+height)%height,depth*1.1,0,Math.PI*2);ctx.fill();
  }
  ctx.globalCompositeOperation='source-over';
}
function running(){return !paused&&!phone&&!document.hidden&&intro.dataset.busy!=='true'&&!intro.classList.contains('hidden');}
function loop(timestamp:number) {
  frame=0;if(!running())return;
  if(timestamp-last>(quest?40:32)){time+=Math.min((timestamp-last)/1000,.05);last=timestamp;draw();}
  frame=requestAnimationFrame(loop);
}
function sync() {
  cancelAnimationFrame(frame);frame=0;last=performance.now();
  intro.dataset.resting=String(document.hidden);
  if(!running())settleAnimations();
  motion.setAttribute('aria-pressed',String(paused));motion.textContent=paused?'Resume motion':'Pause motion';
  intro.dataset.motion=paused?'paused':'playing';
  if(running())frame=requestAnimationFrame(loop);else if(!intro.classList.contains('hidden'))draw();
}
motion.addEventListener('click',()=>{paused=!paused;sync();});
reduce.addEventListener('change',()=>{paused=reduce.matches;sync();});
document.addEventListener('visibilitychange',sync);
new MutationObserver(sync).observe(intro,{attributes:true,attributeFilter:['class','data-busy']});
intro.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&!paused){pointerX=event.clientX/innerWidth;pointerY=event.clientY/innerHeight;}});
window.addEventListener('resize',resize);
document.addEventListener('keydown',()=>{keyboard=true;intro.dataset.keyboard='true';settleAnimations();});
intro.addEventListener('pointerdown',()=>{keyboard=false;intro.dataset.keyboard='false';});
// First arrival has a short masked title reveal; controls never wait for it.
if(canAnimate()) {
  intro.querySelectorAll<HTMLElement>('h1 span').forEach((letter,i)=>{
    finiteAnimations.push(letter.animate([{transform:'translateY(18px)',opacity:0},{transform:'translateY(0)',opacity:1}],{duration:600,delay:i*75,easing:'cubic-bezier(.23,1,.32,1)'}));
  });
}
resize();sync();
export {};
