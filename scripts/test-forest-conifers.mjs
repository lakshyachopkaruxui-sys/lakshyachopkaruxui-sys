import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } };
const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module',
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});
const { ForestConifers } = await import('../src/worlds/ForestConifers.ts');
const { WorldCollisions } = await import('../src/worlds/WorldCollisions.ts');
const folder = new URL('../public/models/forest/conifers/', import.meta.url);

function glb(name) {
  const raw = readFileSync(new URL(name, folder)), length = raw.readUInt32LE(12);
  return { data: JSON.parse(raw.subarray(20, 20 + length)), binary: raw.subarray(28 + length) };
}

// Decode PNG scanline filters to inspect real embedded alpha samples, rather
// than merely trusting a MIME type or a material's declared alpha mode.
function alphaSamples(png) {
  assert.equal(png.readUInt8(24), 8, '8-bit texture');
  assert.equal(png.readUInt8(25), 6, 'RGBA texture');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const bytes = inflateSync(Buffer.concat(chunks)), stride = width * 4;
  let prior = new Uint8Array(stride), transparent = 0, opaque = 0;
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = bytes[offset], row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0, up = prior[x], corner = x >= 4 ? prior[x - 4] : 0;
      const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
      const predictor = [0, left, up, Math.floor((left + up) / 2), pa <= pb && pa <= pc ? left : pb <= pc ? up : corner][filter];
      assert.notEqual(predictor, undefined);
      row[x] = bytes[offset + 1 + x] + predictor;
      if (x % 4 === 3) { if (row[x] < 10) transparent++; if (row[x] > 245) opaque++; }
    }
    prior = row;
  }
  return { transparent: transparent / (width * height), opaque: opaque / (width * height) };
}

