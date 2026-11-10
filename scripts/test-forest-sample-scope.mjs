import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes, createRequire } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Compare against the actual pre-sample source. Its relative imports resolve
// beside the current WorldTwo, so this is a saved-world regression fixture.
const sourceRoot = new URL('../src/', import.meta.url).href;
const baselineURL = new URL('../src/worlds/WorldTwo.sample-baseline.ts', import.meta.url).href;
const baselineSource = new URL('../validation/forest-sample-2026-10-17/before/WorldTwo.ts', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'tear:forest-before-sample') return { url: baselineURL, shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module',
      source: stripTypeScriptTypes(readFileSync(url === baselineURL ? baselineSource : new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
};
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const gradient = { addColorStop() {} };
    const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient,
      measureText: text => ({ width: String(text).length * 8 }) },
    { get: (target, key) => key in target ? target[key] : () => {} });
    return { width: 1, height: 1, getContext: () => context };
  }
};

const baselineAssetRequests = new Set();
let recordingBaseline = false;
let rejectNewAssets = false;
THREE.TextureLoader.prototype.load = function (_url, onLoad) {
  const texture = new THREE.Texture();
  queueMicrotask(() => onLoad?.(texture));
  return texture;
};
HDRLoader.prototype.loadAsync = async () => new THREE.DataTexture();
GLTFLoader.prototype.loadAsync = async function (url) {
  if (recordingBaseline) baselineAssetRequests.add(url);
  if (rejectNewAssets && !baselineAssetRequests.has(url)) throw new Error('Intentional sample-only asset failure');
  const file = new URL('../public' + url, import.meta.url);
  const raw = readFileSync(file);
  let data, binary;
  if (url.endsWith('.glb')) {
    const jsonLength = raw.readUInt32LE(12);
    data = JSON.parse(raw.subarray(20, 20 + jsonLength));
    binary = raw.subarray(28 + jsonLength);
  } else data = JSON.parse(raw);
  for (const buffer of data.buffers ?? []) buffer.uri = 'data:application/octet-stream;base64,' +
    (buffer.uri ? readFileSync(new URL(buffer.uri, file)) : binary).toString('base64');
  // Actual geometry, transforms and materials are parsed. Only image decoding
  // is replaced; this does not test rendered appearance or headset frame time.
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'NODE_SCOPE_TEXTURES', loadTexture() {
    const texture = new THREE.Texture(); texture.flipY = false;
    return Promise.resolve(texture);
  } }));
  return loader.parseAsync(JSON.stringify(data), '');
};

const { WorldTwo: BeforeWorldTwo } = await import('tear:forest-before-sample');
const { WorldTwo } = await import('../src/worlds/WorldTwo.ts');
const { sampleSoilAt } = await import('../src/worlds/ForestSampleGround.ts');
const { sampleReliefAt } = await import('../src/worlds/ForestSampleSurface.ts');
const { SAMPLE_COLONIES } = await import('../src/worlds/ForestSampleLayout.ts');
const { FOREST_COVER_BUDGET, FOREST_COVER_XR_BUDGET } = await import('../src/worlds/ForestUnderstory.ts');
const { forestCoverAt } = await import('../src/worlds/ForestHabitat.ts');
const { forestPondShore } = await import('../src/worlds/ForestPond.ts');
const inside = (x, z) => x >= 1.5 && x <= 6.5 && z >= -4.5 && z <= .5;
const legacyNames = ['Low woodland sedges along the trail', 'Weathered woodland stones'];
let worlds;
async function fixtures() {
  if (worlds) return worlds;
  recordingBaseline = true;
  const before = new BeforeWorldTwo(new THREE.Vector3());
  await before.ready;
  recordingBaseline = false;
  const after = new WorldTwo(new THREE.Vector3());
  await after.ready;
  await after.groundSample.ready;
  assert.equal(after.groundSample.status, 'ready', 'the real acquired sample assets must load');
  return worlds = { before, after };
}

function instances(mesh) {
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  return Array.from({ length: mesh.count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    if (mesh.instanceColor) mesh.getColorAt(index, color);
    return { matrix: matrix.toArray(), color: mesh.instanceColor ? color.toArray() : null };
  });
}
function outsideInstances(mesh) { return instances(mesh).filter(({ matrix }) => !inside(matrix[12], matrix[14])); }
function horizontalInstances(values) { return values.map(value => ({ ...value, matrix: value.matrix.map((v, i) => i === 13 ? 0 : v) })); }
function horizontalObstacle({ minY, maxY, ...rest }) { return rest; }
function assertPondShoreBlocked(world) {
  assert.ok(world.collisions.obstacles.has('forest-pond'));
  const ignore = new Set([...world.collisions.obstacles.keys()].filter(id => id !== 'forest-pond'));
  for (const at of forestPondShore((x, z) => world.groundHeight(x, z)))
    assert.ok(world.collisions.queryLocal(at.x, at.z, .01, 1.7, 0, ignore),
      'the pond collider must contain the current terrain shoreline independently of other obstacles');
}
function arrayHash(array) {
  return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
}
function geometrySnapshot(geometry) {
  return Object.fromEntries(Object.entries({ ...geometry.attributes, index: geometry.index })
    .filter(([, value]) => value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, arrayHash(value.array ?? value.data.array)]));
}
function materialSnapshot(material) {
  if (Array.isArray(material)) return material.map(materialSnapshot);
  return { type: material.type, name: material.name, color: material.color?.toArray(),
    roughness: material.roughness, metalness: material.metalness, normalScale: material.normalScale?.toArray(),
    opacity: material.opacity, side: material.side, transparent: material.transparent,
    alphaTest: material.alphaTest, envMapIntensity: material.envMapIntensity };
}
function groundShader(world) {
  const material = world.root.getObjectByName('Continuous forest floor').material;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  return { material, shader };
}
function unaffectedSnapshot(world) {
  const result = [];
  world.root.updateMatrixWorld(true);
  const visit = object => {
    if (object === world.groundSample?.root) return;
    if ((object.isMesh || object.isPoints) && !legacyNames.includes(object.name)) result.push(JSON.stringify({
      name: object.name, type: object.type, matrix: object.matrixWorld.toArray(),
      visible: object.visible, geometry: geometrySnapshot(object.geometry),
      instances: object.isInstancedMesh ? instances(object) : undefined,
      material: materialSnapshot(object.material)
    }));
    for (const child of object.children) visit(child);
  };
  visit(world.root);
  return result.sort();
}

