import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
const root = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(name, context, next) {
    if (name.startsWith('.') && context.parentURL?.startsWith(root)) {
      const url = new URL(name + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(name, context);
  },
  load(url, context, next) {
    if (url.startsWith(root) && url.endsWith('.ts')) return { format: 'module',
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});
const { useForestBoxCulling } = await import('../src/worlds/ForestCulling.ts');
const { ForestShadowRefresh } = await import('../src/worlds/ForestShadowRefresh.ts');
const { forestLeafMaterial } = await import('../src/worlds/ForestLeafMaterial.ts');
const { applyWind } = await import('../src/worlds/props.ts');
const { EnvironmentalPresence, applyPlantPresence } = await import('../src/worlds/EnvironmentalPresence.ts');
const { forestGrassGeometries, applyForestGrassMorph } = await import('../src/worlds/ForestGrassGeometry.ts');
const { ForestFrameTiming } = await import('../src/worlds/ForestFrameTiming.ts');
const { ForestGrassWind } = await import('../src/worlds/ForestGrassWind.ts');

test('precomputed forest wind matches the original motion without per-vertex trigonometry', () => {
  const wind = new ForestGrassWind(), original = new THREE.MeshStandardMaterial();
  applyWind(original,{ value:0 },.045,1.25);
  const material = forestLeafMaterial(original); wind.apply(material);
  const shader = { uniforms:{}, vertexShader:THREE.ShaderLib.lambert.vertexShader, fragmentShader:THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader,{});
  assert.ok(!shader.vertexShader.includes('sin(uWindTime'));
  assert.ok(!shader.vertexShader.includes('cos(uWindTime'));
  assert.equal(shader.uniforms.uForestWindSin,wind.sine);
  const source = new THREE.PlaneGeometry(), mesh = new THREE.InstancedMesh(source,material,120);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i,matrix.makeTranslation(Math.sin(i*13.1)*52,0,Math.cos(i*9.3)*52));
  const far = source.clone(); far.setIndex([0,1,2]);
  const bound = wind.bind(mesh,far);
  assert.equal(bound.near.attributes.position,source.attributes.position,'do not duplicate scan vertices');
  assert.equal(bound.far.attributes.forestWindPhaseA,bound.near.attributes.forestWindPhaseA,'near/far share immutable phases');
  const phaseA = bound.near.attributes.forestWindPhaseA, phaseB = bound.near.attributes.forestWindPhaseB;
  for (let time = 0; time < 120; time += .71) {
    wind.update(time); const s = wind.sine.value, c = wind.cosine.value;
    for (let i = 0; i < mesh.count; i++) {
      const x = mesh.instanceMatrix.array[i*16+12], z = mesh.instanceMatrix.array[i*16+14];
      const gust = s.x*phaseA.getX(i)+c.x*phaseA.getY(i)+.45*(s.y*phaseA.getZ(i)+c.y*phaseA.getW(i))
        +.2*(s.z*phaseB.getX(i)+c.z*phaseB.getY(i));
      const expected = Math.sin(time*.9+x*.25+z*.2)+.45*Math.sin(time*2.3+z*.6)+.2*Math.sin(time*4.1+x*.9);
      assert.ok(Math.abs(gust-expected)<1e-6);
      assert.ok(Math.abs(c.w*phaseB.getZ(i)-s.w*phaseB.getW(i)-Math.cos(time*1.1+x*.4))<1e-6);
    }
  }
});

test('forest frame reporting uses wall time, including frames slower than the physics clamp', () => {
  const timing = new ForestFrameTiming();
  for (let i = 0; i <= 100; i++) timing.sample(i * 100, true);
  assert.equal(timing.fps,10); assert.equal(timing.p95Ms,100);
  timing.sample(10100,false); assert.equal(timing.samples,0);
  for (let i = 0; i <= 120; i++) timing.sample(11000 + i * 1000 / 60, true);
  assert.ok(Math.abs(timing.fps-60)<.01);
  timing.sample(16000,true); assert.equal(timing.samples,0,'ignore a suspended tab gap');
});

test('two-card and four-card grass retain atlas UVs, roots and tips with half the distant triangles', () => {
  const path = new URL('../public/models/forest/natural-grass/', import.meta.url);
  const doc = JSON.parse(readFileSync(new URL('grass.gltf', path)));
  const bytes = readFileSync(new URL('grass.bin', path));
  for (const mesh of doc.meshes) for (const cards of [2, 4]) {
    const geometry = new THREE.BufferGeometry(), primitive = mesh.primitives[0];
    for (const [semantic, name, size] of [['POSITION','position',3],['NORMAL','normal',3],['TEXCOORD_0','uv',2]]) {
      const accessor = doc.accessors[primitive.attributes[semantic]], view = doc.bufferViews[accessor.bufferView];
      const values = new Float32Array(accessor.count * size);
      for (let i = 0; i < values.length; i++) values[i] = bytes.readFloatLE((view.byteOffset || 0) + (accessor.byteOffset || 0) + i * 4);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 72 }, (_, i) => .8 + i / 200), 3));
    const index = doc.accessors[primitive.indices], indexView = doc.bufferViews[index.bufferView];
    const indexBytes = index.componentType === 5123 ? 2 : 4;
    geometry.setIndex(Array.from({ length: index.count }, (_, i) => bytes[indexBytes === 2 ? 'readUInt16LE' : 'readUInt32LE'](
      (indexView.byteOffset || 0) + (index.byteOffset || 0) + i * indexBytes)));
    geometry.computeBoundingBox();
    const { near, far } = forestGrassGeometries(geometry, cards);
    assert.equal(near.index.count / 3, cards * 4); assert.equal(far.index.count / 3, cards * 2);
    assert.ok([...near.index.array, ...far.index.array].every(i => i < cards * 6), 'only the selected source cards are submitted');
    assert.equal(far.attributes.position, near.attributes.position);
    assert.equal(far.attributes.uv, near.attributes.uv, 'retain original photographic atlas, without resampling');
    for (let card = 0; card < cards; card++) {
      const i = card * 6;
      assert.deepEqual([...far.index.array.slice(card * 6, card * 6 + 6)], [i,i+1,i+4,i+1,i+5,i+4]);
      for (const name of ['Position','Normal','Color']) for (let axis = 0; axis < 3; axis++) {
        const original = near.attributes[name.toLowerCase()], target = near.attributes['forestFar' + name];
        for (const row of [0,1,4,5]) assert.equal(target.getComponent(i + row,axis), original.getComponent(i + row,axis));
        for (const row of [2,3]) assert.ok(Math.abs(target.getComponent(i+row,axis) -
          (original.getComponent(i+row-2,axis)+original.getComponent(i+row+2,axis))*.5)<1e-6);
      }
    }
  }
});

