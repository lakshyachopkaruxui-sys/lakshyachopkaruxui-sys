import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {THREE,preload,mockAssets,GLTFLoader} from './shadow-test-fixture.mjs';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
const {WorldThree}=await import('../src/worlds/WorldThree.ts');
const {HELL_RIVERS,riverDistance}=await import('../src/worlds/HellLandscape.ts');
const {HELL_SKY_ASSET}=await import('../src/worlds/HellSky.ts');
const {HELL_CRAG_ASSET}=await import('../src/worlds/HellScenery.ts');
const {HELL_CELESTIAL_MAPS}=await import('../src/worlds/HellCelestial.ts');
await preload();

async function fixture(t,fail=false,skyFail=fail,cragFail=false) {
  mockAssets(t);
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if(String(url).startsWith('/models/hell/sky-life/')){
      const bytes=readFileSync(new URL('../public'+url,import.meta.url));
      return new Response(bytes,{status:200});
    }
    return originalFetch(url,options);
  });
  const modelUrls=[],load=GLTFLoader.prototype.load;
  t.mock.method(GLTFLoader.prototype,'load',function(url,onLoad,progress,onError){
    modelUrls.push(url);
    if(cragFail&&url===HELL_CRAG_ASSET){queueMicrotask(()=>onError?.(new Error('optional scan offline')));return;}
    return load.call(this,url,onLoad,progress,onError);
  });
  const requested=[],panoramas=[];
  t.mock.method(THREE.TextureLoader.prototype,'load',(url,onLoad,_progress,onError)=>{
    requested.push(url);const texture=new THREE.Texture();
    queueMicrotask(()=>fail?onError?.(new Error('offline')):onLoad?.(texture));return texture;
  });
  t.mock.method(HDRLoader.prototype,'loadAsync',async url=>{
    panoramas.push(url);
    if(skyFail)throw new Error('offline');
    return new THREE.DataTexture(new Uint16Array(4),1,1,THREE.RGBAFormat,THREE.HalfFloatType);
  });
  const world=new WorldThree(new THREE.Vector3());await world.ready;return {world,requested,panoramas,modelUrls};
}

