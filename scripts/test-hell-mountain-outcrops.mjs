import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THREE, GLTFLoader, actualAsset } from './shadow-test-fixture.mjs';
const { HellMountainOutcrops, HELL_OUTCROP_ASSET } = await import('../src/worlds/HellMountainOutcrops.ts');
const scan = await actualAsset(HELL_OUTCROP_ASSET);
const sites = Array.from({length:8},(_,i)=>({position:new THREE.Vector3(i*1.1,3+i*.3,-20-i*.4),
  normal:new THREE.Vector3(.2,.5,.8).normalize(),height:1.6+i*.13,yaw:i*.27}));
const sourceMaterial = () => new THREE.MeshStandardMaterial({map:new THREE.Texture(),normalMap:new THREE.Texture(),roughnessMap:new THREE.Texture()});

test('outcrop derivative contains valid reduced scan geometry, original UV/normal samples and no texture dependency',()=>{
  const folder=new URL('../public/models/hell/rock-face-01/outcrop/',import.meta.url);
  const doc=JSON.parse(readFileSync(new URL('outcrop.gltf',folder))),report=JSON.parse(readFileSync(new URL('SOURCE.json',folder)));
  assert.equal(doc.images,undefined);assert.equal(doc.textures,undefined);assert.equal(doc.materials,undefined);
  assert.equal(report.sourceTriangles,20174);assert.equal(report.runtimeTriangles,1800);assert.ok(report.relativeSimplifierError<.01);
  assert.deepEqual(report.runtimeBounds.min,report.sourceBounds.min);assert.deepEqual(report.runtimeBounds.max,report.sourceBounds.max);
  for(const entry of report.files){const bytes=readFileSync(new URL(entry.file,folder));assert.equal(bytes.length,entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
  const geometry=scan.scene.children[0].geometry;
  assert.equal(geometry.index.count/3,1800);assert.equal(geometry.attributes.position.count,1136);
  for(const attr of ['position','normal','uv'])for(const value of geometry.attributes[attr].array)assert.ok(Number.isFinite(value));
  for(const index of geometry.index.array)assert.ok(index<geometry.attributes.position.count);
  const sourceDoc=JSON.parse(readFileSync(new URL('../rock_face_01_1k.gltf',folder))),sourceBin=readFileSync(new URL('../rock_face_01.bin',folder));
  const primitive=sourceDoc.meshes[0].primitives[0],samples=new Set();
  const get=(index,vertex,size)=>{const a=sourceDoc.accessors[index],v=sourceDoc.bufferViews[a.bufferView],start=(v.byteOffset??0)+(a.byteOffset??0)+vertex*(v.byteStride??size*4);
    return Array.from({length:size},(_,i)=>sourceBin.readFloatLE(start+i*4));};
  for(let i=0;i<sourceDoc.accessors[primitive.attributes.POSITION].count;i++)samples.add([
    ...get(primitive.attributes.POSITION,i,3),...get(primitive.attributes.NORMAL,i,3),...get(primitive.attributes.TEXCOORD_0,i,2)].join(','));
  for(let i=0;i<geometry.attributes.position.count;i++){
    const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
    assert.ok(samples.has([p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i),uv.getX(i),uv.getY(i)].join(',')),
      'the derivative retains registered source position, normal and texture samples');
  }
});

test('eight ledges share one batch and caller textures while embedding in actual surface normals',async t=>{
  let finish,layer=1;
  t.mock.method(GLTFLoader.prototype,'loadAsync',url=>{assert.equal(url,HELL_OUTCROP_ASSET);return new Promise(resolve=>finish=resolve);});
  const parent=new THREE.Group(),material=sourceMaterial(),originalVersion=scan.scene.children[0].geometry.attributes.position.version;
  const outcrops=new HellMountainOutcrops(parent,sites,material,()=>layer);
  layer=2;finish(scan);await outcrops.ready;
  assert.equal(outcrops.status,'ready');assert.equal(outcrops.root.children.length,1);
  const mesh=outcrops.root.children[0];assert.equal(mesh.count,8);assert.equal(mesh.geometry.index.count/3*mesh.count,14400);
  assert.notEqual(mesh.material,material);assert.equal(mesh.material.map,material.map);
  assert.equal(mesh.material.normalMap,material.normalMap);assert.equal(mesh.material.roughnessMap,material.roughnessMap);
  assert.equal(mesh.material.stencilRef,2);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);
  assert.equal(scan.scene.children[0].geometry.attributes.position.version,originalVersion,'source geometry remains shared and unchanged');
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
  sites.forEach((site,index)=>{mesh.getMatrixAt(index,matrix);position.setFromMatrixPosition(matrix);
    const expected=site.position.clone().addScaledVector(site.normal,-site.height*.65);
    assert.ok(position.distanceTo(expected)<2e-6,'placement follows the owning mountain normal');
    assert.ok(Math.abs(new THREE.Vector3().setFromMatrixScale(matrix).y-site.height)<1e-6);
    assert.ok(new THREE.Vector3(0,1,0).transformDirection(matrix).distanceTo(site.normal)<2e-6,
      'the dominant photographed face follows the slope instead of exposing its back');
  });
  const original=scan.scene.children[0].geometry,p=mesh.geometry.attributes.position;
  original.computeBoundingBox();const box=original.boundingBox,h=box.max.y-box.min.y,center=box.getCenter(new THREE.Vector3());
  const halfWidth=(box.max.x-box.min.x)/h*.5,halfDepth=(box.max.z-box.min.z)/h*.5;
  let buriedBoundary=0,unmodifiedInterior=0;
  for(let i=0;i<p.count;i++){
    const x=(original.attributes.position.getX(i)-center.x)/h,z=(original.attributes.position.getZ(i)-center.z)/h;
    const boundary=Math.max(Math.abs(x)/halfWidth,Math.abs(z)/halfDepth)+.04*Math.sin(x*13+z*8)+.025*Math.sin(z*21-x*5);
    if(boundary>=.93){assert.ok(p.getY(i)<=.050001,'cut scan perimeter stays .60 heights inside mountain');buriedBoundary++;}
    if(boundary<=.60){assert.ok(Math.abs(p.getY(i)-(original.attributes.position.getY(i)-box.min.y)/h)<1e-6);unmodifiedInterior++;}
    assert.equal(mesh.geometry.attributes.uv.getX(i),original.attributes.uv.getX(i));
    assert.equal(mesh.geometry.attributes.uv.getY(i),original.attributes.uv.getY(i));
  }
  assert.ok(buriedBoundary>30);assert.ok(unmodifiedInterior>100,'photographed interior relief remains intact');
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  mesh.material.onBeforeCompile(shader,{});
  assert.ok(shader.fragmentShader.includes('ledgeLuminance'));assert.ok(shader.fragmentShader.includes('#include <normal_fragment_maps>'));
  assert.match(mesh.material.customProgramCacheKey(),/neutral-embedded-ledge-v3/);
  assert.equal(material.color.getHex(),0xffffff,'caller material remains unchanged');
  assert.deepEqual(outcrops.root.userData.budget,{triangles:14400,draws:1,instances:8,extraTextures:0,addedShadowPasses:0,sourceLicense:'CC0-1.0',status:'ready'});
  let disposed=0;for(const texture of [material.map,material.normalMap,material.roughnessMap])texture.addEventListener('dispose',()=>disposed++);
  outcrops.dispose();outcrops.dispose();assert.equal(disposed,0);assert.equal(outcrops.root.parent,null);
});

test('failed or disposed optional ledges never block readiness or attach late geometry',async t=>{
  let finish;
  t.mock.method(GLTFLoader.prototype,'loadAsync',()=>new Promise(resolve=>finish=resolve));
  const parent=new THREE.Group(),outcrops=new HellMountainOutcrops(parent,sites,sourceMaterial(),()=>1);
  outcrops.dispose();finish(scan);await assert.doesNotReject(outcrops.ready);
  assert.equal(outcrops.root.children.length,0);assert.equal(outcrops.root.parent,null);
  const failed=new HellMountainOutcrops(parent,[{...sites[0],height:NaN}],sourceMaterial(),()=>1);
  finish(scan);await failed.ready;assert.equal(failed.status,'fallback');assert.equal(failed.root.children.length,0);
  const empty=new HellMountainOutcrops(parent,[],sourceMaterial(),()=>1);await empty.ready;assert.equal(empty.status,'ready');
  assert.throws(()=>new HellMountainOutcrops(parent,[...sites,...sites],sourceMaterial(),()=>1),/ten instances/);
});
