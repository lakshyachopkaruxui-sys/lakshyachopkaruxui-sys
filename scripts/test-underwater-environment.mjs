// Numerical scene verification, not a browser/headset rendering claim.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});
// Keep marine asset loads pending. Creature assets/animations have a separate
// actual-binary test suite; these checks cover the fully built environment.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
GLTFLoader.prototype.loadAsync = () => new Promise(() => {});
const { WorldUnderwater } = await import('../src/worlds/WorldUnderwater.ts');
const world = new WorldUnderwater(new THREE.Vector3());
const ground = world.root.children.find(object => object.geometry === world.terrain.geometry);
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const point = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const close = (a, b, message) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < 4e-5, `${message}: ${a} vs ${b}`);
let seed = 9813;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const groundAt = (x, z) => { ray.set(new THREE.Vector3(x, 100, z), down); const hit = ray.intersectObject(ground, false)[0]; assert.ok(hit, 'seabed has no hole'); return hit.point.y; };

test('underwater floor matches rendered triangles through translation and yaw, without inheriting head tilt', () => {
  assert.ok(ground, 'rendered floor uses the sampler geometry');
  for (const [x, z, yaw] of [[0, 0, 0], [12.4, -7.2, 1.1], [-8.8, 15.6, -2.0]]) {
    const anchor = new THREE.Object3D(); anchor.position.set(x, 1.5, z); anchor.rotation.set(.12, yaw, .08, 'YXZ'); anchor.updateMatrixWorld();
    world.alignTo(anchor); world.scene.updateMatrixWorld(true);
    close(world.root.rotation.x, 0, 'floor pitch stays level'); close(world.root.rotation.z, 0, 'floor roll stays level'); close(world.root.rotation.y, yaw, 'floor yaw follows seam');
    for (let i = 0; i < 337; i++) {
      point.set((random() - .5) * 65, 0, (random() - .5) * 65); world.root.localToWorld(point);
      close(world.groundAt(point.x, point.z), groundAt(point.x, point.z), 'exact seabed contact');
    }
    close(world.walkBounds.center.x, world.root.localToWorld(new THREE.Vector3(0, 0, -5)).x, 'walk circle transforms with world');
  }
});

test('all planted reef origins remain on the actual surface after rotated alignment', () => {
  assert.ok(world.groundAttachments.length > 400, 'rich reef has inspectable attachments');
  world.scene.updateMatrixWorld(true);
  for (const { object, instance } of world.groundAttachments) {
    object.getMatrixAt(instance, matrix); point.setFromMatrixPosition(matrix); object.localToWorld(point);
    close(point.y, groundAt(point.x, point.z), `${object.name} instance ${instance} attachment`);
  }
});

test('arrival and central swimming view stay clear of large reef props', () => {
  for (const { object, instance } of world.groundAttachments) {
    if (!/reef boulders|outcrops|coral|sponges|fans|seaweed|seagrass/i.test(object.name)) continue;
    object.getMatrixAt(instance, matrix); point.setFromMatrixPosition(matrix);
    assert.ok(Math.hypot(point.x, point.z) >= 4.5, `${object.name} encroaches on landing`);
    if (point.z < 3 && point.z > -22) assert.ok(Math.abs(point.x - Math.sin(point.z * .12) * 1.1) >= 3, `${object.name} blocks central route`);
  }
  for (let z = -2; z <= 2; z += .125) for (let x = -2; x <= 2; x += .125) assert.ok(Math.abs(world.groundHeight(x, z)) < .003, 'flat comfortable arrival');
});

test('water is a complete virtual volume with overhead surface and current portal stencil', () => {
  assert.equal(world.scene.background, null, 'no unmasked scene background');
  const sky = world.root.children.find(object => object.name.startsWith('Opaque ocean depth'));
  const ceiling = world.root.children.find(object => object.name.startsWith('Rippling water ceiling'));
  assert.ok(sky && ceiling, 'full sphere and water ceiling are present');
  assert.equal(sky.geometry.parameters.phiLength, Math.PI * 2);
  assert.equal(sky.geometry.parameters.thetaLength, Math.PI);
  assert.equal(ceiling.position.y, 22);
  assert.equal(ceiling.material.transparent, false, 'surface cannot leak the real room in XR');
  for (const layer of [0, 1, 0, 1]) {
    world.stencilLayer = layer; world.refreshStencil();
    world.scene.traverse(object => {
      if (!object.material) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        assert.equal(material.stencilRef, layer, `${object.name} stencil updates`);
        assert.equal(material.stencilWrite, true);
      }
    });
  }
});

test('environment animation remains finite and bubble sources stay below the surface', () => {
  const bubbles = world.root.children.find(object => object.name.startsWith('Small ascending'));
  const snow = world.root.children.find(object => object.name.startsWith('Slow marine snow'));
  for (const t of [0, .016, 17, 64, 121, 280, 1290, 86400]) {
    world.update(t, 0);
    for (let i = 0; i < bubbles.count; i++) {
      bubbles.getMatrixAt(i, matrix); assert.ok(matrix.elements.every(Number.isFinite)); point.setFromMatrixPosition(matrix);
      assert.ok(point.y > 0 && point.y < 22, 'bubbles stay within water volume');
      assert.ok(Math.abs(point.x) > 4, 'bubbles do not spawn in the viewer’s face');
    }
    assert.ok([...snow.geometry.attributes.position.array].every(Number.isFinite), 'marine snow remains finite');
  }
});

test('environment geometry fits the standalone-headset budget and all primitives are finite', () => {
  let triangles = 0, drawCalls = 0, meshes = 0;
  world.root.traverse(object => {
    if (object.parent === world.marineLife.group || object === world.marineLife.group) return;
    let parent = object.parent;
    while (parent) { if (parent === world.marineLife.group) return; parent = parent.parent; }
    if (!object.geometry) return;
    const p = object.geometry.attributes.position;
    assert.ok([...p.array].every(Number.isFinite), `${object.name} positions are finite`);
    if (!object.isMesh) return;
    meshes++;
    triangles += (object.geometry.index?.count ?? p.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    drawCalls += Array.isArray(object.material) ? Math.max(1, object.geometry.groups.length) : 1;
  });
  assert.ok(triangles < 350000, `environment ${triangles} triangles exceeds 350k budget`);
  assert.ok(drawCalls < 70, `environment ${drawCalls} draw calls exceeds 70 budget`);
  console.log(`Underwater environment: ${triangles.toLocaleString()} triangles, ${drawCalls} mesh draws (${meshes} meshes), plus one particle draw; marine animals excluded.`);
});