test('continuous grass morph preserves lighting, colour, wind, presence and every fragment', () => {
  const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest:.45, vertexColors:true, side:THREE.DoubleSide });
  const time = { value: 1 }, presence = new EnvironmentalPresence(), viewer = { value: new THREE.Vector3() };
  applyWind(source,time,.045,1.25); applyPlantPresence(source,presence,1.8,.1);
  const material = forestLeafMaterial(source);
  const before = { uniforms:{}, vertexShader:THREE.ShaderLib.lambert.vertexShader, fragmentShader:THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(before,{});
  applyForestGrassMorph(material,viewer);
  const after = { uniforms:{}, vertexShader:THREE.ShaderLib.lambert.vertexShader, fragmentShader:THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(after,{});
  assert.equal(after.fragmentShader,before.fragmentShader,'no distance discard, colour grade or lighting change');
  assert.equal(after.uniforms.uForestGrassViewer,viewer);
  assert.equal(after.uniforms.uWindTime,time);
  assert.equal(after.uniforms.uPresencePosition,presence.position);
  assert.ok(after.vertexShader.includes('smoothstep(6.0, 12.0,'));
  assert.ok(after.vertexShader.includes('vColor.rgb *= mix(color, forestFarColor, forestGrassMorph);'));
  assert.ok(after.vertexShader.indexOf('transformed = mix(position') < after.vertexShader.indexOf('float gust ='), 'wind follows the continuous shape');
  assert.equal(material.alphaTest,.45);
});

