// Numerical scene tests against THREE.Raycaster's actual rendered triangles.
// Run with Node 22.15+ (or Node 24): npm run test:environments
// Browser texture/asset I/O is disabled below; these are geometry/contact tests,
// not screenshot, shader, headset, or external asset-loading tests.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

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
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
        shortCircuit: true
      };
    }
    return nextLoad(url, context);
  }
});

const { HeightField } = await import('../src/worlds/terrain.ts');
const close = (actual, expected, message, tolerance = 3e-5) => {
  assert.ok(Number.isFinite(actual), `${message}: non-finite sample`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != raycast ${expected}`);
};
function random(seed = 41217) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
function surfaceAt(mesh, x, z) {
  mesh.updateWorldMatrix(true, false);
  raycaster.set(new THREE.Vector3(x, 1000, z), down);
  const hit = raycaster.intersectObject(mesh, false)[0];
  assert.ok(hit, `rendered surface missing at (${x}, ${z}) in ${mesh.name || 'terrain'}`);
  return hit.point.y;
}
function meshFor(field) {
  return new THREE.Mesh(field.geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
}

test('height sampler matches rendered triangles at 5,636 nonlinear and sloped points', () => {
  const functions = [
    (x, z) => 0.37 * x - 0.24 * z + 1.1,
    (x, z) => Math.sin(x * 1.31) * Math.cos(z * 0.83) * 2.7,
    (x, z) => x * z * 0.16 + Math.cos(x * 0.62 + z * 1.14),
    (x, z) => Math.hypot(x - 2, z + 1) * 0.4 + Math.sin(x - z) * 0.8
  ];
  const rng = random();
  for (const height of functions) {
    const field = new HeightField(16, 17, height);
    assert.ok(field.geometry.index, 'terrain must have actual indexed surface triangles');
    const mesh = meshFor(field);
    for (let i = 0; i < 1409; i++) {
      const x = (rng() - 0.5) * 15.999;
      const z = (rng() - 0.5) * 15.999;
      close(field.heightAt(x, z), surfaceAt(mesh, x, z), `surface sample ${i}`);
    }
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test('both triangle orientations, corners, grid edges, and outside clamping remain grounded', () => {
  const size = 16, segments = 8, half = size / 2, cell = size / segments;
  const field = new HeightField(size, segments, (x, z) => x * z * 0.2 + Math.sin(x + z));
  const mesh = meshFor(field);
  const fractions = [[0.1, 0.2], [0.9, 0.8], [0.15, 0.85], [0.85, 0.15], [0.5, 0.5]];
  for (let xCell = 0; xCell < segments; xCell++) {
    for (let zCell = 0; zCell < segments; zCell++) {
      for (const [u, v] of fractions) {
        const x = -half + (xCell + u) * cell;
        const z = -half + (zCell + v) * cell;
        close(field.heightAt(x, z), surfaceAt(mesh, x, z), 'triangle interior/diagonal');
      }
    }
  }
  for (let i = 0; i <= segments; i++) {
    const coordinate = -half + i * cell;
    for (const [x, z] of [[-half, coordinate], [half, coordinate], [coordinate, -half], [coordinate, half]]) {
      close(field.heightAt(x, z), surfaceAt(mesh, x, z), 'inclusive boundary');
    }
  }
  for (const [x, z] of [[-20, 1], [20, -1], [1, -20], [-1, 20], [-20, -20], [20, 20]]) {
    const cx = Math.max(-half, Math.min(half, x));
    const cz = Math.max(-half, Math.min(half, z));
    close(field.heightAt(x, z), surfaceAt(mesh, cx, cz), 'outside clamps to rendered edge');
  }
});

// Leave asynchronous prop loading pending instead of inserting substitute
// meshes. The actual procedural world surfaces still build synchronously.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
HDRLoader.prototype.load = () => new THREE.DataTexture();
GLTFLoader.prototype.load = () => undefined;
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas', `unexpected browser dependency: ${tag}`);
    const gradient = { addColorStop() {} };
    const context = new Proxy({
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      measureText: text => ({ width: String(text).length * 8 })
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    return { width: 1, height: 1, getContext: () => context };
  }
};

const { WorldTwo } = await import('../src/worlds/WorldTwo.ts');
const { WorldThree } = await import('../src/worlds/WorldThree.ts');
let forest, drift;
const getForest = () => forest ??= new WorldTwo(new THREE.Vector3(0, 1.35, -1.1));
const getDrift = () => drift ??= new WorldThree(new THREE.Vector3(0, 1.35, -1.1));

test('forest groundAt follows actual ground after translated and rotated alignment', () => {
  const world = getForest();
  let ground;
  world.scene.traverse(object => {
    if (object.isMesh && object.geometry === world.terrain.geometry) ground = object;
  });
  assert.ok(ground, 'forest sampler must be the geometry actually attached to the scene');
  const rng = random(833);
  for (const [x, z, yaw] of [[0, -1.1, 0], [12.5, -8.3, 1.1], [-9.2, 6.1, -2.2]]) {
    const anchor = new THREE.Object3D();
    anchor.position.set(x, 1.3, z);
    anchor.rotation.y = yaw;
    anchor.updateMatrixWorld();
    world.alignTo(anchor);
    world.scene.updateMatrixWorld(true);
    for (let i = 0; i < 367; i++) {
      const local = new THREE.Vector3((rng() - 0.5) * 36, 0, (rng() - 0.5) * 36);
      ground.localToWorld(local);
      close(world.groundAt(local.x, local.z), surfaceAt(ground, local.x, local.z), 'aligned forest floor');
    }
  }
});

test('forest planting origins touch or intentionally embed in the actual floor', () => {
  const world = getForest();
  world.scene.updateMatrixWorld(true);
  let ground;
  const planting = [];
  world.scene.traverse(object => {
    if (object.isMesh && object.geometry === world.terrain.geometry) ground = object;
    if (object.isInstancedMesh) planting.push(object);
  });
  assert.ok(ground);
  let checked = 0;
  for (const mesh of planting) {
    for (let instance = 0; instance < mesh.count; instance++) {
      const local = new THREE.Matrix4();
      mesh.getMatrixAt(instance, local);
      const base = new THREE.Vector3().applyMatrix4(new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, local));
      const separation = base.y - surfaceAt(ground, base.x, base.z);
      assert.ok(separation <= 0.001, `${mesh.name} ${instance} floats ${separation}m above terrain`);
      assert.ok(separation >= -0.12, `${mesh.name} ${instance} is buried ${-separation}m below terrain`);
      checked++;
    }
  }
  assert.ok(checked >= 300, 'check real scene planting, not an empty fixture');
});

function islandWorldPoint(island, x, z) {
  island.root.updateWorldMatrix(true, true);
  return island.root.localToWorld(new THREE.Vector3(x, 0, z));
}

test('island samplers agree with rendered tops across more than 1,000 points', () => {
  const world = getDrift();
  assert.ok(world.islands.length > 0, 'world exposes its rendered island surfaces');
  const rng = random(771);
  const each = Math.max(211, Math.ceil(1103 / world.islands.length));
  for (const island of world.islands) {
    assert.equal(island.surface.geometry, island.terrain.geometry);
    island.terrain.geometry.computeBoundingBox();
    const size = island.terrain.geometry.boundingBox.getSize(new THREE.Vector3());
    const radius = Math.min(size.x, size.z) * 0.40;
    for (let i = 0; i < each; i++) {
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * radius;
      const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
      const point = islandWorldPoint(island, x, z);
      const sampled = island.root.localToWorld(new THREE.Vector3(x, island.terrain.heightAt(x, z), z));
      close(sampled.y, surfaceAt(island.surface, point.x, point.z), 'island surface');
    }
  }
});

test('floating island surfaces are closed with consistently oriented shared edges', () => {
  for (const [islandIndex, island] of getDrift().islands.entries()) {
    const geometry = island.terrain.geometry;
    const positions = geometry.getAttribute('position');
    const ids = geometry.index;
    const edges = new Map();
    const key = index => [positions.getX(index), positions.getY(index), positions.getZ(index)]
      .map(value => Math.round(value * 100000)).join(',');
    const count = ids ? ids.count : positions.count;
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map(offset => key(ids ? ids.getX(i + offset) : i + offset));
      assert.equal(new Set(triangle).size, 3, `island ${islandIndex} contains a collapsed triangle`);
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        const record = edges.get(edge) ?? { count: 0, orientation: 0 };
        record.count++;
        record.orientation += a < b ? 1 : -1;
        edges.set(edge, record);
      }
    }
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2, `island ${islandIndex} has an open or non-manifold edge`);
      assert.equal(edge.orientation, 0, `island ${islandIndex} has an inverted neighboring triangle`);
    }
  }
});

test('island plant and crystal attachment bases contact their actual support mesh', () => {
  const world = getDrift();
  assert.ok(world.groundAttachments.length > 0, 'scene must record its grounded attachments');
  world.scene.updateMatrixWorld(true);
  for (const attachment of world.groundAttachments) {
    const matrix = attachment.object.matrixWorld.clone();
    if (attachment.instance !== undefined) {
      const local = new THREE.Matrix4();
      attachment.object.getMatrixAt(attachment.instance, local);
      matrix.multiply(local);
    }
    const base = new THREE.Vector3().applyMatrix4(matrix);
    const island = world.islands[attachment.island];
    assert.ok(island, 'attachment references a real support island');
    close(base.y, surfaceAt(island.surface, base.x, base.z), 'grounded attachment', 0.001);
  }
});

test('home island groundAt remains correct after alignment', () => {
  const world = getDrift();
  const rng = random(6101);
  for (const [x, z, yaw] of [[0, -1.1, 0], [11, -5, 1.3], [-7, 12, -2]]) {
    const anchor = new THREE.Object3D();
    anchor.position.set(x, 1.35, z);
    anchor.rotation.y = yaw;
    anchor.updateMatrixWorld();
    world.alignTo(anchor);
    const home = world.islands[0];
    for (let i = 0; i < 137; i++) {
      const angle = rng() * Math.PI * 2, radius = Math.sqrt(rng()) * 7;
      const point = islandWorldPoint(home, Math.cos(angle) * radius, Math.sin(angle) * radius);
      close(world.groundAt(point.x, point.z), surfaceAt(home.surface, point.x, point.z), 'aligned island floor');
    }
  }
});

function glbGeometryBounds(url) {
  const bytes = readFileSync(url);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'valid GLB header');
  assert.equal(bytes.readUInt32LE(4), 2, 'GLB version 2');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'complete GLB');
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    if (kind === 0x004e4942) binary = data;
    offset += 8 + length;
  }
  assert.ok(json && binary, 'GLB embeds scene and vertex buffers');
  const box = new THREE.Box3();
  let triangleCount = 0;
  function visit(index, parent) {
    const node = json.nodes[index];
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1])
    );
    const matrix = new THREE.Matrix4().multiplyMatrices(parent, local);
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        assert.equal(primitive.mode ?? 4, 4, 'tree is made of triangles');
        const accessor = json.accessors[primitive.attributes.POSITION];
        assert.equal(accessor.componentType, 5126, 'floating-point positions');
        assert.equal(accessor.type, 'VEC3');
        const view = json.bufferViews[accessor.bufferView];
        assert.equal(view.buffer, 0, 'embedded position buffer');
        const stride = view.byteStride ?? 12;
        const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        for (let vertex = 0; vertex < accessor.count; vertex++) {
          const offset = base + vertex * stride;
          const point = new THREE.Vector3(binary.readFloatLE(offset), binary.readFloatLE(offset + 4), binary.readFloatLE(offset + 8));
          assert.ok(point.toArray().every(Number.isFinite), 'finite baked vertices');
          box.expandByPoint(point.applyMatrix4(matrix));
        }
        triangleCount += (primitive.indices === undefined ? accessor.count : json.accessors[primitive.indices].count) / 3;
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  }
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, new THREE.Matrix4());
  return { box, triangleCount, json };
}

test('baked oak and ash use finite metre-scale geometry and a grounded trunk', () => {
  for (const name of ['oak', 'ash', 'oak_lod', 'ash_lod']) {
    const { box, triangleCount, json } = glbGeometryBounds(new URL(`../public/models/refined/${name}.glb`, import.meta.url));
    close(box.min.y, 0, `${name} base`, 1e-5);
    close(box.max.y, 8, `${name} height`, 1e-5);
    const size = box.getSize(new THREE.Vector3());
    assert.ok(size.x > 1 && size.z > 1 && size.x < 25 && size.z < 25, `${name} canopy metre scale`);
    assert.ok(triangleCount > 1000 && triangleCount <= (name.endsWith('_lod') ? 3500 : 15000), `${name} bounded geometry budget`);
    for (const expected of ['bark', 'leaves']) {
      assert.ok(json.materials.some(material => material.name === expected), `${name} ${expected} material`);
    }
  }
});
