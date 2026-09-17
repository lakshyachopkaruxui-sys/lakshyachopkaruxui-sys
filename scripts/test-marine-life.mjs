// Real bundled GLB geometry and skinning, plus complete local-coordinate swim
// routes. These checks do not claim GPU, WebXR stereo or headset validation.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }) };
    return nextLoad(url, context);
  }
});
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type = type; Object.assign(this, data); } };
async function parseAsset(path) {
  const glb = readFileSync(new URL(`../public${path}`, import.meta.url));
  const jsonLength = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const binary = glb.subarray(28 + jsonLength);
  json.buffers = [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }];
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
    for (const field of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete material[field];
  }
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}
const { MarineLife, MARINE_MODELS } = await import('../src/worlds/MarineLife.ts');
const { measureProp } = await import('../src/worlds/props.ts');
const assets = new Map(await Promise.all(Object.values(MARINE_MODELS).map(async spec => [spec.path, await parseAsset(spec.path)])));
const useAssets = () => GLTFLoader.prototype.loadAsync = async path => { assert.ok(assets.has(path), `Unexpected/nonexistent asset ${path}`); return assets.get(path); };

test('actual marine models load, rigged swims remain independent, and every asynchronous addition is masked before attach', async () => {
  const pending = new Map();
  GLTFLoader.prototype.loadAsync = path => new Promise(resolve => pending.set(path, resolve));
  const parent = new THREE.Group();
  let layer = 1;
  const life = new MarineLife(parent, () => layer);
  assert.equal(parent.children.length, 1);
  assert.equal(life.group.children.length, 5, 'three efficient schools and two authored turtles are present immediately');
  layer = 0;
  const add = life.group.add;
  let additions = 0;
  life.group.add = function (...objects) {
    for (const object of objects) {
      object.traverse(node => {
        for (const material of !node.material ? [] : Array.isArray(node.material) ? node.material : [node.material]) {
          assert.equal(material.stencilRef, 0);
          assert.equal(material.stencilFunc, THREE.EqualStencilFunc);
        }
      });
      additions++;
    }
    return add.apply(this, objects);
  };
  for (const [path, resolve] of pending) resolve(assets.get(path));
  await life.ready;
  assert.equal(additions, 10);
  assert.deepEqual(life.swimState.failedAssets, []);
  assert.equal(life.swimState.heroes.filter(hero => hero.source === 'asset').length, 10);
  assert.equal(life.swimState.heroes.filter(hero => hero.source === 'original' && hero.species === 'turtle').length, 2);
  assert.equal(life.swimState.schools.reduce((sum, school) => sum + school.count, 0), 102);
  const sharks = life.heroes.filter(hero => hero.species === 'shark');
  const skeletons = [], materials = [], sampleMeshes = [];
  sharks.forEach(shark => shark.model.traverse(node => { if (node.isSkinnedMesh) { skeletons.push(node.skeleton); materials.push(node.material); sampleMeshes.push(node); } }));
  assert.equal(new Set(skeletons).size, 2, 'each shark owns its real skeleton');
  assert.equal(new Set(materials).size, 2, 'stencil/material edits cannot leak into another world');
  assert.ok(sharks.every(shark => shark.mixer?._actions[0]._clip.name === 'Armature|Swim'));
  parent.updateMatrixWorld(true);
  const vertexSamples = sampleMeshes.map(mesh => Array.from({ length: 48 }, (_, i) => Math.floor(i / 48 * mesh.geometry.getAttribute('position').count)));
  const before = sampleMeshes.map((mesh, i) => vertexSamples[i].map(vertex => mesh.getVertexPosition(vertex, new THREE.Vector3()).clone()));
  let deformation = 0;
  for (let frame = 1; frame <= 90; frame++) {
    life.update(frame / 60, 1 / 60);
    parent.updateMatrixWorld(true);
    sampleMeshes.forEach((mesh, i) => vertexSamples[i].forEach((vertex, j) => {
      deformation = Math.max(deformation, mesh.getVertexPosition(vertex, new THREE.Vector3()).distanceTo(before[i][j]));
    }));
  }
  assert.ok(deformation > 0.02, 'the source swim clip must deform actual skinned geometry');
  assert.notEqual(sharks[0].mixer.time, sharks[1].mixer.time, 'swimmers must not animate in lockstep');
});

test('imported rig poses stay finite and physically sized across their complete swim clips', async () => {
  useAssets();
  const life = new MarineLife(new THREE.Group(), () => 1); await life.ready;
  for (const hero of life.heroes) {
    const carrier = hero.group;
    carrier.position.set(0, 0, 0); carrier.quaternion.identity();
    const frames = hero.mixer ? 48 : 1;
    for (let i = 0; i <= frames; i++) {
      if (hero.mixer) hero.mixer.setTime(i / frames * hero.mixer._actions[0]._clip.duration);
      const box = measureProp(hero.model), size = box.getSize(new THREE.Vector3());
      const largest = Math.max(...size.toArray());
      assert.ok(size.toArray().every(Number.isFinite), `${hero.species} has invalid skin bounds`);
      assert.ok(largest > hero.length * 0.72 && largest < hero.length * 1.30, `${hero.species} escaped metre scale: ${largest} for ${hero.length}`);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < hero.length * 0.32, `${hero.species} rig drifted away from its path-owned pivot`);
    }
  }
});

