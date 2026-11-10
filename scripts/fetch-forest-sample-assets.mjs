/** Prepare selected source geometry without affecting any existing world assets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, 'validation/forest-sample-2026-10-17');
const runtime = path.join(root, 'public/models/forest/sample');
const selection = {
  grass_medium_01: [
    ['grass_medium_01_tall_a_LOD0', 'grass_tall_a'],
    ['grass_medium_01_tall_b_LOD0', 'grass_tall_b'],
    ['grass_medium_01_tiny_a_LOD0', 'grass_tiny_a'],
    ['grass_medium_01_small_b_LOD0', 'grass_small_b'],
    ['grass_medium_01_mid_b_LOD0', 'grass_mid_b'],
    ['grass_medium_01_large_b_LOD0', 'grass_large_b'],
  ],
  rock_moss_set_01: [
    ['rock_moss_set_01_rock03', 'rock_03'],
    ['rock_moss_set_01_rock06', 'rock_06'],
    ['rock_moss_set_01_rock03', 'pebble_03'],
  ],
  dry_branches_medium_01: [
    ['dry_branches_medium_01_b', 'branch_b'],
    ['dry_branches_medium_01_c', 'branch_c'],
  ],
};
const summary = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function attribute(document, buffers, accessorIndex) {
  const accessor = document.accessors[accessorIndex];
  const view = document.bufferViews[accessor.bufferView];
  const ArrayType = types[accessor.componentType];
  if (!ArrayType || accessor.sparse) throw new Error('Unsupported source accessor');
  const itemSize = dimensions[accessor.type];
  const packed = new ArrayType(accessor.count * itemSize);
  const stride = view.byteStride ?? itemSize * ArrayType.BYTES_PER_ELEMENT;
  const byteStart = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = buffers[view.buffer];
  for (let i = 0; i < accessor.count; i++) {
    const bytes = source.subarray(byteStart + i * stride, byteStart + i * stride + itemSize * ArrayType.BYTES_PER_ELEMENT);
    const aligned = Uint8Array.from(bytes).buffer;
    packed.set(new ArrayType(aligned), i * itemSize);
  }
  return new THREE.BufferAttribute(packed, itemSize, accessor.normalized ?? false);
}

for (const [asset, choices] of Object.entries(selection)) {
  const sourceFolder = path.join(cache, 'originals', asset);
  const source = JSON.parse(await fs.readFile(path.join(sourceFolder, `${asset}_1k.gltf`), 'utf8'));
  const buffers = await Promise.all(source.buffers.map(buffer => fs.readFile(path.join(sourceFolder, buffer.uri))));
  const target = path.join(runtime, asset);
  await fs.mkdir(target, { recursive: true });
  const document = {
    asset: { version: '2.0', generator: 'TEAR CC0 sample preparation; selected Poly Haven source meshes' },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [],
    materials: structuredClone(source.materials), textures: structuredClone(source.textures),
    images: structuredClone(source.images), samplers: structuredClone(source.samplers),
    accessors: [], bufferViews: [], buffers: [{ uri: 'sample.bin', byteLength: 0 }],
  };
  if (asset === 'grass_medium_01') {
    document.materials[0].alphaMode = 'MASK';
    document.materials[0].alphaCutoff = 0.45;
    document.materials[0].occlusionTexture = { index: 2, strength: 0.65 };
  } else {
    document.materials[0].doubleSided = false;
    if (asset === 'dry_branches_medium_01') document.materials[0].occlusionTexture = { index: 2, strength: 0.85 };
  }
  for (const image of document.images) {
    if (asset === 'grass_medium_01' && image.uri.includes('_diff_')) image.uri = 'textures/grass_medium_01_diff_alpha_1k.png';
    else if (asset === 'rock_moss_set_01' && image.uri.includes('_diff_')) image.uri = image.uri.replace('_1k', '_2k');
    else if (asset !== 'rock_moss_set_01' || image.uri.includes('_rough_')) image.uri = image.uri.replace('_1k', '_512');
  }
  const parts = [];
  let offset = 0;
  function addAccessor(attr, type, index = false) {
    const array = attr.array;
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const padding = (4 - offset % 4) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); offset += padding; }
    const view = document.bufferViews.length;
    document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: index ? 34963 : 34962 });
    parts.push(bytes); offset += bytes.length;
    const componentType = Object.entries(types).find(([, Type]) => array instanceof Type)?.[0];
    if (!componentType) throw new Error('Unsupported output component');
    const entry = { bufferView: view, componentType: Number(componentType), count: attr.count, type };
    if (attr.normalized) entry.normalized = true;
    if (type === 'VEC3') {
      entry.min = [Infinity, Infinity, Infinity]; entry.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < attr.count; i++) for (let c = 0; c < 3; c++) {
        const n = attr.getComponent(i, c);
        if (!Number.isFinite(n)) throw new Error('Invalid vertex');
        entry.min[c] = Math.min(entry.min[c], n); entry.max[c] = Math.max(entry.max[c], n);
      }
    }
    document.accessors.push(entry);
    return document.accessors.length - 1;
  }
  for (const [sourceName, name] of choices) {
    const node = source.nodes.find(node => node.name === sourceName);
    if (!node) throw new Error(`Source mesh missing: ${sourceName}`);
    const primitive = source.meshes[node.mesh].primitives[0];
    let geometry = new THREE.BufferGeometry();
    for (const [semantic, index] of Object.entries(primitive.attributes)) {
      const key = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TANGENT: 'tangent' }[semantic];
      if (key) geometry.setAttribute(key, attribute(source, buffers, index));
    }
    geometry.setIndex(attribute(source, buffers, primitive.indices));
    const originalTriangles = geometry.index.count / 3;
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const originShift = [-center.x, -geometry.boundingBox.min.y, -center.z];
    geometry.translate(...originShift);
    let process = 'Selected authored mesh; catalog transform removed; XZ centered and lowest source vertex moved to local Y=0. No simplification.';
    if (name === 'pebble_03') {
      const count = Math.ceil(geometry.attributes.position.count * (1 - 400 / originalTriangles));
      geometry = await new SimplifyModifier().modify(geometry, count);
      geometry.computeBoundingBox();
      const reducedCenter = geometry.boundingBox.getCenter(new THREE.Vector3());
      geometry.translate(-reducedCenter.x, -geometry.boundingBox.min.y, -reducedCenter.z);
      process = 'Derived from rock_03 using Three.js r186 SimplifyModifier (meshoptimizer), target 400 triangles; normal and UV attributes participate in error metric and are preserved. Recentered XZ and Ybase=0 after simplification.';
    }
    geometry.computeBoundingBox();
    const outputPrimitive = { attributes: {}, material: 0, mode: 4 };
    for (const [key, type, semantic] of [['position', 'VEC3', 'POSITION'], ['normal', 'VEC3', 'NORMAL'], ['uv', 'VEC2', 'TEXCOORD_0'], ['tangent', 'VEC4', 'TANGENT']]) {
      const attr = geometry.getAttribute(key);
      if (attr) outputPrimitive.attributes[semantic] = addAccessor(attr, type);
    }
    outputPrimitive.indices = addAccessor(geometry.index, 'SCALAR', true);
    document.meshes.push({ name, primitives: [outputPrimitive] });
    document.nodes.push({ name, mesh: document.meshes.length - 1 });
    document.scenes[0].nodes.push(document.nodes.length - 1);
    summary.push({ asset, name, sourceName, originalTriangles, triangles: geometry.index.count / 3,
      vertices: geometry.attributes.position.count, min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray(),
      originShift, process });
  }
  const binary = Buffer.concat(parts);
  document.buffers[0].byteLength = binary.length;
  await fs.writeFile(path.join(target, 'sample.bin'), binary);
  await fs.writeFile(path.join(target, 'sample.gltf'), JSON.stringify(document, null, 2) + '\n');
}

const outputFiles = [];
async function record(directory) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await record(file);
    else if (item.name !== 'SOURCE-MANIFEST.json') {
      const bytes = await fs.readFile(file);
      outputFiles.push({ file: path.relative(root, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await record(runtime);
const authors = await Promise.all(Object.keys(selection).map(async id => {
  const info = JSON.parse(await fs.readFile(path.join(cache, `${id}-info.json`), 'utf8'));
  return { id, authors: info.authors, source: `https://polyhaven.com/a/${id}` };
}));
const manifest = {
  license: 'CC0-1.0', license_url: 'https://polyhaven.com/license',
  retrieval: 'Powered by Poly Haven API; User-Agent TEAR-Forest-Sample/1.0',
  assets: authors,
  sourceFiles: JSON.parse(await fs.readFile(path.join(cache, 'download-manifest.json'), 'utf8')),
  geometry: summary,
  textureProcessing: JSON.parse(await fs.readFile(path.join(cache, 'texture-processing.json'), 'utf8')),
  materialProcessing: 'Grass uses the published alpha map combined into RGBA with MASK alphaCutoff 0.45; source ARM provides occlusion. Rocks/branches use single-sided opaque materials. All images retain source color.',
  files: outputFiles,
};
await fs.writeFile(path.join(runtime, 'SOURCE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.writeFile(path.join(cache, 'runtime-geometry.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ meshes: summary, outputBytes: outputFiles.reduce((sum, file) => sum + file.bytes, 0) }, null, 2));
