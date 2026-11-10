import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const moduleUrl = new URL('../src/worlds/ForestGpuPreparation.ts', import.meta.url).href;
registerHooks({ load(url, context, next) {
  if (url === moduleUrl) return { format:'module', source:stripTypeScriptTypes(readFileSync(new URL(url),'utf8'),{mode:'transform'}), shortCircuit:true };
  return next(url,context);
} });
const { prepareForestGpu } = await import(moduleUrl);

test('portal and entered light counts compile in both shadow modes without moving live seam lights', async () => {
  const f = fixture(), anchor = new THREE.Group();
  const spot = new THREE.SpotLight(), glow = new THREE.PointLight();
  anchor.add(spot, glow); f.scene.add(anchor);
  const additionalLights = [spot.clone(), glow.clone()], excludedLights = [spot, glow];
  const observed = [], originalCompile = f.renderer.compileAsync;
  const assertRestored = () => {
    assert.equal(spot.parent, anchor); assert.equal(glow.parent, anchor);
    assert.equal(spot.visible, true); assert.equal(glow.visible, true);
    for (const light of additionalLights) assert.equal(light.parent, null);
  };
  f.renderer.compileAsync = function () {
    const live = [];
    f.scene.traverseVisible(object => { if (object.isSpotLight || object.isPointLight) live.push(object); });
    assert.equal(spot.parent, anchor); assert.equal(glow.parent, anchor);
    assert.equal(spot.visible, false); assert.equal(glow.visible, false);
    observed.push([this.shadowMap.enabled, live.length]);
    originalCompile.call(this);
    return Promise.resolve().then(assertRestored);
  };
  const result = await prepareForestGpu(f.renderer, f.scene, f.camera, undefined, {
    additionalLights, excludedLights, yieldTask: async () => assertRestored()
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(observed, [[true, 0], [false, 0], [true, 2], [false, 2]]);
  assert.deepEqual(result.compileVariants.map(variant => [variant.shadows, variant.additionalLights]), observed.map(([shadows, count]) => [shadows, count > 0]));
  assertRestored();
});

test('entered-light compilation failure restores live visibility and temporary light parents', async () => {
  const f = fixture(), anchor = new THREE.Group(), live = new THREE.PointLight();
  anchor.add(live); f.scene.add(anchor);
  const temporary = live.clone(), originalCompile = f.renderer.compileAsync;
  f.renderer.compileAsync = function () {
    if (temporary.parent === f.scene) throw new Error('Entered lighting compilation failed');
    return originalCompile.call(this);
  };
  const result = await prepareForestGpu(f.renderer, f.scene, f.camera, undefined, {
    additionalLights: [temporary], excludedLights: [live], yieldTask: async () => {}
  });
  assert.equal(result.status, 'fallback');
  assert.match(result.error, /Entered lighting compilation failed/);
  assert.equal(live.parent, anchor); assert.equal(live.visible, true); assert.equal(temporary.parent, null);
});

function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const shared = new THREE.Texture(), hidden = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map:shared, normalMap:shared });
  material.onBeforeCompile = function(shader) { shader.uniforms.hiddenSoil={value:hidden}; };
  const originalHook=material.onBeforeCompile, originalKey=material.customProgramCacheKey;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.Mesh(new THREE.PlaneGeometry(),material));
  const light = new THREE.DirectionalLight();light.castShadow=true;light.shadow.needsUpdate=true;light.shadow.autoUpdate=false;scene.add(light);
  const events=[], disposed=[], seenTargets=new WeakSet();
  const originalTarget = new THREE.WebGLRenderTarget(12,8);
  const renderer={
    outputColorSpace:THREE.SRGBColorSpace,
    target:originalTarget,face:3,level:2,viewport:new THREE.Vector4(3,4,500,300),scissor:new THREE.Vector4(7,8,80,90),scissorTest:true,
    clearColor:new THREE.Color(.2,.3,.4),clearAlpha:.3,
    autoClear:false,autoClearColor:true,autoClearDepth:false,autoClearStencil:false,
    xr:{enabled:true,cameraAutoUpdate:true}, shadowMap:{enabled:true,autoUpdate:false,needsUpdate:true,type:THREE.PCFShadowMap},
    info:{autoReset:false,render:{frame:44,calls:33,triangles:1234,points:4,lines:5}},
    getRenderTarget(){return this.target},getActiveCubeFace(){return this.face},getActiveMipmapLevel(){return this.level},
    getViewport(out){return out.copy(this.viewport)},getScissor(out){return out.copy(this.scissor)},getScissorTest(){return this.scissorTest},
    getClearColor(out){return out.copy(this.clearColor)},getClearAlpha(){return this.clearAlpha},
    setRenderTarget(target,face=0,level=0){this.target=target;this.face=face;this.level=level;if(target){this.viewport.copy(target.viewport);this.scissor.copy(target.scissor)}},
    setViewport(x,y,w,h){if(x.isVector4)this.viewport.copy(x);else this.viewport.set(x,y,w,h)},
    setScissor(x,y,w,h){if(x.isVector4)this.scissor.copy(x);else this.scissor.set(x,y,w,h)},
    setScissorTest(value){this.scissorTest=value},setClearColor(value,alpha){this.clearColor.set(value);this.clearAlpha=alpha},
    initTexture(texture){events.push(['texture',texture]);},
    compile(object){events.push(['environmentShader']);object.material?.addEventListener('dispose',()=>disposed.push('environmentShader'));},
    compileAsync(){
      events.push(['compile',material.customProgramCacheKey()]);
      const shader={uniforms:{},vertexShader:'',fragmentShader:''};material.onBeforeCompile(shader,this);
      return Promise.resolve();
    },
    render(){
      events.push(['render',this.target]);
      if(!seenTargets.has(this.target)){seenTargets.add(this.target);this.target.addEventListener('dispose',()=>disposed.push('target'));}
      assert.equal(this.xr.enabled,false);assert.equal(this.xr.cameraAutoUpdate,false);
      assert.deepEqual(this.viewport.toArray(),[0,0,4,4]);assert.equal(this.scissorTest,false);
      assert.equal(this.target.texture.colorSpace,this.outputColorSpace);
      this.shadowMap.needsUpdate=false;light.shadow.needsUpdate=false;this.info.render.calls=999;
    }
  };
  const snapshot=()=>({target:renderer.target,face:renderer.face,level:renderer.level,viewport:renderer.viewport.toArray(),scissor:renderer.scissor.toArray(),
    scissorTest:renderer.scissorTest,clearColor:renderer.clearColor.toArray(),clearAlpha:renderer.clearAlpha,
    autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,
    xr:{...renderer.xr},shadowMap:{...renderer.shadowMap},info:{autoReset:renderer.info.autoReset,render:{...renderer.info.render}}});
  const yieldTask=async()=>events.push(['yield']);
  return {scene,camera,material,shared,hidden,renderer,snapshot,events,disposed,yieldTask,light,originalHook,originalKey};
}

