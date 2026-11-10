// Build a smaller, quality-balanced forest kit without changing the source assets.
// All writes stay in public/models/forest/balanced. Runtime routing is separate.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;
const root = fileURLToPath(new URL('../public/models/forest/', import.meta.url));
const out = path.join(root, 'balanced');
await fs.mkdir(out, { recursive: true });
const inputs = [
  ['grass', 'sample/grass_medium_01/sample.gltf', .025, .15],
  ['rocks', 'sample/rock_moss_set_01/sample.gltf', .025, .12],
  ['branches', 'sample/dry_branches_medium_01/sample.gltf', .016, .10],
  ['ferns', 'fern_02/fern_02_1k.gltf', .025, .22],
  ['stumps', 'tree_stump_01/tree_stump_01_1k.gltf', .012, .07],
  ['conifers', 'conifers/fir_tree_01.glb', .018, .10]
];
const types = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const hash = data => createHash('sha256').update(data).digest('hex');
const report = [];

for (const [name, relative, errorLimit, ratio] of inputs) {
  const file = path.join(root, relative), raw = await fs.readFile(file);
  let source, bins;
  if (relative.endsWith('.glb')) {
    const length = raw.readUInt32LE(12);
    source = JSON.parse(raw.subarray(20, 20 + length));
    bins = [raw.subarray(28 + length)];
  } else {
    source = JSON.parse(raw);
    bins = await Promise.all(source.buffers.map(buffer => fs.readFile(path.resolve(path.dirname(file), buffer.uri))));
  }
  const doc = structuredClone(source), chunks = [], meshes = [];
  doc.bufferViews = []; doc.accessors = [];
  let length = 0, geometryBytes = 0, textureBytes = 0;
  const read = index => {
    const a = source.accessors[index], v = source.bufferViews[a.bufferView], T = types[a.componentType], size = sizes[a.type];
    if (!T || !size || a.sparse) throw new Error(`Unsupported accessor ${name}:${index}`);
    const values = new T(a.count * size), data = bins[v.buffer];
    const start = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || size * T.BYTES_PER_ELEMENT;
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) {
      const offset = start + i * stride + k * T.BYTES_PER_ELEMENT;
      values[i * size + k] = T === Float32Array ? data.readFloatLE(offset) : T === Uint32Array ? data.readUInt32LE(offset)
        : T === Uint16Array ? data.readUInt16LE(offset) : T === Int16Array ? data.readInt16LE(offset)
          : T === Int8Array ? data.readInt8(offset) : data.readUInt8(offset);
    }
    return values;
  };
  const pushView = (bytes, target) => {
    const padding = (4 - length % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
    const index = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); length += bytes.length;
    return index;
  };
  const pushAccessor = (values, template, size, target) => {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    const accessor = { ...template, bufferView: pushView(bytes, target), byteOffset: 0, count: values.length / size };
    delete accessor.min; delete accessor.max;
    if (template.min || template.max) {
      accessor.min = Array(size).fill(Infinity); accessor.max = Array(size).fill(-Infinity);
      for (let i = 0; i < values.length; i++) {
        accessor.min[i % size] = Math.min(accessor.min[i % size], values[i]);
        accessor.max[i % size] = Math.max(accessor.max[i % size], values[i]);
      }
    }
    geometryBytes += bytes.length;
    return doc.accessors.push(accessor) - 1;
  };

  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) !== 4 || primitive.targets) throw new Error(`Unsupported primitive in ${name}`);
    const positions = read(primitive.attributes.POSITION), normals = read(primitive.attributes.NORMAL), uvs = read(primitive.attributes.TEXCOORD_0);
    const original = new Uint32Array(read(primitive.indices));
    const attributes = new Float32Array(positions.length / 3 * 5), locks = new Uint8Array(positions.length / 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < locks.length; i++) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i * 3 + k]); max[k] = Math.max(max[k], positions[i * 3 + k]);
    }
    const materialName = source.materials[primitive.material]?.name ?? '';
    const foliage = name === 'conifers' && materialName.includes('twig');
    for (let i = 0; i < locks.length; i++) {
      attributes.set([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uvs[i * 2], uvs[i * 2 + 1]], i * 5);
      for (let k = 0; k < 3; k++) if (positions[i * 3 + k] === min[k] || positions[i * 3 + k] === max[k]) locks[i] = 1;
      // Retain the actual soil collar. Keeping the entire lower 1.6 m would
      // accidentally lock nearly all triangles in the separate trunk scans.
      if (name === 'conifers' && !foliage && positions[i * 3 + 1] < min[1] + .145) locks[i] = 1;
    }
    if (name === 'conifers' && !foliage) {
      // Keep the lower trunk's lateral extrema for runtime collision fitting.
      for (let direction = 0; direction < 16; direction++) {
        const angle = direction / 16 * Math.PI * 2;
        let best = -Infinity, vertex = -1;
        for (let i = 0; i < locks.length; i++) if (positions[i * 3 + 1] < min[1] + 1.6) {
          const score = positions[i * 3] * Math.cos(angle) + positions[i * 3 + 2] * Math.sin(angle);
          if (score > best) { best = score; vertex = i; }
        }
        if (vertex >= 0) locks[vertex] = 1;
      }
    }
    const flags = name === 'conifers' ? ['Permissive'] : [];
    const limit = foliage ? .028 : errorLimit;
    // The young fir is already sparse. Preserve most of its cards; only the
    // heavily overlapping mature canopies can tolerate stronger reduction.
    const foliageRatio = original.length / 3 < 6000 ? .80 : .40;
    const target = Math.max(3, Math.floor(original.length * (foliage ? foliageRatio : ratio) / 3) * 3);
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(original, positions, 3, attributes, 5,
      [.1, .1, .1, .15, .15], locks, target, limit, flags);
    if (reduced.length < 3) throw new Error(`Empty simplified mesh ${name}:${mesh.name}`);
    // Prune may remove a tiny leaf component even when it contains a locked
    // vertex. Restore the few source triangles carrying extrema, keeping the
    // authored canopy envelope while removing redundant interior cards.
    const retainedVertices = new Set(reduced), restore = [];
    if (foliage) for (let i = 0; i < original.length; i += 3) {
      const tri = original.subarray(i, i + 3);
      if (tri.some(vertex => locks[vertex] && !retainedVertices.has(vertex))) {
        restore.push(...tri); tri.forEach(vertex => retainedVertices.add(vertex));
      }
    }
    const indices = new Uint32Array([...reduced, ...restore]);
    const [compactRemap, usedVertices] = MeshoptSimplifier.compactMesh(indices);
    const remap = new Uint32Array(locks.length); remap.fill(0xffffffff); remap.set(compactRemap);
    let vertices = usedVertices;
    // Collision seating reads vertex positions, including original unindexed
    // root samples. Retain only those samples and bounds extrema as metadata
    // vertices, rather than all original scan vertices. They add no triangles.
    if (name === 'conifers') for (let i = 0; i < locks.length; i++) {
      const preserve = locks[i] || (!foliage && positions[i * 3 + 1] < min[1] + 1.6);
      if (preserve && remap[i] === 0xffffffff) remap[i] = vertices++;
    }
    const indexedBounds = [Array(3).fill(Infinity), Array(3).fill(-Infinity)];
    for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let k = 0; k < 3; k++) {
      indexedBounds[0][k] = Math.min(indexedBounds[0][k], positions[i * 3 + k]);
      indexedBounds[1][k] = Math.max(indexedBounds[1][k], positions[i * 3 + k]);
    }
    for (const [semantic, oldIndex] of Object.entries(primitive.attributes)) {
      const a = source.accessors[oldIndex], old = read(oldIndex), size = sizes[a.type];
      const values = new types[a.componentType](vertices * size);
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff)
        values.set(old.subarray(i * size, (i + 1) * size), remap[i] * size);
      primitive.attributes[semantic] = pushAccessor(values, a, size, 34962);
    }
    const indexValues = vertices < 65536 ? new Uint16Array(indices) : indices;
    primitive.indices = pushAccessor(indexValues, { componentType: vertices < 65536 ? 5123 : 5125, type: 'SCALAR' }, 1, 34963);
    meshes.push({ name: mesh.name, material: materialName, foliage, beforeTriangles: original.length / 3,
      afterTriangles: indices.length / 3, beforeVertices: locks.length, afterVertices: vertices,
      relativeError: error, errorLimit: limit, maxPositionErrorBound: error * MeshoptSimplifier.getScale(positions, 3),
      flags, rootCollarLocked: name === 'conifers' && !foliage, retainedMetadataVertices: vertices - usedVertices,
      beforeBounds: [min, max], afterBounds: indexedBounds });
  }
  for (const image of doc.images ?? []) {
    if (image.bufferView !== undefined) {
      const view = source.bufferViews[image.bufferView];
      const bytes = bins[view.buffer].subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      image.bufferView = pushView(bytes); textureBytes += bytes.length;
    } else if (image.uri && !image.uri.startsWith('data:')) {
      image.uri = path.relative(out, path.resolve(path.dirname(file), image.uri)).replaceAll('\\', '/');
    }
  }
  const bin = Buffer.concat(chunks);
  doc.buffers = [{ uri: `${name}.bin`, byteLength: bin.length }];
  doc.asset.generator = 'Tear balanced forest: bounded mesh simplification and compact immutable vertex buffers';
  const json = JSON.stringify(doc);
  await fs.writeFile(path.join(out, `${name}.bin`), bin);
  await fs.writeFile(path.join(out, `${name}.gltf`), json);
  const optimized = JSON.parse(await fs.readFile(path.join(root, 'optimized', `${name}.gltf`), 'utf8'));
  const previousTriangles = optimized.meshes.flatMap(m => m.primitives).reduce((n, p) => n + optimized.accessors[p.indices].count / 3, 0);
  const entry = { name, source: relative, sourceSHA256: hash(raw), previousRuntimeTriangles: previousTriangles,
    balancedTriangles: meshes.reduce((n, m) => n + m.afterTriangles, 0),
    previousRuntimeBufferBytes: optimized.buffers.reduce((n, b) => n + b.byteLength, 0),
    balancedBufferBytes: bin.length, compactGeometryBytes: geometryBytes, unchangedEmbeddedTextureBytes: textureBytes,
    meshes, bufferSHA256: hash(bin), gltfSHA256: hash(json) };
  report.push(entry);
  console.log(JSON.stringify({ name, previousTriangles, triangles: entry.balancedTriangles,
    previousBytes: entry.previousRuntimeBufferBytes, bytes: bin.length, geometryBytes, textureBytes }));
}
await fs.writeFile(path.join(out, 'SOURCE.json'), JSON.stringify({ license: 'CC0-1.0',
  processing: 'Attribute-aware bounded simplification; original UV/normal values on retained vertices; compact vertex/index buffers. Conifers use permissive simplification with higher retention for young canopy. Original woody root/collar samples and mesh extrema retained as unindexed metadata vertices. No texture resampling.',
  sources: ['../sample/SOURCE-MANIFEST.json', '../conifers/SOURCE-MANIFEST.json', '../fern_02', '../tree_stump_01'],
  limitations: 'Foliage pruning changes canopy coverage; bounds and triangle counts are not proof of pixel-identical silhouettes. Review the live forest before accepting.',
  assets: report }, null, 2));