test('forest box culling retains plants for either eye after world translation and rotation', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.5, .8, .5), new THREE.MeshBasicMaterial(), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, .4, -4));
  const parent = new THREE.Group(); parent.position.set(12, .2, -8); parent.rotation.y = .73; parent.add(mesh);
  parent.updateMatrixWorld(true); useForestBoxCulling(mesh);
  const target = parent.localToWorld(new THREE.Vector3(0, .4, -4));
  const eye = (x, reverse) => {
    const camera = new THREE.PerspectiveCamera(90, 1, .05, 50);
    camera.position.copy(parent.localToWorld(new THREE.Vector3(x, 1.5, 0)));
    camera.lookAt(reverse ? camera.position.clone().multiplyScalar(2).sub(target) : target);
    camera.updateMatrixWorld(); return camera;
  };
  const left = eye(-.032, true), right = eye(.032, false), camera = new THREE.ArrayCamera([left, right]);
  const stereo = new THREE.FrustumArray().setFromArrayCamera(camera);
  assert.equal(mesh.intersectsFrustum(stereo), true, 'one eye is enough to retain a batch');
  camera.cameras = [left, eye(.032, true)]; stereo.setFromArrayCamera(camera);
  assert.equal(mesh.intersectsFrustum(stereo), false, 'only batches outside both eyes may be skipped');
  for (const x of [-.25,.25]) for (const y of [0,.8]) for (const z of [-4.25,-3.75])
    assert.ok(mesh.userData.forestCullBounds.containsPoint(new THREE.Vector3(x,y,z)));
});

test('moving cover pools reuse their live culling bounds', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  const bounds = new THREE.Box3(new THREE.Vector3(-1,-1,-5), new THREE.Vector3(1,1,-3));
  useForestBoxCulling(mesh, bounds); mesh.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(70,1,.1,40); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix);
  assert.equal(mesh.intersectsFrustum(frustum), true);
  bounds.translate(new THREE.Vector3(100,0,0));
  assert.equal(mesh.intersectsFrustum(frustum), false);
});

test('forest shadow cache refreshes at 30 Hz, invalidates immediately, and does not affect another light', () => {
  const sun = new THREE.DirectionalLight(), other = new THREE.DirectionalLight();
  const refresh = new ForestShadowRefresh(sun.shadow); let draws = 0;
  for (let frame=0;frame<120;frame++) {
    refresh.update(frame/60);
    if (sun.shadow.needsUpdate) { draws++; sun.shadow.needsUpdate=false; }
  }
  assert.equal(draws,60);
  refresh.invalidate(); assert.equal(sun.shadow.needsUpdate,true);
  sun.shadow.needsUpdate=false; refresh.update(2); assert.equal(sun.shadow.needsUpdate,true);
  assert.equal(other.shadow.autoUpdate,true); assert.equal(other.shadow.needsUpdate,false);
});

test('static forest shadow renders once and refreshes only after explicit invalidation', () => {
  const sun = new THREE.DirectionalLight(), other = new THREE.DirectionalLight();
  const refresh = new ForestShadowRefresh(sun.shadow, 0);
  assert.equal(sun.shadow.autoUpdate, false);
  assert.equal(sun.shadow.needsUpdate, true, 'initial asset load needs one shadow render');
  sun.shadow.needsUpdate = false;
  for (let frame = 0; frame < 1200; frame++) {
    refresh.update(frame / 60);
    assert.equal(sun.shadow.needsUpdate, false, 'walking and turning must reuse the cached map');
  }
  for (let alignment = 0; alignment < 3; alignment++) {
    refresh.invalidate();
    assert.equal(sun.shadow.needsUpdate, true, 'world alignment or completed asset loading refreshes the map');
    sun.shadow.needsUpdate = false;
    refresh.update(25 + alignment);
    assert.equal(sun.shadow.needsUpdate, false, 'no recurring shadow work after the requested redraw');
  }
  assert.equal(other.shadow.autoUpdate, true);
  assert.equal(other.shadow.needsUpdate, false);
});