test('forest rollout preserves existing grass and stone horizontal placement for fallback', async () => {
  const { before, after } = await fixtures();
  for (const name of legacyNames) {
    const original = before.root.getObjectByName(name), current = after.root.getObjectByName(name);
    assert.ok(original?.isInstancedMesh && current?.isInstancedMesh, name);
    const expected = outsideInstances(original);
    assert.ok(expected.length > 0);
    assert.deepEqual(horizontalInstances(instances(current)), horizontalInstances(expected),
      `${name}: only ground contact height may change outside the approved patch`);
  }
});

test('forest rollout preserves trees, ferns, sound positions, motes and walking bounds', async () => {
  const { before, after } = await fixtures();
  assert.deepEqual(after.conifers.spots, before.conifers.spots);
  assert.equal(after.scannedDetails.root.children.length, before.scannedDetails.root.children.length);
  assert.deepEqual(geometrySnapshot(after.motes.geometry), geometrySnapshot(before.motes.geometry));
  assert.deepEqual(after.perchLocal, before.perchLocal);
  assert.deepEqual(after.soundSpots, before.soundSpots);
  assert.deepEqual(after.walkBounds, before.walkBounds);
  assert.deepEqual(after.nextSeamHint, before.nextSeamHint);
});

test('approved sample source geometry stays bounded and grass uses cutouts without extra shadow passes', async t => {
  const { after } = await fixtures();
  let triangles = 0, drawMeshes = 0, grass = 0;
  after.groundSample.root.traverse(object => {
    if (!object.isMesh) return;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    drawMeshes++;
    assert.equal(Array.isArray(object.material), false, 'one material per sample batch');
    if (!object.name.startsWith('Forest sample grass_')) return;
    grass += object.count;
    assert.equal(object.isInstancedMesh, true);
    assert.equal(object.material.transparent, false, 'cutout grass must not use sorted transparent blending');
    assert.ok(object.material.alphaTest >= .4 && object.material.alphaTest <= .6);
    assert.equal(object.material.depthWrite, true);
    assert.equal(object.castShadow, false, 'dense ground cover must not add a shadow submission');
  });
  assert.ok(triangles > 0 && triangles <= 600_000, `${triangles} actual submitted triangles`);
  assert.ok(drawMeshes > 0 && drawMeshes <= 12, `${drawMeshes} actual draw meshes`);
  assert.ok(grass >= 680 && grass <= 720);
  assert.equal(after.groundSample.stats.triangles, triangles);
  assert.equal(after.groundSample.stats.drawMeshes, drawMeshes);
  assert.equal(after.groundSample.stats.grass, grass);
  t.diagnostic(`${grass} grass clumps, ${triangles} triangles, ${drawMeshes} meshes; static budget only, not a headset frame-time measurement.`);
});

test('raised sample ground matches foot contact throughout its actual triangles and preserves outside heights', async () => {
  const { before, after } = await fixtures();
  const surface = after.groundSample.root.getObjectByName('Forest sample moss and pine litter relief');
  assert.ok(surface?.isMesh);
  const p = surface.geometry.attributes.position, index = surface.geometry.index;
  const point = new THREE.Vector3(), vertex = new THREE.Vector3();
  let maxRise = 0;
  for (let i = 0; i < index.count; i += 3) {
    point.set(0, 0, 0);
    for (let j = 0; j < 3; j++) point.add(vertex.fromBufferAttribute(p, index.getX(i + j)));
    point.multiplyScalar(1 / 3);
    assert.ok(Math.abs(after.groundHeight(point.x, point.z) - point.y) < 1e-6,
      'walking height must follow rendered triangles, including between vertices');
    maxRise = Math.max(maxRise, point.y - after.terrain.heightAt(point.x, point.z));
  }
  assert.ok(maxRise > .06 && maxRise < .11, 'relief must be visible but remain shallow');
  for (let i = 0; i <= 100; i++) {
    const t = i / 100 * 5;
    for (const [x, z] of [[1.5, -4.5 + t], [6.5, -4.5 + t], [1.5 + t, -4.5], [1.5 + t, .5]]) {
      assert.equal(sampleReliefAt(x, z), 0);
      assert.ok(Math.abs(after.groundHeight(x, z) - after.terrain.heightAt(x, z)) < .004,
        'fine-grid boundary must remain seated within four millimetres of the original floor');
    }
  }
  for (let x = -10; x <= 12; x += .25) for (let z = -14; z <= 8; z += .25)
    if (!inside(x, z)) assert.equal(after.groundHeight(x, z), after.terrain.heightAt(x, z));
});

