// Build error-bounded index reductions. Keep original vertices, UVs, normals,
// materials and textures; do not remove instances or prune foliage islands.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const root = fileURLToPath(new URL('../public/models/forest/', import.meta.url));
const out = path.join(root, 'optimized'); await fs.mkdir(out, { recursive: true });
const inputs = [
  ['grass', 'sample/grass_medium_01/sample.gltf', .008],
  ['rocks', 'sample/rock_moss_set_01/sample.gltf', .006],
  ['branches', 'sample/dry_branches_medium_01/sample.gltf', .006],
  ['ferns', 'fern_02/fern_02_1k.gltf', .005],
  ['stumps', 'tree_stump_01/tree_stump_01_1k.gltf', .003],
  ['conifers', 'conifers/fir_tree_01.glb', .002]
];
const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const report = [];
for (const [name, relative, errorLimit] of inputs) {
  const file = path.join(root, relative), raw = await fs.readFile(file);
  let doc, bins;
  if (relative.endsWith('.glb')) {
    const n = raw.readUInt32LE(12); doc = JSON.parse(raw.subarray(20, 20+n)); bins = [raw.subarray(28+n)];
  } else {
    doc = JSON.parse(raw); bins = await Promise.all(doc.buffers.map(b => fs.readFile(path.resolve(path.dirname(file), b.uri))));
  }
  const read = index => {
    const a = doc.accessors[index], v = doc.bufferViews[a.bufferView], T = types[a.componentType], size = sizes[a.type];
    const values = new T(a.count * size), source = bins[v.buffer];
    const start = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || size*T.BYTES_PER_ELEMENT;
    for (let i=0;i<a.count;i++) for (let k=0;k<size;k++) {
      const offset = start+i*stride+k*T.BYTES_PER_ELEMENT;
      values[i*size+k] = T===Float32Array ? source.readFloatLE(offset) : T===Uint32Array ? source.readUInt32LE(offset) : T===Uint16Array ? source.readUInt16LE(offset) : source.readUInt8(offset);
    }
    return values;
  };
  const extra = [], meshes = []; let length=0;
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
    if (primitive.mode && primitive.mode!==4) continue;
    const positions = read(primitive.attributes.POSITION), normals = read(primitive.attributes.NORMAL), uvs = read(primitive.attributes.TEXCOORD_0);
    const original = new Uint32Array(read(primitive.indices)), attributes = new Float32Array(positions.length/3*5);
    const locks = new Uint8Array(positions.length/3), min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<positions.length/3;i++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i*3+k]);max[k]=Math.max(max[k],positions[i*3+k]);}
    for(let i=0;i<locks.length;i++) {
      attributes.set([normals[i*3],normals[i*3+1],normals[i*3+2],uvs[i*2],uvs[i*2+1]],i*5);
      for(let k=0;k<3;k++)if(positions[i*3+k]===min[k]||positions[i*3+k]===max[k])locks[i]=1;
    }
    const [indices,error] = MeshoptSimplifier.simplifyWithAttributes(original,positions,3,attributes,5,[.1,.1,.1,.15,.15],locks,
      Math.max(3,Math.floor(original.length*.25/3)*3),errorLimit,[]);
    const bytes=Buffer.from(indices.buffer,indices.byteOffset,indices.byteLength);
    const view=doc.bufferViews.push({buffer:bins.length,byteOffset:length,byteLength:bytes.length,target:34963})-1;
    primitive.indices=doc.accessors.push({bufferView:view,componentType:5125,count:indices.length,type:'SCALAR'})-1;
    extra.push(bytes); length+=bytes.length;
    meshes.push({name:mesh.name,beforeTriangles:original.length/3,afterTriangles:indices.length/3,relativeError:error,errorLimit,
      maxPositionErrorBound:error*MeshoptSimplifier.getScale(positions,3),boundsLocked:true});
  }
  for(const image of doc.images||[])if(image.uri&&!image.uri.startsWith('data:'))
    image.uri=path.relative(out,path.resolve(path.dirname(file),image.uri)).replaceAll('\\','/');
  for(let i=0;i<bins.length;i++) {
    // External source buffers are shared, not copied. Embedded GLB bytes need
    // one extracted buffer; their image payloads remain unchanged.
    if(doc.buffers[i].uri) doc.buffers[i].uri=path.relative(out,path.resolve(path.dirname(file),doc.buffers[i].uri)).replaceAll('\\','/');
    else {doc.buffers[i].uri=name+'-source.bin';await fs.writeFile(path.join(out,doc.buffers[i].uri),bins[i]);}
  }
  const newBin=Buffer.concat(extra); await fs.writeFile(path.join(out,name+'-indices.bin'),newBin);
  doc.buffers.push({uri:name+'-indices.bin',byteLength:newBin.length});
  doc.asset.generator='Tear forest: bounded index simplification, existing textures and vertices unchanged';
  const json=JSON.stringify(doc);await fs.writeFile(path.join(out,name+'.gltf'),json);
  report.push({name,source:relative,sourceSHA256:createHash('sha256').update(raw).digest('hex'),meshes,
    indexSHA256:createHash('sha256').update(newBin).digest('hex'),gltfSHA256:createHash('sha256').update(json).digest('hex')});
}
await fs.writeFile(path.join(out,'SOURCE.json'),JSON.stringify({license:'CC0-1.0',
  processing:'meshoptimizer error-bounded index reduction. Original positions, normals, UVs and textures preserved; bounds locked; no foliage pruning or instance removal.',
  sources:'See ../sample/SOURCE-MANIFEST.json and original model source records for Poly Haven attribution.',assets:report},null,2));
for(const asset of report)console.log(asset.name,JSON.stringify(asset.meshes));
