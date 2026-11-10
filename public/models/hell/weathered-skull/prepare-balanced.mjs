// Reduce the licensed publisher download; original JPEG bytes remain unchanged.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;
const folder = fileURLToPath(new URL('./', import.meta.url));
let raw;
try { raw = await fs.readFile(folder + 'human-skull-light.glb'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const response = await fetch('https://grab3d.com/dl/human-skull/human-skull-light.glb');
  if (!response.ok) throw new Error(`Skull source download failed: ${response.status}`);
  raw = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(raw).digest('hex') !== 'b918dcde90bf086501f7e33e5a7b130fc47b97bb5e83d6d301ae953aa31b055e') throw new Error('Unexpected skull source');
const jsonLength = raw.readUInt32LE(12), source = JSON.parse(raw.subarray(20, 20 + jsonLength));
const bin = raw.subarray(28 + jsonLength), doc = structuredClone(source), primitive = doc.meshes[0].primitives[0];
const types = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, components = { SCALAR: 1, VEC2: 2, VEC3: 3 };
const read = index => {
  const a = source.accessors[index], view = source.bufferViews[a.bufferView], Type = types[a.componentType], size = components[a.type];
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), values = new Type(a.count * size);
  for (let i = 0; i < values.length; i++) {
    const at = offset + i * Type.BYTES_PER_ELEMENT;
    values[i] = Type === Float32Array ? bin.readFloatLE(at) : Type === Uint16Array ? bin.readUInt16LE(at) : bin.readUInt32LE(at);
  }
  return values;
};
const positions = read(primitive.attributes.POSITION), normals = read(primitive.attributes.NORMAL), uvs = read(primitive.attributes.TEXCOORD_0);
const indices = new Uint32Array(read(primitive.indices)), count = positions.length / 3;
const attributes = new Float32Array(count * 5), locks = new Uint8Array(count), bounds = source.accessors[primitive.attributes.POSITION];
for (let i = 0; i < count; i++) {
  attributes.set([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uvs[i * 2], uvs[i * 2 + 1]], i * 5);
  for (let c = 0; c < 3; c++) if (positions[i * 3 + c] === bounds.min[c] || positions[i * 3 + c] === bounds.max[c]) locks[i] = 1;
}
const [attributeReduced, attributeError] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, 5,
  [.04, .04, .04, .05, .05], locks, 7998 * 3, .025, ['Permissive', 'Prune']);
// The AI-derived source contains many tiny topology islands. A bounded spatial
// pass removes their redundant tessellation while keeping the original UV samples.
const [reduced, spatialError] = MeshoptSimplifier.simplifySloppy(attributeReduced, positions, 3, locks, 6500 * 3, .015);
const error = Math.max(attributeError, spatialError);
const [remap, vertices] = MeshoptSimplifier.compactMesh(reduced);
const chunks = []; let length = 0;
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
const compactIndices = new Uint16Array(reduced);
if (vertices >= 65536 || compactIndices.some(index => index >= vertices)) throw new Error('Invalid skull compact indices');
primitive.indices = push(compactIndices, { componentType: 5123, type: 'SCALAR' }, 1, 34963);
doc.buffers = [{ uri: 'skull.bin', byteLength: length }];
doc.asset.extras = { source: 'https://grab3d.com/models/anatomy/human-skull/', license: 'CC0-1.0',
  origin: 'AI-assisted Meshy base and textures, cleaned and checked in Blender by Grab3D; not a photogrammetry scan.',
  processing: 'Attribute-aware Meshoptimizer reduction; source light variant 1K JPEG bytes unchanged.' };
doc.nodes[0].extras = { ...doc.nodes[0].extras, sourceTriangles: indices.length / 3, triangles: reduced.length / 3, variant: 'Tear balanced' };
await fs.mkdir(folder + 'textures', { recursive: true });
const imageFiles = [];
for (let i = 0; i < source.images.length; i++) {
  const view = source.bufferViews[source.images[i].bufferView], file = `textures/skull-${i === 0 ? 'color' : 'arm'}.jpg`;
  const bytes = bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  await fs.writeFile(folder + file, bytes);
  imageFiles.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  doc.images[i] = { uri: file, mimeType: source.images[i].mimeType, name: source.images[i].name };
}
await fs.writeFile(folder + 'skull.bin', Buffer.concat(chunks));
await fs.writeFile(folder + 'skull.gltf', JSON.stringify(doc));
const report = { sourceTriangles: indices.length / 3, runtimeTriangles: reduced.length / 3, sourceVertices: count, runtimeVertices: vertices,
  relativeError: error, attributeTriangles: attributeReduced.length / 3, spatialRelativeError: spatialError,
  runtimeGeometryBytes: length, sourceBounds: { min: bounds.min, max: bounds.max },
  runtimeBounds: doc.accessors[primitive.attributes.POSITION], unchangedImages: imageFiles, primitiveCount: 1, materialCount: 1,
  license: 'CC0-1.0', origin: doc.asset.extras.origin, files: [] };
for (const file of ['skull.gltf', 'skull.bin']) {
  const bytes = await fs.readFile(folder + file);
  report.files.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(folder + 'BALANCED.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