test('matte leaf shading preserves source atlas, cutout, wind, presence and stencil support', () => {
  const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), color: 0xd7efba,
    alphaTest:.45, side:THREE.DoubleSide, vertexColors:true, emissive:0xffffff, emissiveIntensity:.13 });
  source.emissiveMap = source.map;
  const time = { value: 2 }, presence = new EnvironmentalPresence();
  applyWind(source,time,.045,1.25); applyPlantPresence(source,presence,1.8,.1);
  const material = forestLeafMaterial(source), shader = { uniforms:{},
    vertexShader:THREE.ShaderLib.lambert.vertexShader, fragmentShader:THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader,{});
  assert.equal(material.map,source.map); assert.equal(material.alphaTest,source.alphaTest);
  assert.equal(material.side,source.side); assert.deepEqual(material.color,source.color);
  assert.equal(shader.uniforms.uWindTime,time); assert.equal(shader.uniforms.uPresencePosition,presence.position);
  assert.equal(material.emissiveMap,null,'reuse the decoded colour sample instead of a duplicate atlas lookup');
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance *= sampledDiffuseColor.rgb'));
  assert.ok(shader.fragmentShader.includes('#include <shadowmap_pars_fragment>'));
  assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'), 'retain native diffuse sky illumination');
  assert.ok(!shader.fragmentShader.includes('#define STANDARD'));
  assert.equal(source.emissiveMap,source.map,'source material is unchanged');
});

test('balanced forest meshes compact buffers while preserving textures, source vertices and root metadata', () => {
  const folder = new URL('../public/models/forest/balanced/',import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('SOURCE.json',folder)));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const values = (doc, bins, index) => {
    const a=doc.accessors[index], view=doc.bufferViews[a.bufferView], data=bins[view.buffer];
    const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const [size,read]={5121:[1,'readUInt8'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']}[a.componentType];
    const offset=(view.byteOffset||0)+(a.byteOffset||0), stride=view.byteStride||width*size;
    return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,k)=>data[read](offset+i*stride+k*size)));
  };
  let oldTriangles=0,newTriangles=0,oldBytes=0,newBytes=0,rootSamples=0;
  for (const asset of manifest.assets) {
    const sourceFile=new URL('../'+asset.source,folder), original=readFileSync(sourceFile);
    assert.equal(hash(original),asset.sourceSHA256);
    const raw = readFileSync(new URL(asset.name+'.gltf',folder)), doc = JSON.parse(raw);
    assert.equal(hash(raw),asset.gltfSHA256);
    const bin=readFileSync(new URL(asset.name+'.bin',folder));
    assert.equal(hash(bin),asset.bufferSHA256);
    const glb = asset.source.endsWith('.glb');
    const source = JSON.parse(glb ? original.subarray(20,20+original.readUInt32LE(12)) : original);
    const sourceBins=glb?[original.subarray(28+original.readUInt32LE(12))]:source.buffers.map(b=>readFileSync(new URL(b.uri,sourceFile)));
    for (let i=0;i<(source.images??[]).length;i++) {
      const before=source.images[i],after=doc.images[i];
      if (before.bufferView!==undefined) {
        const a=source.bufferViews[before.bufferView],b=doc.bufferViews[after.bufferView];
        assert.deepEqual(bin.subarray(b.byteOffset||0,(b.byteOffset||0)+b.byteLength),
          sourceBins[a.buffer].subarray(a.byteOffset||0,(a.byteOffset||0)+a.byteLength),'embedded image bytes are unchanged');
      } else assert.equal(new URL(after.uri,folder).href,new URL(before.uri,sourceFile).href,'reuse the original external texture');
    }
    let triangles=0;
    for(let i=0;i<source.meshes.length;i++)for(let j=0;j<source.meshes[i].primitives.length;j++) {
      const before=source.meshes[i].primitives[j],after=doc.meshes[i].primitives[j];
      assert.equal(after.material,before.material);
      const semantics=Object.keys(before.attributes);
      assert.deepEqual(Object.keys(after.attributes),semantics);
      const oldAttributes=semantics.map(s=>values(source,sourceBins,before.attributes[s]));
      const newAttributes=semantics.map(s=>values(doc,[bin],after.attributes[s]));
      const originalVertices=new Set(oldAttributes[0].map((_,k)=>oldAttributes.flatMap(a=>a[k]).join(',')));
      for (let k=0;k<newAttributes[0].length;k++) {
        const vertex=newAttributes.flatMap(a=>a[k]);
        assert.ok(vertex.every(Number.isFinite));
        assert.ok(originalVertices.has(vertex.join(',')),'retained UV, normal and position tuples must remain exact source samples');
      }
      const indices=values(doc,[bin],after.indices).flat();
      assert.ok(indices.every(k=>Number.isInteger(k)&&k>=0&&k<newAttributes[0].length));
      triangles+=indices.length/3;
      const record=asset.meshes.find(m=>m.name===doc.meshes[i].name && m.material===doc.materials[after.material].name);
      assert.ok(record.relativeError<=record.errorLimit+1e-7);
      if (record.rootCollarLocked) {
        const oldPositions=values(source,sourceBins,before.attributes.POSITION),newPositions=values(doc,[bin],after.attributes.POSITION);
        const retained=new Set(newPositions.map(p=>p.join(','))),low=record.beforeBounds[0][1];
        for (const point of oldPositions) if (point[1]<low+1.6) {
          assert.ok(retained.has(point.join(',')),'original root and lower-trunk samples remain available for collider seating');
          rootSamples++;
        }
        assert.deepEqual(record.afterBounds,record.beforeBounds,'tree bounds retain their original envelope');
      }
    }
    assert.equal(triangles,asset.balancedTriangles);
    assert.ok(triangles<=asset.previousRuntimeTriangles*.61,'each kit asset meaningfully reduces runtime geometry');
    oldTriangles+=asset.previousRuntimeTriangles;newTriangles+=triangles;
    oldBytes+=asset.previousRuntimeBufferBytes;newBytes+=bin.length;
  }
  assert.ok(rootSamples>5000,'exercise real retained conifer seating samples');
  assert.ok(newTriangles<oldTriangles*.5,'the balanced kit must halve total geometry against the previous runtime kit');
  assert.ok(newBytes<oldBytes*.75,'compaction must remove unused vertex uploads, not only triangle indices');
});