test('hell keeps volcanic maps bounded, adds shared crater maps, preserves actors and fits geometry budget',async t=>{
  const {world,requested,panoramas}=await fixture(t);
  assert.equal(world.landscape.status,'ready');assert.equal(world.fauna.creatures.length,2);
  assert.equal(requested.length,10);
  assert.equal(requested.filter(url=>url.startsWith('/textures/hell/')).length,8);
  assert.equal(requested.filter(url=>url.startsWith('/models/hell/sky-life/')).length,2);
  assert.deepEqual(requested.filter(url=>url.includes('/celestial/')), [...HELL_CELESTIAL_MAPS]);
  assert.equal(world.landscape.celestial.status,'ready');
  assert.equal(world.skyLife.status,'ready');
  assert.deepEqual(world.skyLife.budget,{birds:7,triangles:11900,drawBatches:1,perFrameMatrixBytes:448,
    perFrameMorphWeightBytes:252,lights:0,shadowCasters:0});
  assert.deepEqual(panoramas,[HELL_SKY_ASSET]);
  assert.equal(world.scene.background,null,'sky must obey the tear stencil');
  assert.equal(world.scene.environment,null,'panorama must not introduce a PMREM conversion or alter actor lighting');
  assert.equal(world.root.getObjectByName('Crimson ash sky').userData.skyStatus,'ready');
  assert.equal(world.root.getObjectByName('photographic shadow woodland'),undefined);
  assert.equal(world.landscape.scenery.status,'ready');
  let triangles=0,draws=0,sceneryTriangles=0,sceneryDraws=0;
  let coneTriangles=0,craterTriangles=0,spillTriangles=0,celestialTriangles=0,otherTriangles=0,cones=0;
  world.landscape.root.traverse(o=>{if(!o.isMesh&&!o.isPoints)return;draws++;
    const count=o.isMesh?(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.count??1):0;
    let sceneryOwner=o;while(sceneryOwner&&sceneryOwner!==world.landscape.scenery.root)sceneryOwner=sceneryOwner.parent;
    if(sceneryOwner){sceneryTriangles+=count;sceneryDraws++;draws--;}
    else{
      triangles+=count;
      if(o.name==='Erupting Cinder Rift caldera'||o.name.startsWith('Distant volcanic escarpment ')){coneTriangles+=count;cones++;}
      else if(o.name.startsWith('Molten crater '))craterTriangles+=count;
      else if(o.name==='Caldera overflow')spillTriangles+=count;
      else if(o.name==='Near eclipsed iron planet'||o.name==='Second scorched moon')celestialTriangles+=count;
      else otherTriangles+=count;
    }
    assert.equal(o.castShadow,false,'environment must not add shadow draw passes');
  });
  assert.equal(cones,5);
  assert.ok(coneTriangles<=35000,`eroded mountain meshes: ${coneTriangles}`);
  assert.ok(craterTriangles<=512,`fitted caldera pools: ${craterTriangles}`);
  assert.ok(spillTriangles<=5000,`supported detailed overflow: ${spillTriangles}`);
  assert.equal(celestialTriangles,10496,'two smooth bodies have their own explicit geometry budget');
  assert.ok(otherTriangles<32000,`remaining original landscape: ${otherTriangles}`);
  assert.ok(draws<=24,draws);
  assert.ok(sceneryTriangles<=80000,sceneryTriangles);assert.equal(sceneryDraws,3);
  const scan=world.landscape.scenery.root.getObjectByName('Three photographed volcanic crags');
  assert.equal(scan.count,3);
  assert.equal(world.root.getObjectByName('Photographed fractures embedded in the caldera'),undefined);
  const report={environmentTriangles:triangles,environmentDrawBatches:draws,coneTriangles,craterTriangles,spillTriangles,celestialTriangles,otherTriangles,
    groundTriangles:world.islands[0].terrain.geometry.index.count/3,
    addedSceneryTriangles:sceneryTriangles,addedSceneryDrawBatches:sceneryDraws,
    addedCliffTriangles:0,addedCliffDrawBatches:0,
    totalEnvironmentTriangles:triangles+sceneryTriangles,totalEnvironmentDrawBatches:draws+sceneryDraws,
    creatures:world.fauna.creatures.length,skyLife:world.skyLife.budget,textures:requested,panoramas,scope:'Geometry budget, not measured GPU FPS.'};
  mkdirSync(new URL('../validation/hell-dread-2026-11-09/', import.meta.url), {recursive: true});
  writeFileSync(new URL('../validation/hell-dread-2026-11-09/budget.json',import.meta.url),JSON.stringify(report,null,2));
  t.diagnostic(JSON.stringify(report));
});

test('rivers face upward, block entry and leave arrival plus creature patrols clear',async t=>{
  const {world}=await fixture(t),mesh=world.root.getObjectByName('Branching molten rivers with moving black crust');
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1));c.fromBufferAttribute(p,index.getX(i+2));
    assert.ok(b.sub(a).cross(c.sub(a)).y>0,'lava faces sky');}
  assert.equal(world.collisions.queryLocal(0,0,.3,1.7,world.groundAt(0,0)),false);
  for(const actor of world.fauna.creatures)for(let i=0;i<actor.route.length;i++){
    const a=actor.route[i],b=actor.route[(i+1)%actor.route.length];
    const ignore=new Set(world.fauna.creatures.map(other=>other.id));
    for(let j=0;j<=20;j++){
      const x=THREE.MathUtils.lerp(a.x,b.x,j/20),z=THREE.MathUtils.lerp(a.z,b.z,j/20);
      assert.ok(riverDistance(x,z)>1.1);
      assert.equal(world.collisions.queryLocal(x,z,.70,actor.height,world.groundAt(x,z),ignore),false,
        `scenery must leave authored patrol clear at ${x},${z}`);
    }
  }
  for(const river of HELL_RIVERS){const [x,z]=river.points[1];assert.equal(world.collisions.queryLocal(x,z,.3,1.7,world.groundAt(x,z)),true);}
});