test('sample litter blends all material channels and retains the ground shader hooks', async () => {
  const { after } = await fixtures();
  const material = after.groundSample.root.getObjectByName('Forest sample moss and pine litter relief').material;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.equal((shader.fragmentShader.match(/float sampleWeight =/g) ?? []).length, 1);
  for (const key of ['sampleLitterColor', 'sampleLitterNormal', 'sampleLitterARM']) {
    assert.ok(shader.uniforms[key].value.isTexture);
    assert.ok(shader.fragmentShader.includes(`texture2D(${key},forestXZ/1.5)`));
  }
  assert.ok(shader.vertexShader.includes('vForestLocal = position;'));
  assert.ok(shader.fragmentShader.includes('forestMix = mix(forestMix,max(forestMix,sampleSoil),sampleWeight);'));
});

test('soil mask leaves every outside and boundary point unchanged with a smooth inward fade', () => {
  const outside = [[0, 0], [1.49999, -2], [6.50001, -2], [4, -4.50001], [4, .50001], [-100, 100]];
  for (const [x, z] of outside) assert.equal(sampleSoilAt(x, z).weight, 0);
  for (let i = 0; i <= 50; i++) {
    const t = i / 50 * 5;
    for (const [x, z] of [[1.5, -4.5 + t], [6.5, -4.5 + t], [1.5 + t, -4.5], [1.5 + t, .5]])
      assert.equal(sampleSoilAt(x, z).weight, 0, 'sample border cannot modify a ground fragment');
  }
  const inward = [0, .001, .05, .15, .225, .35, .449, .45, .6]
    .map(distance => sampleSoilAt(1.5 + distance, -2).weight);
  assert.ok(inward.every((weight, i) => weight >= 0 && weight <= 1 && (i === 0 || weight >= inward[i - 1])));
  assert.ok(inward[1] > 0 && inward[1] < .001, 'boundary must fade gradually');
  assert.ok(Math.abs(inward[4] - .5) < 1e-12);
  assert.equal(inward.at(-1), 1);
});

test('soil exposure varies across the sample and preserves moss beneath planting colonies', () => {
  const samples = [];
  for (let x = 2; x <= 6; x += .125) for (let z = -4; z <= 0; z += .125) {
    const sample = sampleSoilAt(x, z);
    assert.ok(Number.isFinite(sample.soil) && sample.soil >= .42 && sample.soil <= .84);
    samples.push(sample.soil);
  }
  assert.ok(Math.max(...samples) - Math.min(...samples) >= .2, 'avoid a flat brown rectangle');
  for (const colony of SAMPLE_COLONIES) assert.ok(sampleSoilAt(colony.x, colony.z).soil < .55,
    'living colonies retain more moss than exposed ground');
  assert.ok(sampleSoilAt(5.7, -2).soil > .70, 'the gap between colonies exposes organic soil');
});

test('sample soil wraps the existing floor shader and shares one blend with color, normals and roughness', async () => {
  const { before, after } = await fixtures();
  const original = groundShader(before), current = groundShader(after);
  assert.equal(current.shader.vertexShader, original.shader.vertexShader, 'no terrain or coordinate changes');
  for (const key of ['forestLitterColor', 'forestLitterNormal', 'forestLitterARM'])
    assert.ok(current.shader.uniforms[key]?.value.isTexture, 'forest rollout shares the approved litter textures');
  for (const key of Object.keys(original.shader.uniforms)) {
    const a = original.shader.uniforms[key].value, b = current.shader.uniforms[key].value;
    assert.equal(b.isTexture, a.isTexture);
    if (a.isTexture) assert.deepEqual(b.repeat, a.repeat);
  }
  const fragment = current.shader.fragmentShader;
  assert.equal((fragment.match(/float forestMix =/g) ?? []).length, 1);
  const localBlend = fragment.indexOf('forestMix = mix(forestMix,max(forestMix,sampleSoil),sampleWeight);');
  assert.ok(localBlend > 0 && fragment.includes('if (sampleWeight > 0.0)'), 'only positive sample coverage changes the existing blend');
  for (const marker of ['diffuseColor.rgb = mix(mossColor, soilColor, forestMix);',
    'roughnessFactor = clamp(mix(roughnessFactor,', 'vec3 mapN = normalize(mix('])
    assert.ok(fragment.indexOf(marker) > localBlend, 'soil coverage must affect all three material channels coherently');
  assert.ok(current.material.customProgramCacheKey().startsWith(original.material.customProgramCacheKey() + '|'));
  assert.ok(current.material.userData.forestSampleSoil);
});

test('sample asset silhouettes stay within 5 x 5 metres and solid support points touch terrain', async () => {
  const { after } = await fixtures();
  const matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
  let checked = 0, solid = 0;
  after.groundSample.root.traverse(object => {
    if (!object.isInstancedMesh) return;
    const p = object.geometry.attributes.position;
    object.geometry.computeBoundingBox();
    const height = object.geometry.boundingBox.getSize(new THREE.Vector3()).y;
    for (let instance = 0; instance < object.count; instance++) {
      object.getMatrixAt(instance, matrix);
      assert.ok(matrix.elements.every(Number.isFinite));
      assert.ok(matrix.determinant() > 0, 'no zero-scale hidden leftovers or inverted instances');
      let maxSupportSeparation = -Infinity;
      for (let i = 0; i < p.count; i++) {
        vertex.fromBufferAttribute(p, i).applyMatrix4(matrix);
        assert.ok(vertex.x >= 1.5 - 1e-6 && vertex.x <= 6.5 + 1e-6
          && vertex.z >= -4.5 - 1e-6 && vertex.z <= .5 + 1e-6, `${object.name}: geometry crosses the sample boundary`);
        if (p.getY(i) < height * .18)
          maxSupportSeparation = Math.max(maxSupportSeparation, vertex.y - after.groundHeight(vertex.x, vertex.z));
      }
      if (!object.name.startsWith('Forest sample grass_')) {
        assert.ok(maxSupportSeparation <= .00001 && maxSupportSeparation >= -.04,
          `${object.name}: support separation ${maxSupportSeparation}m must make intentional ground contact`);
        solid++;
      }
      checked++;
    }
  });
  assert.ok(checked >= 100 && solid >= 2);
});

