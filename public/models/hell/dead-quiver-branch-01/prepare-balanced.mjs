// Rebuild a small runtime derivative of the unchanged CC0 Poly Haven source.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;
const folder = fileURLToPath(new URL('./', import.meta.url));
const source = JSON.parse(await fs.readFile(folder + 'dead_quiver_branch_01_1k.gltf', 'utf8'));
const bin = await fs.readFile(folder + 'dead_quiver_branch_01.bin');
const doc = structuredClone(source), primitive = doc.meshes[0].primitives[0];
const types = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const components = { SCALAR: 1, VEC2: 2, VEC3: 3 };
const read = index => {
  const a = source.accessors[index], view = source.bufferViews[a.bufferView];
  const Type = types[a.componentType], size = components[a.type];
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const values = new Type(a.count * size);
  for (let i = 0; i < values.length; i++) {
    const at = offset + i * Type.BYTES_PER_ELEMENT;
    values[i] = Type === Float32Array ? bin.readFloatLE(at) : Type === Uint16Array ? bin.readUInt16LE(at) : bin.readUInt32LE(at);
  }
  return values;
};
const positions = read(primitive.attributes.POSITION), normals = read(primitive.attributes.NORMAL), uvs = read(primitive.attributes.TEXCOORD_0);
const indices = new Uint32Array(read(primitive.indices)), count = positions.length / 3;
const attributes = new Float32Array(count * 5), locks = new Uint8Array(count);
const bounds = source.accessors[primitive.attributes.POSITION];
for (let i = 0; i < count; i++) {
  attributes.set([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uvs[i * 2], uvs[i * 2 + 1]], i * 5);
  for (let c = 0; c < 3; c++) if (positions[i * 3 + c] === bounds.min[c] || positions[i * 3 + c] === bounds.max[c]) locks[i] = 1;
}
const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, 5,
  [.1, .1, .1, .15, .15], locks, 3996 * 3, .025, ['Permissive']);
const [remap, vertices] = MeshoptSimplifier.compactMesh(reduced);
const chunks = [];
let length = 0;
doc.bufferViews = []; doc.accessors = [];
const push = (values, template, size, target) => {
  const padding = (4 - length % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const view = doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target }) - 1;
  chunks.push(bytes); length += bytes.length;
  const accessor = { componentType: template.componentType, type: template.type, bufferView: view, count: values.length / size };
  if (template.min) {
    accessor.min = Array(size).fill(Infinity); accessor.max = Array(size).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
      accessor.min[i % size] = Math.min(accessor.min[i % size], values[i]);
      accessor.max[i % size] = Math.max(accessor.max[i % size], values[i]);
    }
  }
  return doc.accessors.push(accessor) - 1;
};
for (const [semantic, index] of Object.entries(primitive.attributes)) {
  const a = source.accessors[index], size = components[a.type], input = read(index), compact = new types[a.componentType](vertices * size);
  for (let i = 0; i < remap.length; i++) if (remap[i] < vertices) compact.set(input.subarray(i * size, (i + 1) * size), remap[i] * size);
  primitive.attributes[semantic] = push(compact, a, size, 34962);
}
// compactMesh rewrites the supplied index array to the compact vertex IDs.
const compactIndices = new Uint16Array(reduced);
if (vertices >= 65536 || compactIndices.some(index => index >= vertices)) throw new Error('Invalid compact indices');
primitive.indices = push(compactIndices, { componentType: 5123, type: 'SCALAR' }, 1, 34963);
doc.buffers = [{ uri: 'branch.bin', byteLength: length }];
doc.asset.extras = { source: 'https://polyhaven.com/a/dead_quiver_branch_01', license: 'CC0-1.0', processing: 'Attribute-aware Meshoptimizer reduction; original texture pixels unchanged.' };
await fs.writeFile(folder + 'branch.bin', Buffer.concat(chunks));
await fs.writeFile(folder + 'branch.gltf', JSON.stringify(doc));
const report = { sourceTriangles: indices.length / 3, runtimeTriangles: compactIndices.length / 3,
  sourceVertices: count, runtimeVertices: vertices, relativeError: error, runtimeGeometryBytes: length,
  sourceBounds: { min: bounds.min, max: bounds.max }, runtimeBounds: doc.accessors[primitive.attributes.POSITION],
  unchangedImages: doc.images.map(image => image.uri), primitiveCount: 1, materialCount: 1,
  files: [] };
for (const file of ['branch.gltf', 'branch.bin']) {
  const bytes = await fs.readFile(folder + file);
  report.files.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(folder + 'BALANCED.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