async function fixture() {
  const { data, binary } = glb('fir_tree_01.glb');
  data.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64');
  delete data.images; delete data.textures; delete data.samplers;
  data.materials = data.materials.map(m => ({ name: m.name, alphaMode: m.alphaMode, alphaCutoff: m.alphaCutoff,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  return new GLTFLoader().parseAsync(JSON.stringify(data), '');
}

test('real fir exports retain hashes, usable UV coordinates, and nonopaque needle cutouts', () => {
  const manifest = JSON.parse(readFileSync(new URL('SOURCE-MANIFEST.json', folder)));
  assert.equal(manifest.license, 'CC0-1.0');
  for (const asset of manifest.exports) {
    const raw = readFileSync(new URL('../' + asset.runtime, import.meta.url));
    assert.equal(raw.length, asset.bytes);
    assert.equal(createHash('sha256').update(raw).digest('hex'), asset.sha256);
    const { data, binary } = glb(asset.runtime.split('/').pop());
    for (const mesh of data.meshes) for (const primitive of mesh.primitives) {
      assert.notEqual(primitive.attributes.TEXCOORD_0, undefined, 'original vector attribute must become a real UV layer');
      const uv = data.accessors[primitive.attributes.TEXCOORD_0];
      const view = data.bufferViews[uv.bufferView], stride = view.byteStride || 8;
      assert.equal(uv.componentType, 5126);
      const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
      for (let i = 0; i < uv.count; i++) for (let axis = 0; axis < 2; axis++) {
        const value = binary.readFloatLE((view.byteOffset || 0) + (uv.byteOffset || 0) + i * stride + axis * 4);
        assert.ok(Number.isFinite(value)); min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
      }
      assert.ok(max[0] - min[0] > .01 && max[1] - min[1] > .01, 'UVs vary over both axes');
    }
  }
  const { data, binary } = glb('fir_tree_01.glb');
  const material = data.materials.find(m => m.name.includes('twig'));
  assert.equal(material.alphaMode, 'MASK');
  const image = data.images[data.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
  assert.equal(image.mimeType, 'image/png');
  const view = data.bufferViews[image.bufferView];
  const alpha = alphaSamples(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  assert.ok(alpha.transparent > .15 && alpha.opaque > .03, JSON.stringify(alpha));
});

test('real fir geometry forms culled stands with immediate stencil and measured trunk collisions', async () => {
  const source = await fixture(), load = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => source;
  try {
    const parent = new THREE.Group(), collisions = new WorldCollisions(parent);
    const conifers = new ForestConifers(parent, () => .2, () => 3, { value: 0 }, collisions);
    await conifers.ready;
    assert.equal(conifers.status, 'ready');
    assert.ok(conifers.spots.length >= 100);
    assert.equal(conifers.bases.length, conifers.spots.length);
    assert.equal(collisions.size, conifers.spots.length);
    let triangles = 0, measuredPoints = 0;
    const point = new THREE.Vector3(), matrix = new THREE.Matrix4();
    for (const mesh of conifers.root.children) {
      assert.equal(mesh.material.stencilRef, 3);
      assert.ok(mesh.boundingSphere.radius < 36, 'each batch has a local culling bound');
      triangles += mesh.geometry.index.count / 3 * mesh.count;
      if (mesh.material.name.includes('twig')) {
        assert.equal(mesh.material.transparent, false);
        assert.equal(mesh.material.alphaTest, .43);
        assert.equal(mesh.customDepthMaterial.alphaTest, .43);
        continue;
      }
      const positions = mesh.geometry.attributes.position;
      for (let instance = 0; instance < mesh.count; instance++) {
        mesh.getMatrixAt(instance, matrix);
        for (let i = 0; i < positions.count; i += 7) {
          if (positions.getY(i) > .7) continue;
          point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
          if (point.y < .2) continue; // buried scan soil is not a solid above-ground obstacle
          assert.equal(collisions.queryLocal(point.x, point.z, .005, .1, point.y), true, 'lower visible wood is inside a registered footprint');
          measuredPoints++;
        }
      }
    }
    assert.ok(measuredPoints > 100);
    assert.ok(triangles < 1_650_000, `instanced tree triangles: ${triangles}`);
    console.log(JSON.stringify({ treeInstances: conifers.spots.length, totalTreeTriangles: triangles, spatialDrawMeshes: conifers.root.children.length }));
  } finally { GLTFLoader.prototype.loadAsync = load; }
});

test('measured trunks meet sloped terrain and share their contact-shade and collider centres', async () => {
  const source = await fixture(), load = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => source;
  try {
    const heightAt = (x, z) => .17 * x - .11 * z + .08 * Math.sin(x * 1.3 + z * .7);
    const parent = new THREE.Group(), collisions = new WorldCollisions(parent), circles = [];
    const addCircle = collisions.addCircle.bind(collisions);
    collisions.addCircle = shape => { circles.push(shape); addCircle(shape); };
    const conifers = new ForestConifers(parent, heightAt, () => 2, { value: 0 }, collisions);
    await conifers.ready;
    assert.equal(conifers.status, 'ready');
    assert.equal(conifers.bases.length, conifers.spots.length);
    for (let i = 0; i < circles.length; i++) {
      assert.equal(circles[i].x, conifers.bases[i].x);
      assert.equal(circles[i].z, conifers.bases[i].z);
    }
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), roots = new Map();
    let contactPoints = 0, visibleWood = 0;
    for (const mesh of conifers.root.children) {
      if (mesh.material.name.includes('twig')) continue;
      const p = mesh.geometry.attributes.position;
      for (let instance = 0; instance < mesh.count; instance++) {
        mesh.getMatrixAt(instance, matrix);
        const key = `${matrix.elements[12]}:${matrix.elements[14]}`;
        for (let i = 0; i < p.count; i++) {
          if (p.getY(i) >= 1.6) continue;
          point.fromBufferAttribute(p, i).applyMatrix4(matrix);
          const gap = point.y - heightAt(point.x, point.z);
          if (p.getY(i) < .145) {
            assert.ok(gap <= 0.00001, `scan soil collar floats ${gap}m above terrain`);
            roots.set(key, Math.max(roots.get(key) ?? -Infinity, gap));
            contactPoints++;
          } else if (gap > .01) {
            assert.equal(collisions.queryLocal(point.x, point.z, .005, .1, point.y), true,
              'every sampled visible lower-trunk point remains within its collider');
            visibleWood++;
          }
        }
      }
    }
    assert.equal(roots.size, conifers.spots.length);
    assert.ok(contactPoints > 1000 && visibleWood > 1000);
    assert.ok(Math.min(...roots.values()) > -.04, `each root collar reaches the surface instead of being buried deeply: ${Math.min(...roots.values())}m`);
    assert.ok(conifers.bases.some(base => Math.min(...conifers.spots.map(spot => Math.hypot(base.x - spot.x, base.z - spot.z))) > .3),
      'the measured root API must preserve the real asymmetric canopy/trunk offset');
  } finally { GLTFLoader.prototype.loadAsync = load; }
});

test('missing conifer asset settles readiness without an unhandled rejection', async () => {
  const load = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => { throw new Error('offline'); };
  try {
    const parent = new THREE.Group();
    const conifers = new ForestConifers(parent, () => 0, () => 1, { value: 0 }, new WorldCollisions(parent));
    await conifers.ready;
    assert.equal(conifers.status, 'unavailable');
  } finally { GLTFLoader.prototype.loadAsync = load; }
});

test('photographic forest context matches the official download checksum', () => {
  const source = JSON.parse(readFileSync(new URL('../public/hdri/forest_slope-SOURCE.json', import.meta.url)));
  assert.equal(source.license, 'CC0-1.0');
  const bytes = readFileSync(new URL('../' + source.file, import.meta.url));
  assert.equal(bytes.length, source.size);
  assert.equal(createHash('md5').update(bytes).digest('hex'), source.md5);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  assert.ok(bytes.subarray(0, 40).toString().includes('#?RADIANCE'));
});