test('single ground contact layer follows source terrain and remains transparent at its boundary', async () => {
  const { after } = await fixtures();
  const mesh = after.groundSample.root.getObjectByName('Forest sample ground contact shading');
  assert.ok(mesh?.isMesh);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.ok(mesh.material.opacity <= .45);
  const { data, width, height } = mesh.material.map.image;
  assert.ok(width <= 256 && height <= 256, 'contact texture has a bounded allocation');
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
      assert.equal(data[(y * width + x) * 4 + 3], 0, 'clamped edge texels must not darken anything outside the sample');
  }
  assert.equal(mesh.material.map.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(mesh.material.map.wrapT, THREE.ClampToEdgeWrapping);
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++)
    assert.ok(Math.abs(p.getY(i) - after.groundHeight(p.getX(i), p.getZ(i)) - .003) < 1e-6,
      'contact shading must follow the actual terrain triangles');
});

test('sample retains solid collision footprints and updates pond protection to the actual shoreline', async () => {
  const { before, after } = await fixtures();
  for (const [id, original] of before.collisions.obstacles) {
    if (id === 'forest-pond') continue; // The optimized terrain changes the sampled shoreline.
    const replaceable = id.startsWith('forest-stone-') && inside(original.points[0].x, original.points[0].z);
    if (replaceable) assert.equal(after.collisions.obstacles.has(id), false, `${id}: hidden rock must not leave an invisible obstacle`);
    else assert.deepEqual(horizontalObstacle(after.collisions.obstacles.get(id)), horizontalObstacle(original),
      `${id}: preserve existing horizontal collision footprint while reseating its height`);
  }
  assertPondShoreBlocked(after);
  for (const [id, obstacle] of after.collisions.obstacles) {
    if (before.collisions.obstacles.has(id)) continue;
    if (id.startsWith('forest-cover-rock-')) continue; // Authorized forest-wide additions are checked below.
    assert.ok(obstacle.minX >= 1.5 && obstacle.maxX <= 6.5 && obstacle.minZ >= -4.5 && obstacle.maxZ <= .5,
      `${id}: new obstacle must remain inside approved sample`);
  }
});

test('missing sample assets retain all original planting and collision footprints', async () => {
  const { before } = await fixtures();
  rejectNewAssets = true;
  let fallback;
  try {
    fallback = new WorldTwo(new THREE.Vector3());
    await fallback.ready;
    await fallback.groundSample.ready;
  } finally { rejectNewAssets = false; }
  assert.notEqual(fallback.groundSample.status, 'ready');
  // Pond banks are now independently approved and remain available even when
  // the sample kit fails. Compare the original floor plus only that pond hook.
  const { applyForestPondBank } = await import('../src/worlds/ForestPond.ts');
  const baseMaterial = before.root.getObjectByName('Continuous forest floor').material;
  const expectedMaterial = baseMaterial.clone();
  expectedMaterial.onBeforeCompile = baseMaterial.onBeforeCompile;
  expectedMaterial.customProgramCacheKey = baseMaterial.customProgramCacheKey;
  applyForestPondBank(expectedMaterial);
  const expectedShader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  expectedMaterial.onBeforeCompile(expectedShader, {});
  const originalGround = { material: expectedMaterial, shader: expectedShader }, fallbackGround = groundShader(fallback);
  assert.equal(fallbackGround.shader.vertexShader, originalGround.shader.vertexShader);
  assert.equal(fallbackGround.shader.fragmentShader, originalGround.shader.fragmentShader, 'sample failure must retain the original ground shader');
  assert.equal(fallbackGround.material.customProgramCacheKey(), originalGround.material.customProgramCacheKey());
  assert.equal(fallbackGround.material.userData.forestSampleSoil, undefined);
  for (const name of legacyNames) assert.deepEqual(horizontalInstances(instances(fallback.root.getObjectByName(name))),
    horizontalInstances(instances(before.root.getObjectByName(name))), `${name}: loading failure must not clear the existing scene`);
  const solidFootprints = world => [...world.collisions.obstacles.entries()].filter(([id]) => id !== 'forest-pond')
    .map(([id, value]) => [id, horizontalObstacle(value)]).sort();
  assert.deepEqual(solidFootprints(fallback), solidFootprints(before));
  assertPondShoreBlocked(fallback);
  assert.equal(fallback.understory.status, 'fallback');
  assert.equal(fallback.understory.preparationMeshes.length, 0, 'failed planting must not expose incomplete GPU buffers');
});

test('loaded sample follows forest alignment and the current portal stencil layer', async () => {
  await fixtures();
  const world = new WorldTwo(new THREE.Vector3());
  world.stencilLayer = 3;
  await world.ready;
  await world.groundSample.ready;
  let checked = 0;
  world.groundSample.root.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      assert.equal(material.stencilRef, 3, 'async assets inherit the layer at completion');
    checked++;
  });
  assert.ok(checked > 0);
  const matrices = [];
  world.groundSample.root.traverse(object => {
    if (object.isInstancedMesh) matrices.push({ object, instances: instances(object) });
  });
  const anchor = new THREE.Object3D(); anchor.position.set(12, 1.4, -8); anchor.rotation.y = 1.2;
  anchor.updateMatrixWorld(true); world.alignTo(anchor); world.stencilLayer = 0; world.refreshStencil();
  for (const { object, instances: original } of matrices) {
    assert.deepEqual(instances(object), original, 'alignment must not re-scatter the sample');
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      assert.equal(material.stencilRef, 0);
  }
  const local = new THREE.Vector3(4, world.groundHeight(4, -2), -2);
  const point = world.root.localToWorld(local.clone());
  assert.ok(Math.abs(world.groundAt(point.x, point.z) - point.y) < 1e-6);
});