test('Forest preparation deduplicates maps and uploads injected samplers before first rendering', async()=>{
  const f=fixture(),before=f.snapshot();
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{yieldTask:f.yieldTask});
  assert.equal(result.status,'ready');assert.equal(result.texturesUploaded,2);assert.equal(result.materials,1);
  const textureEvents=f.events.filter(e=>e[0]==='texture');assert.deepEqual(textureEvents.map(e=>e[1]),[f.shared,f.hidden]);
  for(let i=0;i<f.events.length;i++)if(f.events[i][0]==='texture')assert.equal(f.events[i-1][0],'yield','every texture gets a task boundary');
  assert.ok(f.events.findIndex(e=>e[0]==='compile')<f.events.findIndex(e=>e[1]===f.hidden));
  assert.ok(f.events.findIndex(e=>e[1]===f.hidden)<f.events.findIndex(e=>e[0]==='render'));
  assert.equal(f.events.find(e=>e[0]==='compile')[1],f.originalKey.call(f.material),'wrapping hooks must not change shader cache identity');
  assert.equal(f.material.onBeforeCompile,f.originalHook);assert.equal(f.material.customProgramCacheKey,f.originalKey);
  assert.deepEqual(f.snapshot(),before);assert.equal(f.light.shadow.needsUpdate,true);assert.equal(f.light.shadow.autoUpdate,false);
  assert.deepEqual(f.disposed,['target']);assert.ok(result.timings.totalMs>=0);
});