test('tree and fern wind precomputes bend while preserving visible and depth shader motion', () => {
  for (const [strength, stiffness] of [[.002, 1.7], [.0004, 1.7], [.055, 1.3]]) {
    const wind = new ForestGrassWind(), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,-.2,0, 1,0,1, 0,.7,0, 1,18.2,1],3));
    wind.prepareBend(geometry, stiffness);
    const weights = geometry.getAttribute('forestBendWeight');
    for (let i = 0; i < weights.count; i++) {
      const expected = Math.pow(Math.max(geometry.attributes.position.getY(i),0),stiffness);
      assert.ok(Math.abs(weights.getX(i)-expected) <= Math.max(1,expected)*1e-7);
    }
    for (const material of [new THREE.MeshStandardMaterial(), new THREE.MeshDepthMaterial()]) {
      applyWind(material,{value:0},strength,stiffness);
      wind.apply(material,true);
      applyPlantPresence(material,new EnvironmentalPresence(),2.2,.18);
      const library = material.isMeshDepthMaterial ? THREE.ShaderLib.depth : THREE.ShaderLib.standard;
      const shader = { uniforms:{}, vertexShader:library.vertexShader, fragmentShader:library.fragmentShader };
      material.onBeforeCompile(shader,{});
      assert.ok(shader.vertexShader.includes('float bend = forestBendWeight *'));
      assert.ok(!shader.vertexShader.includes('pow(height'));
      assert.ok(!shader.vertexShader.includes('sin(uWindTime'));
      assert.ok(!shader.vertexShader.includes('cos(uWindTime'));
      const mesh = new THREE.InstancedMesh(geometry,material,1);
      mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(5,0,-9));
      wind.bind(mesh);
      assert.equal(mesh.geometry.getAttribute('forestBendWeight'),weights);
      assert.equal(mesh.geometry.getAttribute('position'),geometry.getAttribute('position'));
    }
  }
});