test('permanent dense cover spans dry forest including arrival and the old trail; arrow stays removed', async t => {
  const { after } = await fixtures(), cover = after.understory;
  assert.equal(cover.status, 'ready');
  // The user approved a lighter forest to address entry lag. Guard broad,
  // permanent coverage rather than freezing the old 128,761-clump layout.
  assert.ok(cover.stats.planted >= 30_000 && cover.stats.planted <= 80_000,
    'the balanced forest must retain substantial coverage within its planting budget');
  const quadrants = [0, 0, 0, 0];
  for (const cell of cover.cells.values()) for (const p of cell.base) {
    assert.ok(forestCoverAt(p.x, p.z) > 0, 'plant roots must avoid water');
    assert.ok(Math.abs(p.y + .009 - after.groundHeight(p.x, p.z)) < 1e-6, 'roots follow the actual surface');
    if (Math.hypot(p.x, p.z + 4) < 20) quadrants[(p.x > 0 ? 1 : 0) + (p.z > -4 ? 2 : 0)]++;
  }
  assert.ok(quadrants.every(n => n >= 3500), `dense planting must reach every walking quadrant: ${quadrants}`);
  const plants = [...cover.cells.values()].flatMap(cell => cell.base);
  for (const z of [0, 3, 6, -3, -8, -12, -16]) {
    const x = Math.sin(z * .15) * 1.25;
    assert.equal(forestCoverAt(x, z), 1, 'the former trail must not exclude grass');
    const count = plants.filter(p => Math.abs(p.x - x) < .5 && Math.abs(p.z - z) < .5).length;
    let dryGround = 0;
    const animals = new Set(after.fauna.animals.map((_, i) => `forest-doe-${i}`));
    for (let ix = 0; ix < 20; ix++) for (let iz = 0; iz < 20; iz++) {
      const px = x - .5 + (ix + .5) / 20, pz = z - .5 + (iz + .5) / 20;
      if (!after.collisions.queryLocal(px, pz, .045, .8, after.groundHeight(px, pz), animals)) dryGround++;
    }
    assert.ok(count >= 14 * dryGround / 400, `old trail at ${x},${z}: ${count} clumps over ${dryGround / 400}m² free of solid objects`);
  }
  assert.equal(forestCoverAt(5, -9), 0, 'pond stays open water');
  assert.equal(after.root.getObjectByName('Low woodland sedges along the trail').visible, false);
  let sprites = 0;
  after.groundSample.root.traverse(o => { if (o.isSprite) sprites++; });
  assert.equal(sprites, 0, 'review arrow and label must no longer be created');
  t.diagnostic(`${cover.stats.planted} clumps placed across the forest; near walking quadrants: ${quadrants}`);
});

test('forest preparation exposes every immutable patch and both LODs without changing scene state', async t => {
  const { after } = await fixtures(), cover = after.understory;
  const expected = [...cover.base, ...cover.patches.map(patch => patch.batch)];
  const original = expected.map(({ mesh }) => ({ mesh, parent: mesh.parent, visible: mesh.visible,
    geometry: mesh.geometry, matrices: mesh.instanceMatrix.array, colors: mesh.instanceColor.array }));
  const entries = cover.preparationMeshes, byMesh = new Map(entries.map(entry => [entry.mesh, entry]));
  assert.equal(byMesh.size, expected.length, 'include every permanent and detached patch exactly once');
  assert.equal(entries.length, expected.length);
  assert.ok(Object.isFrozen(entries));
  assert.ok(original.some(state => state.parent === null), 'exercise dormant patches excluded from scene traversal');
  for (const batch of expected) {
    const entry = byMesh.get(batch.mesh);
    assert.ok(entry && Object.isFrozen(entry) && Object.isFrozen(entry.geometries));
    assert.ok(entry.geometries.includes(batch.mesh.geometry));
    for (const geometry of [batch.nearGeometry, batch.farGeometry].filter(Boolean))
      assert.ok(entry.geometries.includes(geometry), 'prepare both indices before their first LOD switch');
    assert.equal(new Set(entry.geometries).size, entry.geometries.length);
  }
  for (const state of original) {
    assert.equal(state.mesh.parent, state.parent); assert.equal(state.mesh.visible, state.visible);
    assert.equal(state.mesh.geometry, state.geometry);
    assert.equal(state.mesh.instanceMatrix.array, state.matrices); assert.equal(state.mesh.instanceColor.array, state.colors);
  }
  after.updateView(after.root.localToWorld(new THREE.Vector3(18, 1.7, -4)), true, 1 / 60);
  assert.equal(cover.preparationMeshes, entries, 'walking must reuse the completed startup list');
  for (const { mesh, geometries } of entries) assert.ok(geometries.includes(mesh.geometry));
  after.updateView(new THREE.Vector3(), false, 1 / 60);
  t.diagnostic(`${entries.length} immutable patches, ${entries.reduce((sum, entry) => sum + entry.geometries.length, 0)} geometry variants available for startup preparation.`);
});

