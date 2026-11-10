import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } };

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module',
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return nextLoad(url, context);
  }
});
const { forestPlantingSpots, groundedForestGeometry, ForestDetails, loadForestFloor } = await import('../src/worlds/ForestDetails.ts');
const { EnvironmentalPresence } = await import('../src/worlds/EnvironmentalPresence.ts');

async function parsedScan(relativeFile) {
  const file = new URL(`../public/models/forest/${relativeFile}`, import.meta.url);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  // Geometry/transform fixture uses the actual downloaded binary. Images are
  // omitted only for Node parsing; browser regression covers real textures.
  for (const buffer of data.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(new URL(buffer.uri, file)).toString('base64');
  delete data.images; delete data.textures; delete data.samplers;
  data.materials = data.materials.map(material => ({ name: material.name,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
  gltf.scene.traverse(object => { if (object.isMesh) object.material.map = new THREE.Texture(); });
  return gltf;
}

test('downloaded forest files match all 14 official checksums and declared sizes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/models/forest/SOURCE-MANIFEST.json', import.meta.url), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.files.length, 14);
  for (const record of manifest.files) {
    const file = readFileSync(new URL('../' + record.file, import.meta.url));
    assert.equal(file.byteLength, record.bytes);
    assert.equal(createHash('md5').update(file).digest('hex'), record.md5);
    assert.equal(createHash('sha256').update(file).digest('hex'), record.sha256);
  }
});

test('all scanned fern placements leave landing, tear, pond and perch clear', () => {
  const spots = forestPlantingSpots();
  assert.equal(spots.length, 144);
  assert.deepEqual(spots, forestPlantingSpots(), 'deterministic placement');
  for (const spot of spots) {
    assert.ok(Math.hypot(spot.x, spot.z) >= 2.3);
    assert.ok(Math.abs(spot.x - Math.sin(spot.z * .15) * 1.25) >= 1.75);
    assert.ok(Math.hypot((spot.x - 5) / 2.4, (spot.z + 9) / 4.2) >= 1.5);
    assert.ok(Math.hypot(spot.x + 1.7, spot.z + 4.8) >= 1.6);
  }
});

test('each of the four real fern variants is grounded independently of its kit offset', async () => {
  const gltf = await parsedScan('fern_02/fern_02_1k.gltf');
  gltf.scene.updateMatrixWorld(true);
  const sizes = [];
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    const geometry = groundedForestGeometry(object), bounds = geometry.boundingBox;
    assert.ok(Math.abs(bounds.min.y) < 1e-6);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-6);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).z) < 1e-6);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x < 1.2 && size.z < 1.2 && size.y > .1 && size.y < .6);
    sizes.push(size); geometry.dispose();
  });
  assert.equal(sizes.length, 4);
});

test('successful scan loading yields five instanced draw meshes and current portal masks', async () => {
  const [fern, stump] = await Promise.all([parsedScan('balanced/ferns.gltf'), parsedScan('balanced/stumps.gltf')]);
  const originalGLTF = GLTFLoader.prototype.loadAsync, originalTexture = THREE.TextureLoader.prototype.loadAsync;
  const fixtures = new Map([['/models/forest/balanced/ferns.gltf', fern], ['/models/forest/balanced/stumps.gltf', stump]]);
  const requested = new Set();
  GLTFLoader.prototype.loadAsync = async url => {
    assert.ok(fixtures.has(url), `unexpected forest asset request: ${url}`);
    requested.add(url);
    return fixtures.get(url);
  };
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
  try {
    let hidden = false, layer = 3;
    const details = new ForestDetails(new THREE.Group(), (x, z) => .2 * x - .1 * z,
      () => layer, { value: 0 }, new EnvironmentalPresence(), () => { hidden = true; });
    layer = 2;
    await details.ready;
    assert.deepEqual(requested, new Set(fixtures.keys()), 'load both actual runtime assets');
    assert.deepEqual(details.assetStatus, { ferns: 'ready', stumps: 'ready' });
    assert.equal(hidden, true);
    assert.equal(details.root.children.length, 5);
    let plants = 0;
    for (const mesh of details.root.children) {
      assert.equal(mesh.isInstancedMesh, true);
      assert.equal(mesh.material.stencilRef, 2);
      if (mesh.name.startsWith('Scanned fern')) {
        plants += mesh.count;
        assert.equal(mesh.material.alphaMap.flipY, false);
        assert.equal(mesh.material.alphaTest, .43);
        assert.equal(mesh.customDepthMaterial.alphaMap, mesh.material.alphaMap);
      }
    }
    assert.equal(plants, 144);
  } finally {
    GLTFLoader.prototype.loadAsync = originalGLTF;
    THREE.TextureLoader.prototype.loadAsync = originalTexture;
  }
});

test('missing scans retain existing plants and missing floor map retains all fallback maps', async () => {
  const originalGLTF = GLTFLoader.prototype.loadAsync, originalTexture = THREE.TextureLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => { throw new Error('offline'); };
  THREE.TextureLoader.prototype.loadAsync = async () => { throw new Error('offline'); };
  try {
    let hidden = false;
    const details = new ForestDetails(new THREE.Group(), () => 0, () => 1, { value: 0 },
      new EnvironmentalPresence(), () => { hidden = true; });
    await details.ready;
    assert.deepEqual(details.assetStatus, { ferns: 'fallback', stumps: 'fallback' });
    assert.equal(hidden, false);
    const map = new THREE.Texture(), normalMap = new THREE.Texture(), roughnessMap = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap });
    assert.equal(await loadForestFloor(material, 10), false);
    assert.equal(material.map, map); assert.equal(material.normalMap, normalMap); assert.equal(material.roughnessMap, roughnessMap);
  } finally {
    GLTFLoader.prototype.loadAsync = originalGLTF;
    THREE.TextureLoader.prototype.loadAsync = originalTexture;
  }
});