test('lava modes share registered source maps and time; particles and smoke obey portal stencil',async t=>{
  const {world}=await fixture(t),channel=world.landscape.lavaMaterial;
  const crater=world.root.getObjectByName('Molten crater 0').material;
  const fissure=world.root.getObjectByName('Hairline heat fractures in cooled walking shelf').material;
  const slope=world.root.getObjectByName('Caldera overflow').material;
  const materials=[channel,crater,fissure,slope],shaders=[];
  for(const [i,mode] of ['channel','crater','fissure','slope'].entries()){
    const material=materials[i];assert.ok(material.isMeshStandardMaterial);
    assert.equal(material.userData.lavaMode,mode);
    for(const property of ['map','normalMap','emissiveMap']){
      assert.ok(material[property]?.isTexture,`${mode} keeps its ${property}`);
      assert.equal(material[property],channel[property],`${mode} shares loaded ${property}`);
    }
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader,{});shaders.push(shader);
    assert.equal(shader.uniforms.hellTime,world.landscape.time,'all lava uses the same mutable time uniform');
  }
  assert.equal(new Set(materials.map(material=>material.customProgramCacheKey())).size,4,'mode-specific shaders cannot share an incompatible GPU program');
  assert.notEqual(slope,channel,'steep overflow uses one distinct downhill molten run');
  for(let i=0;i<5;i++)assert.equal(world.root.getObjectByName('Molten crater '+i).material,crater,'craters share one material');
  world.update(12,0);for(const shader of shaders)assert.equal(shader.uniforms.hellTime.value,12);
  world.stencilLayer=2;world.refreshStencil();
  world.root.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])assert.equal(m.stencilRef,2);});
  const fountain=world.root.getObjectByName('GPU volcanic fountain');
  const version=fountain.geometry.attributes.position.version;
  for(let i=0;i<100;i++)world.update(i/72,0);
  assert.equal(fountain.geometry.attributes.position.version,version,'no per-frame particle uploads');
});

test('volcanic material failure settles readiness while preserving terrain and creatures',async t=>{
  const {world}=await fixture(t,true);assert.equal(world.landscape.status,'fallback');
  assert.equal(world.root.getObjectByName('Crimson ash sky').userData.skyStatus,'fallback');
  assert.equal(world.fauna.status,'ready');assert.ok(Number.isFinite(world.groundAt(0,0)));
});

test('sky-only download failure keeps the lava, creatures and world entry available',async t=>{
  const {world,requested,panoramas}=await fixture(t,false,true);
  assert.equal(requested.length,10);assert.deepEqual(panoramas,[HELL_SKY_ASSET]);
  assert.equal(world.landscape.status,'fallback');
  assert.equal(world.root.getObjectByName('Crimson ash sky').userData.skyStatus,'fallback');
  assert.ok(world.root.getObjectByName('Branching molten rivers with moving black crust'));
  assert.equal(world.fauna.status,'ready');assert.equal(world.fauna.creatures.length,2);
  assert.ok(Number.isFinite(world.groundAt(0,0)));
});

test('optional scanned-rock failure does not prevent lava, creatures or world entry',async t=>{
  const {world}=await fixture(t,false,false,true);
  assert.equal(world.landscape.scenery.status,'fallback');
  assert.equal(world.landscape.status,'fallback');
  assert.equal(world.fauna.status,'ready');assert.equal(world.fauna.creatures.length,2);
  assert.equal(world.root.getObjectByName('Three photographed volcanic crags'),undefined);
  assert.ok(world.root.getObjectByName('Raised broken lava levees'));
  assert.ok(world.root.getObjectByName('Branching molten rivers with moving black crust'));
  assert.ok(Number.isFinite(world.groundAt(0,0)));
});

test('retired mountain patches allocate no mesh, model download or draw batch',async t=>{
  const {world,modelUrls}=await fixture(t);
  assert.equal(world.landscape.scenery.status,'ready');
  assert.equal(world.landscape.status,'ready');
  assert.equal(modelUrls.includes('/models/hell/rock-face-01/outcrop/outcrop.gltf'),false);
  assert.equal(world.root.getObjectByName('Embedded photographed mountain ledges'),undefined);
  assert.equal(world.root.getObjectByName('Photographed fractures embedded in the caldera'),undefined);
  assert.ok(world.root.getObjectByName('Three photographed volcanic crags'));
  assert.ok(world.root.getObjectByName('Branching molten rivers with moving black crust'));
  assert.equal(world.fauna.status,'ready');assert.equal(world.fauna.creatures.length,2);
  assert.ok(Number.isFinite(world.groundAt(0,0)));
});

test('downloaded volcanic assets match official archive hashes and remain 1K',()=>{
  const root=new URL('../public/textures/hell/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('SOURCE.json',root)));
  assert.equal(manifest.length,6);
  for(const asset of manifest){const bytes=readFileSync(new URL(asset.file,root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);assert.equal(asset.license,'CC0-1.0');
    assert.ok(asset.file.includes('1K'));assert.ok(bytes.length<3_000_000);
  }
});