test('moving through the forest keeps real submissions bounded and reuses stationary buffers', async t => {
  const { after } = await fixtures(), cover = after.understory;
  const maxTriangles = Object.values(FOREST_COVER_BUDGET).reduce((sum, n) => sum + n, 0);
  const buffers = [...cover.base, ...cover.patches.map(p => p.batch)].map(({ mesh }) =>
    ({ mesh, matrix: mesh.instanceMatrix.array, color: mesh.instanceColor.array,
      version: mesh.instanceMatrix.version, colorVersion: mesh.instanceColor.version }));
  const timings = [], samples = [];
  for (let i = 0; i < 32; i++) {
    const angle = i / 32 * Math.PI * 2, radius = 5 + (i % 4) * 4;
    const local = new THREE.Vector3(Math.cos(angle) * radius, 1.65, Math.sin(angle) * radius - 4);
    local.y += after.groundHeight(local.x, local.z);
    const start = performance.now();
    after.updateView(after.root.localToWorld(local), true, .1);
    after.updateView(local, true, .1);
    timings.push(performance.now() - start);
    let triangles = 0, draws = 0;
    cover.root.traverseVisible(mesh => {
      if (!mesh.isInstancedMesh) return;
      assert.ok(mesh.count <= mesh.instanceMatrix.count);
      triangles += mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
      draws++;
      assert.equal(mesh.material.transparent, false);
      assert.equal(mesh.castShadow, false, 'grass/detail pools must not add shadow redraws');
      assert.ok(mesh.boundingSphere?.radius > 0 && Number.isFinite(mesh.boundingSphere.radius));
      const box = mesh.geometry.boundingBox, matrix = new THREE.Matrix4(), corner = new THREE.Vector3();
      for (const index of [0, mesh.count - 1]) {
        mesh.getMatrixAt(index, matrix);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).applyMatrix4(matrix);
          assert.ok(mesh.boundingSphere.containsPoint(corner), 'conservative culling bounds must contain rendered instances');
        }
      }
    });
    assert.equal(triangles, cover.stats.triangles);
    assert.ok(triangles > 0 && triangles <= maxTriangles, `${triangles} > ${maxTriangles}`);
    assert.ok(draws <= 300, 'cached detail patches remain bounded before camera-frustum rejection');
    assert.ok(cover.stats.baseTriangles <= FOREST_COVER_BUDGET.base);
    assert.ok(cover.stats.detailTriangles <= FOREST_COVER_BUDGET.detail);
    assert.ok(cover.stats.propTriangles <= FOREST_COVER_BUDGET.props);
    samples.push(triangles);
  }
  for (const { mesh, matrix, color, version, colorVersion } of buffers) {
    assert.equal(mesh.instanceMatrix.array, matrix, 'reuse every patch matrix buffer');
    assert.equal(mesh.instanceColor.array, color, 'reuse every patch colour buffer');
    assert.equal(mesh.instanceMatrix.version, version, 'walking must not upload plant matrices');
    assert.equal(mesh.instanceColor.version, colorVersion, 'walking must not upload plant colours');
  }
  const current = after.root.localToWorld(cover.last.clone()), updates = cover.stats.updates;
  for (let i = 0; i < 120; i++) after.updateView(current, true, 1 / 60);
  assert.equal(cover.stats.updates, updates, 'stationary frames must not repack/upload the forest');
  for (const { mesh } of cover.base) {
    assert.equal(mesh.material.map, after.groundSample.root.getObjectByName('Forest sample grass_tiny_a').material.map,
      'permanent scans reuse the existing grass atlas');
    assert.equal(mesh.material.alphaTest, .45);
    assert.equal(mesh.material.alphaToCoverage, true);
    assert.equal(mesh.instanceMatrix.usage, THREE.StaticDrawUsage);
    assert.equal(mesh.material.userData.forestDetailFade, undefined, 'permanent grass never fades with distance');
  }
  timings.sort((a, b) => a - b);
  t.diagnostic(`Whole-forest geometry before spatial culling: ${Math.max(...samples)} triangles. Host CPU selection median ${timings[16].toFixed(1)} ms, max ${timings.at(-1).toFixed(1)} ms; not headset/GPU frame time.`);
  after.updateView(new THREE.Vector3(0, 1.6, 0), false, .1);
});

test('new large rocks leave deer route corridors open and floor litter shares approved textures', async () => {
  const { after } = await fixtures();
  let rocks = 0;
  for (const [id, p] of after.collisions.obstacles) {
    if (!id.startsWith('forest-cover-rock-')) continue;
    rocks++;
    for (const animal of after.fauna.animals) for (let i = 0; i < animal.route.length; i++) {
      const a = animal.route[i], b = animal.route[(i + 1) % animal.route.length], point = p.points[0];
      const dx = b.x - a.x, dz = b.z - a.z;
      const u = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / Math.max(.001, dx * dx + dz * dz), 0, 1);
      assert.ok(Math.hypot(point.x - a.x - u * dx, point.z - a.z - u * dz) >= 2.4);
    }
  }
  assert.ok(rocks > 0);
  const sampleMaterial = after.groundSample.root.getObjectByName('Forest sample moss and pine litter relief').material;
  const { shader, material } = groundShader(after);
  assert.equal(material.userData.forestLitter, sampleMaterial.userData.sampleLitter);
  for (const [i, name] of ['forestLitterColor', 'forestLitterNormal', 'forestLitterARM'].entries())
    assert.equal(shader.uniforms[name].value, sampleMaterial.userData.sampleLitter[i]);
  assert.ok(shader.fragmentShader.includes('float litterCover = 1.0-sampleWeight;'));
});