test('offscreen render failure restores non-default XR, target, scissor, clear and shadow state and disposes target',async()=>{
  const f=fixture(),before=f.snapshot(),render=f.renderer.render;
  f.renderer.render=function(){render.call(this);throw new Error('simulated driver failure')};
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{yieldTask:f.yieldTask});
  assert.equal(result.status,'fallback');assert.match(result.error,/driver failure/);
  assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.disposed,['target']);
  assert.equal(f.light.shadow.needsUpdate,true);assert.equal(f.material.onBeforeCompile,f.originalHook);
});

test('compile failure cannot leak internal PMREM state or material hooks',async()=>{
  const f=fixture();f.scene.environment=f.shared;f.shared.mapping=THREE.EquirectangularReflectionMapping;
  const before=f.snapshot();
  f.renderer.compileAsync=function(){this.xr.enabled=false;this.setRenderTarget(null);this.setClearColor(0,.8);throw new Error('PMREM conversion failed')};
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{yieldTask:f.yieldTask});
  assert.equal(result.status,'fallback');assert.deepEqual(f.snapshot(),before);
  assert.equal(f.material.onBeforeCompile,f.originalHook);assert.equal(f.material.customProgramCacheKey,f.originalKey);
  assert.deepEqual(f.disposed,[]);assert.ok(!f.events.some(e=>e[0]==='render'));
});

test('asynchronous compilation does not overwrite a newer renderer state from another frame',async()=>{
  const f=fixture();let expected;
  const compile=f.renderer.compileAsync;
  f.renderer.compileAsync=function(){
    compile.call(this);
    return Promise.resolve().then(()=>{this.xr.enabled=false;this.viewport.set(1,2,320,240);this.clearAlpha=.7;expected=f.snapshot();});
  };
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{yieldTask:f.yieldTask});
  assert.equal(result.status,'ready');assert.deepEqual(f.snapshot(),expected);
});

test('cancellation at a yielded upload exits without compiling or rendering and keeps original hooks',async()=>{
  const f=fixture(),before=f.snapshot(),controller=new AbortController();
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{signal:controller.signal,yieldTask:async()=>controller.abort()});
  assert.equal(result.status,'cancelled');assert.equal(result.texturesUploaded,0);
  assert.ok(!f.events.length);assert.deepEqual(f.snapshot(),before);assert.equal(f.material.onBeforeCompile,f.originalHook);
});

test('desktop and shadowless XR variants compile without retaining temporary renderer flags',async()=>{
  const f=fixture(),before=f.snapshot(),variants=[],compile=f.renderer.compileAsync;
  f.renderer.compileAsync=function(){variants.push(this.shadowMap.enabled);return compile.call(this)};
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{yieldTask:async()=>{
    assert.deepEqual(f.snapshot(),before,'state must be restored at every task boundary');
  },preflight:false});
  assert.equal(result.status,'ready');assert.deepEqual(variants,[true,false]);
  assert.deepEqual(result.compileVariants.map(v=>v.shadows),[true,false]);
  assert.deepEqual(f.snapshot(),before);assert.ok(!f.events.some(e=>e[0]==='render'));
});

