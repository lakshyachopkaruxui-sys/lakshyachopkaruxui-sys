/** Build rooted curved foliage from existing Poly Haven grass-clump photographs.
 * Original pixels and atlas stay unchanged; full 3D source accents remain nearby. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
const output = new URL('../public/models/forest/natural-grass/', import.meta.url);
const types = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const doc = { asset: { version: '2.0', generator: 'TEAR: rooted curved foliage using existing Poly Haven CC0 grass-clump atlas regions' },
  scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [{ uri: 'grass.bin', byteLength: 0 }] };
const chunks = [], records = []; let offset = 0;
function append(attribute, type, target) {
  const array = attribute.array, bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  if (offset % 4) { const n = 4 - offset % 4; chunks.push(Buffer.alloc(n)); offset += n; }
  const view = doc.bufferViews.length;
  doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  chunks.push(bytes); offset += bytes.length;
  const accessor = { bufferView: view, componentType: Number(Object.entries(types).find(([, T]) => array instanceof T)[0]),
    count: attribute.count, type };
  if (type === 'VEC3') {
    accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < attribute.count; i++) for (let j = 0; j < 3; j++) {
      const value = attribute.getComponent(i, j);
      accessor.min[j] = Math.min(accessor.min[j], value); accessor.max[j] = Math.max(accessor.max[j], value);
    }
  }
  return doc.accessors.push(accessor) - 1;
}
const crops = [[238, 778, 496, 928], [574, 780, 823, 895], [249, 925, 510, 1023]];
for (const [variant, suffix] of ['b', 'c', 'd'].entries()) {
  const geometry = new THREE.BufferGeometry(), positions = [], uvs = [], indices = [];
  const crop = crops[variant];
  for (let card = 0; card < 4; card++) {
    const angle = card * Math.PI / 2 + variant * .27, dx = Math.cos(angle), dz = Math.sin(angle);
    const start = positions.length / 3;
    for (let row = 0; row < 3; row++) {
      const t = row / 2, lean = .31 * t * t, width = .31 * (.68 + .32 * t);
      for (const side of [-1, 1]) {
        positions.push(dx * lean - dz * width * side, t * (.46 + (card % 2) * .06), dz * lean + dx * width * side);
        uvs.push((side < 0 ? crop[0] : crop[2]) / 1024, (crop[3] + (crop[1] - crop[3]) * t) / 1024);
      }
    }
    for (let row = 0; row < 2; row++) {
      const i = start + row * 2; indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  // Thin leaf clusters transmit daylight. Bias card normals toward the canopy
  // to avoid treating a whole photographic tuft as one dark vertical wall.
  const normal = geometry.attributes.normal, n = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    n.fromBufferAttribute(normal, i); if (n.y < 0) n.negate();
    n.lerp(new THREE.Vector3(0, 1, 0), .55).normalize(); normal.setXYZ(i, n.x, n.y, n.z);
  }
  const attributes = {};
  for (const [key, type, semantic] of [['position', 'VEC3', 'POSITION'], ['normal', 'VEC3', 'NORMAL'], ['uv', 'VEC2', 'TEXCOORD_0']])
    attributes[semantic] = append(geometry.attributes[key], type, 34962);
  const index = append(geometry.index, 'SCALAR', 34963), id = doc.meshes.length;
  doc.meshes.push({ name: `ground_grass_${suffix}`, primitives: [{ attributes, indices: index }] });
  doc.nodes.push({ name: `ground_grass_${suffix}`, mesh: id }); doc.scenes[0].nodes.push(id);
  records.push({ source: 'grass_medium_01_diff_alpha_1k.png', atlasCropPixels: crop, mesh: `ground_grass_${suffix}`, triangles: geometry.index.count / 3,
    vertices: geometry.attributes.position.count, size: geometry.boundingBox.getSize(new THREE.Vector3()).toArray() });
}
const binary = Buffer.concat(chunks); doc.buffers[0].byteLength = binary.length;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(new URL('grass.bin', output), binary);
const json = JSON.stringify(doc); await fs.writeFile(new URL('grass.gltf', output), json);
await fs.writeFile(new URL('SOURCE.json', output), JSON.stringify({ source: 'https://polyhaven.com/a/grass_medium_01',
  license: 'CC0-1.0', authors: 'Rob Tuytel (photography), Rico Cilliers (modeling)',
  processing: 'Four rooted, curved foliage cards per clump sample three existing photographic clumps in the licensed atlas. No new/resampled images. Original high-detail 3D grass remains in the near accents.',
  meshes: records, files: { 'grass.bin': crypto.createHash('sha256').update(binary).digest('hex'),
    'grass.gltf': crypto.createHash('sha256').update(json).digest('hex') } }, null, 2));
console.log(JSON.stringify({ meshes: records, bytes: binary.length + json.length }));