test('VR reduces scanned accent radius without reducing permanent coverage', async t => {
  const { after } = await fixtures(), cover = after.understory;
  const floor = after.root.getObjectByName('Continuous forest floor');
  const positions = [...cover.cells.values()].map(cell => cell.base);
  const baseVersions = cover.base.map(({ mesh }) => mesh.instanceMatrix.version);
  const limit = Object.values(FOREST_COVER_XR_BUDGET).reduce((a, b) => a + b, 0);
  floor.onBeforeRender({ xr: { isPresenting: true } }, after.scene, {}, floor.geometry, floor.material, null);
  assert.equal(cover.xrMode, true, 'the forest floor must detect renderer XR state');
  let maximum = 0;
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const p = after.root.localToWorld(new THREE.Vector3(Math.cos(a) * 16, 1.7, Math.sin(a) * 16 - 4));
    after.updateView(p, true, .1); after.updateView(p, true, .1);
    assert.ok(cover.stats.triangles <= limit);
    assert.ok(cover.stats.detailTriangles <= FOREST_COVER_XR_BUDGET.detail);
    maximum = Math.max(maximum, cover.stats.triangles);
  }
  [...cover.cells.values()].forEach((cell, i) => assert.equal(cell.base, positions[i], 'XR must not change cover'));
  assert.deepEqual(cover.base.map(({ mesh }) => mesh.instanceMatrix.version), baseVersions);
  floor.onBeforeRender({ xr: { isPresenting: false } }, after.scene, {}, floor.geometry, floor.material, null);
  after.updateView(new THREE.Vector3(0, 1.6, 0), false, .1);
  assert.equal(cover.xrMode, false);
  t.diagnostic(`Maximum VR-profile cover submission: ${maximum} triangles. This measures geometry, not headset frame time.`);
});

test('walking forward and back never removes base plants or drops a still-visible accent', async t => {
  const { after } = await fixtures(), cover = after.understory;
  cover.setXRMode(false);
  const permanent = cover.base.map(({ mesh }) => ({ count: mesh.count, version: mesh.instanceMatrix.version,
    hash: arrayHash(mesh.instanceMatrix.array) }));
  const key = (x, z) => `${Math.fround(x).toFixed(5)},${Math.fround(z).toFixed(5)}`;
  let checked = 0, largestStep = 0;
  const probe = [...cover.cells.values()].flatMap(cell => cell.spots).find(p => Math.hypot(p.x - 4, p.z + 2) < .5);
  let previousDistance, previousOpacity;
  for (let frame = 0; frame <= 400; frame++) {
    const z = -10 + (frame <= 200 ? frame : 400 - frame) * .10;
    const local = new THREE.Vector3(4, after.groundHeight(4, z) + 1.65, z);
    after.updateView(after.root.localToWorld(local.clone()), true, 1 / 60);
    const visible = Array.from({ length: 5 }, () => new Set());
    for (const { batch: { mesh }, species, kind } of cover.patches) {
      if (kind !== 'detail' || mesh.parent !== cover.root || !mesh.visible) continue;
      for (const { matrix } of instances(mesh)) visible[species].add(key(matrix[12], matrix[14]));
    }
    for (const cell of cover.cells.values()) {
      if (Math.hypot(cell.x - 4, cell.z - z) > 12) continue;
      for (const p of cell.spots) if (Math.hypot(p.x - 4, p.z - z) < cover.detailRange.value.y - .001) {
        assert.ok(visible[p.species].has(key(p.x, p.z)), 'every potentially visible scan must remain loaded at its original position');
        checked++;
      }
    }
    const d = Math.hypot(probe.x - 4, probe.z - z);
    const opacity = 1 - THREE.MathUtils.smoothstep(d, cover.detailRange.value.x, cover.detailRange.value.y);
    if (previousDistance !== undefined) {
      const delta = Math.abs(opacity - previousOpacity);
      assert.ok(delta <= .051, 'accent opacity must change gradually at walking speed');
      largestStep = Math.max(largestStep, delta);
    }
    previousDistance = d; previousOpacity = opacity;
    assert.deepEqual(cover.viewer.value, local, 'fade position must follow every movement frame');
    cover.base.forEach(({ mesh }, i) => {
      assert.equal(mesh.count, permanent[i].count);
      assert.equal(mesh.instanceMatrix.version, permanent[i].version, 'base buffers must never be repacked while moving');
      assert.equal(mesh.visible, true);
    });
    for (const batch of cover.base) if (batch.mesh.geometry === batch.farGeometry) {
      for (let i = 0; i < batch.mesh.count; i++) {
        const a = batch.mesh.instanceMatrix.array, offset = i * 16;
        assert.ok(Math.hypot(a[offset + 12] - local.x, a[offset + 14] - local.z) >= 12,
          'both directions of travel must finish the continuous morph before changing triangles');
      }
    }
  }
  cover.base.forEach(({ mesh }, i) => assert.equal(arrayHash(mesh.instanceMatrix.array), permanent[i].hash));
  assert.ok(checked > 100_000);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  cover.patches.find(p => p.kind === 'detail').batch.mesh.material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.uCoverViewer, cover.viewer);
  assert.ok(shader.fragmentShader.includes('if(vCoverFade <= 0.0) discard;'));
  assert.ok(shader.vertexShader.includes('1.0-smoothstep(uCoverRange.x,uCoverRange.y,coverDistance)'));
  assert.ok(groundShader(after).shader.fragmentShader.includes('forestMix = mix(forestMix,woodlandSoil,litterCover);'));
  t.diagnostic(`${checked} visible accent checks, unchanged permanent cover through a 40m out-and-back walk; maximum fade step ${largestStep.toFixed(3)}.`);
});