test('all detached patches and both index variants warm in bounded batches without changing scene state',async()=>{
  const f=fixture(),parent=new THREE.Group(),entries=[],originalOrder=[];
  f.scene.add(parent);
  for(let i=0;i<39;i++){
    const near=new THREE.PlaneGeometry(),far=near.clone();
    near.setDrawRange(1,5);far.setDrawRange(2,4);
    const mesh=new THREE.InstancedMesh(near,f.material,27);
    mesh.position.set(i,2,-i);mesh.updateMatrix();mesh.updateMatrixWorld();mesh.visible=i%3!==0;
    if(i%2===0){parent.add(mesh);originalOrder.push(mesh);}
    entries.push({mesh,geometries:[near,far]});
  }
  const snapshots=entries.map(({mesh,geometries})=>({mesh,parent:mesh.parent,visible:mesh.visible,geometry:mesh.geometry,
    frustumCulled:mesh.frustumCulled,count:mesh.count,matrix:mesh.matrix.toArray(),world:mesh.matrixWorld.toArray(),
    auto:mesh.matrixAutoUpdate,worldAuto:mesh.matrixWorldAutoUpdate,worldNeeds:mesh.matrixWorldNeedsUpdate,
    ranges:geometries.map(g=>({...g.drawRange}))}));
  const seen=new Map(),before=f.snapshot(),render=f.renderer.render,compile=f.renderer.compileAsync;
  let batchCalls=0,shadowPasses=0;
  f.renderer.compileAsync=function(){
    for(const {mesh} of entries)assert.ok(mesh.parent,'detached materials participate in synchronous compile');
    return compile.call(this);
  };
  f.renderer.render=function(scene){
    const uploading=this.shadowMap.autoUpdate===false&&this.shadowMap.needsUpdate===false;
    if(uploading){
      batchCalls++;const visible=[];
      scene.traverseVisible(o=>{if(o.isMesh)visible.push(o)});
      assert.ok(visible.length<=8,'bounded draws, no full forest in a buffer batch');
      for(const mesh of visible){
        assert.equal(mesh.frustumCulled,false);assert.deepEqual(mesh.geometry.drawRange,{start:0,count:3});
        if(mesh.isInstancedMesh)assert.equal(mesh.count,1);
        if(!seen.has(mesh))seen.set(mesh,new Set());seen.get(mesh).add(mesh.geometry);
      }
    }else shadowPasses++;
    render.call(this,scene);
  };
  const assertRestored=()=>{
    assert.deepEqual(f.snapshot(),before);assert.deepEqual(parent.children,originalOrder);
    entries.forEach(({mesh,geometries},i)=>{
      const s=snapshots[i];assert.equal(mesh.parent,s.parent);assert.equal(mesh.visible,s.visible);assert.equal(mesh.geometry,s.geometry);
      assert.equal(mesh.count,s.count);assert.equal(mesh.frustumCulled,s.frustumCulled);
      assert.deepEqual(mesh.matrix.toArray(),s.matrix);assert.deepEqual(mesh.matrixWorld.toArray(),s.world);
      assert.equal(mesh.matrixAutoUpdate,s.auto);assert.equal(mesh.matrixWorldAutoUpdate,s.worldAuto);assert.equal(mesh.matrixWorldNeedsUpdate,s.worldNeeds);
      assert.deepEqual(geometries.map(g=>g.drawRange),s.ranges);
    });
  };
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{preparationMeshes:entries,preflightBatchSize:8,yieldTask:async()=>assertRestored()});
  assert.equal(result.status,'ready');assertRestored();assert.equal(shadowPasses,1);assert.equal(result.bufferBatches,batchCalls);
  for(const {mesh,geometries} of entries)for(const geometry of geometries)assert.ok(seen.get(mesh)?.has(geometry),'every far index and offscreen patch was uploaded');
});

test('a detached-patch upload failure restores parent order, draw range and instance count before returning fallback',async()=>{
  const f=fixture(),parent=new THREE.Group();f.scene.add(parent);
  const a=new THREE.InstancedMesh(new THREE.BoxGeometry(),f.material,14),b=new THREE.Mesh(new THREE.PlaneGeometry(),f.material);
  parent.add(a,b);a.visible=false;a.geometry.setDrawRange(4,9);
  const detached=new THREE.InstancedMesh(new THREE.PlaneGeometry(),f.material,9),before=f.snapshot();
  const render=f.renderer.render;
  f.renderer.render=function(scene){render.call(this,scene);throw new Error('buffer upload failed')};
  const result=await prepareForestGpu(f.renderer,f.scene,f.camera,undefined,{preparationMeshes:[{mesh:a},{mesh:detached}],yieldTask:f.yieldTask});
  assert.equal(result.status,'fallback');assert.match(result.error,/buffer upload failed/);
  assert.deepEqual(parent.children,[a,b]);assert.equal(a.parent,parent);assert.equal(detached.parent,null);
  assert.equal(a.visible,false);assert.equal(a.count,14);assert.equal(detached.count,9);assert.deepEqual(a.geometry.drawRange,{start:4,count:9});
  assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.disposed,['target']);
});