test('swim routes remain smooth, above reefs and away from the arrival, including closed-route seams and root relocation', async () => {
  useAssets();
  const parent = new THREE.Group(), life = new MarineLife(parent, () => 0); await life.ready;
  let previous;
  for (let i = 0; i <= 9000; i++) {
    life.update(i / 20, 0.05);
    const current = life.swimState.heroes;
    const barramundi = current.filter(hero => hero.species === 'barramundi');
    for (let a = 0; a < barramundi.length; a++) for (let b = a + 1; b < barramundi.length; b++) {
      assert.ok(barramundi[a].position.distanceTo(barramundi[b].position) > (barramundi[a].length + barramundi[b].length) * 0.65,
        'textured fish bodies overlap rather than swimming with breathing room');
    }
    for (const [j, hero] of current.entries()) {
      const p = hero.position;
      assert.ok(p.toArray().every(Number.isFinite));
      assert.ok(Math.abs(hero.rotation.length() - 1) < 1e-6);
      assert.ok(p.y >= 5.2 && p.y <= 16.5, `unsafe vertical route ${hero.species}: ${p.toArray()}`);
      if (Math.abs(p.x) > 7) assert.ok(p.y >= 7, `${hero.species} intersects outer reef shelf`);
      assert.ok(p.distanceTo(new THREE.Vector3(0, 1.65, -2)) > 4, 'no animal swims into the viewer on arrival');
      if (previous) {
        assert.ok(p.distanceTo(previous[j].position) < 0.075, `${hero.species} teleported`);
        assert.ok(hero.rotation.angleTo(previous[j].rotation) < 0.025, `${hero.species} abruptly turned`);
      }
    }
    previous = current;
  }
  const local = life.heroes.map(hero => hero.group.position.clone());
  parent.position.set(23, 0, -37); parent.rotation.y = 0.47; parent.updateMatrixWorld(true);
  life.heroes.forEach((hero, i) => assert.ok(hero.group.getWorldPosition(new THREE.Vector3()).distanceTo(parent.localToWorld(local[i].clone())) < 1e-8));
  const before = life.swimState.heroes.map(hero => hero.position);
  life.update(NaN, Infinity);
  assert.deepEqual(life.swimState.heroes.map(hero => hero.position), before);
});

test('shoals use three bounded draw calls with smooth geometry, independent phases and a tail-normal deformation shader', async () => {
  useAssets();
  const life = new MarineLife(new THREE.Group(), () => 1); await life.ready;
  let schoolTriangles = 0;
  for (const shoal of life.shoals) {
    assert.ok(shoal.mesh.isInstancedMesh);
    const geometry = shoal.mesh.geometry;
    assert.ok(geometry.getAttribute('normal') && geometry.getAttribute('color'));
    assert.ok(new Set(geometry.getAttribute('aSwimPhase').array).size > 20);
    schoolTriangles += geometry.index.count / 3 * shoal.members.length;
    const shader = { uniforms: {}, vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>' };
    shoal.mesh.material.onBeforeCompile(shader);
    assert.ok(shader.vertexShader.includes('objectNormal.z -= tailSlope * objectNormal.x'));
    assert.ok(shader.vertexShader.includes('transformed.x += sin(tailAngle)'));
    assert.equal(shader.uniforms.uMarineTime, life.clock);
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (let frame = 0; frame < 240; frame++) {
      life.update(frame, 0);
      const points = [];
      for (let i = 0; i < shoal.mesh.count; i++) {
        shoal.mesh.getMatrixAt(i, matrix); point.setFromMatrixPosition(matrix);
        points.push(point.clone());
        assert.ok(point.distanceTo(shoal.mesh.boundingSphere.center) + 1 < shoal.mesh.boundingSphere.radius, 'moving shoal escaped conservative culling bounds');
        assert.ok(point.y > 5.0);
        if (Math.abs(point.x) > 7) assert.ok(point.y > 6, 'shoal touches an outer reef');
      }
      for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
        assert.ok(points[a].distanceTo(points[b]) > (shoal.members[a].length + shoal.members[b].length) * 0.60,
          `${shoal.kind} school fish overlap`);
      }
    }
  }
  assert.ok(schoolTriangles < 135000, `fish shoal triangle budget exceeded: ${schoolTriangles}`);
  let renderedTriangles = 0, calls = 0;
  life.group.traverse(node => {
    if (!node.isMesh) return;
    const perMesh = node.geometry.index?.count / 3 || node.geometry.getAttribute('position').count / 3;
    renderedTriangles += perMesh * (node.isInstancedMesh ? node.count : 1); calls++;
  });
  assert.ok(renderedTriangles < 175000, `marine triangle budget exceeded: ${renderedTriangles}`);
  assert.ok(calls <= 40, `marine draw-call budget exceeded: ${calls}`);
});

test('failed assets use visible original creatures and report only actual failed URLs without invalid requests', async () => {
  GLTFLoader.prototype.loadAsync = async () => { throw new Error('controlled asset failure'); };
  const warn = console.warn; console.warn = () => {};
  let life;
  try { life = new MarineLife(new THREE.Group(), () => 1); await life.ready; } finally { console.warn = warn; }
  assert.equal(life.swimState.failedAssets.length, 4);
  assert.ok(!life.swimState.failedAssets.some(url => url.includes('Turtle')));
  assert.ok(life.swimState.heroes.every(hero => hero.source === 'original'));
  assert.equal(life.swimState.heroes.length, 12);
  const ray = life.heroes.find(hero => hero.species === 'ray');
  const before = ray.fins[0].rotation.z;
  life.update(1, 0.1);
  assert.ok(Math.abs(ray.fins[0].rotation.z - before) > 0.02);
  life.group.traverse(node => {
    for (const material of !node.material ? [] : Array.isArray(node.material) ? node.material : [node.material]) assert.equal(material.stencilRef, 1);
  });
});