test('scanned grass retains dense coverage, accounting for transparent atlas pixels', async t => {
  const { after } = await fixtures(), cover = after.understory;
  const { createCanvas, loadImage } = createRequire(import.meta.url)('C:/Users/Lakshya/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
  const atlas = await loadImage(readFileSync(new URL('../public/models/forest/sample/grass_medium_01/textures/grass_medium_01_diff_alpha_1k.png', import.meta.url)));
  const canvas = createCanvas(atlas.width, atlas.height), context = canvas.getContext('2d');
  context.drawImage(atlas, 0, 0); const rgba = context.getImageData(0, 0, atlas.width, atlas.height).data;
  const matrix = new THREE.Matrix4(), v = new THREE.Vector3();
  const coverage = [];
  // Rasterize actual horizontal silhouettes and source alpha. Accent scans,
  // ferns, rocks and bounding circles do not count as permanent cover.
  for (const [cx, cz] of [[0, 0], [-1.2, -12], [-8, -4], [8, 6]]) {
    const size = 128, span = 2, occupied = new Uint8Array(size * size);
    for (const { mesh } of cover.base) for (let i = 0; i < mesh.count; i++) {
      const geometry = mesh.geometry, p = geometry.attributes.position, uv = geometry.attributes.uv;
      mesh.getMatrixAt(i, matrix);
      if (Math.abs(matrix.elements[12] - cx) > 2 || Math.abs(matrix.elements[14] - cz) > 2) continue;
      for (let j = 0; j < geometry.index.count; j += 3) {
        const tri = [], tex = [];
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(p, geometry.index.getX(j + k)).applyMatrix4(matrix);
          tri.push([(v.x - cx + span / 2) / span * size, (v.z - cz + span / 2) / span * size]);
          const index = geometry.index.getX(j + k); tex.push([uv.getX(index), uv.getY(index)]);
        }
        const [a, b, c] = tri, cross = (u, v, x, z) => (v[0] - u[0]) * (z - u[1]) - (v[1] - u[1]) * (x - u[0]);
        const area = cross(a, b, c[0], c[1]); if (Math.abs(area) < 1e-8) continue;
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const minZ = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxZ = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
          const s = [cross(a, b, x + .5, z + .5), cross(b, c, x + .5, z + .5), cross(c, a, x + .5, z + .5)];
          if (s.every(n => n >= 0) || s.every(n => n <= 0)) {
            const w = [s[1] / area, s[2] / area, s[0] / area];
            const u = w.reduce((sum, value, i) => sum + value * tex[i][0], 0);
            const v = w.reduce((sum, value, i) => sum + value * tex[i][1], 0);
            const tx = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width)));
            const ty = Math.min(atlas.height - 1, Math.max(0, Math.floor(v * atlas.height)));
            if (rgba[(ty * atlas.width + tx) * 4 + 3] >= .45 * 255) occupied[z * size + x] = 1;
          }
        }
      }
    }
    const fraction = occupied.reduce((a, b) => a + b, 0) / occupied.length;
    coverage.push(Math.round(fraction * 1000) / 10);
    t.diagnostic(`${cx},${cz}: ${(fraction * 100).toFixed(1)}% actual scanned leaf coverage`);
    assert.ok(fraction >= .70, `${cx},${cz}: actual scanned grass covers ${(fraction * 100).toFixed(1)}% from above; balanced target >=70%`);
  }
  t.diagnostic(`Top-down blade coverage at arrival, old path and two woodland locations: ${coverage.join('%, ')}%. Geometry check, not rendered photorealism.`);
});

test('spatial grass cells cull independently for desktop and wider headset-like views', async t => {
  const { after } = await fixtures(), cover = after.understory;
  const results = [];
  for (const xr of [false, true]) {
    cover.setXRMode(xr);
    const camera = new THREE.PerspectiveCamera(xr ? 95 : 70, xr ? 1.1 : 1.6, .05, 90);
    const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
    let maximum = 0, maximumDraws = 0, maximumBase = 0;
    for (let i = 0; i < 40; i++) {
      const a = i * Math.PI / 10, radius = i < 20 ? 0 : 16;
      const local = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius - 4);
      local.y = after.groundHeight(local.x, local.z) + 1.65;
      const position = after.root.localToWorld(local.clone());
      after.updateView(position, true, 1 / 60);
      camera.position.copy(position);
      camera.lookAt(after.root.localToWorld(local.clone().add(new THREE.Vector3(Math.sin(a), -.18, -Math.cos(a)))));
      camera.updateMatrixWorld(); after.root.updateMatrixWorld(true);
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      let triangles = 0, draws = 0, baseTriangles = 0;
      cover.root.traverseVisible(mesh => {
        if (!mesh.isInstancedMesh || !mesh.intersectsFrustum(frustum)) return;
        const count = mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
        triangles += count; draws++;
        if (mesh.name.startsWith('Forest permanent grass')) baseTriangles += count;
      });
      maximum = Math.max(maximum, triangles); maximumDraws = Math.max(maximumDraws, draws);
      maximumBase = Math.max(maximumBase, baseTriangles);
      assert.ok(baseTriangles < cover.stats.baseTriangles * .60, 'offscreen cells must be culled; never submit the entire carpet');
      assert.ok(triangles < 600_000, 'single-view cover geometry remains bounded after culling');
    }
    results.push(`${xr ? '95° headset-like' : '70° desktop'}: peak ${maximum} triangles (${maximumBase} permanent), ${maximumDraws} draws`);
  }
  cover.setXRMode(false);
  t.diagnostic(results.join('; ') + '. Camera-frustum geometry estimates only; no GPU or stereo timing.');
});
