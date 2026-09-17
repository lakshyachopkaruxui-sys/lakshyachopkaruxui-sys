#!/usr/bin/env node
/**
 * Bake deterministic trees once, keeping EZ-Tree out of the application bundle.
 * Run from any directory: node scripts/bake-trees.mjs
 * GLBs intentionally omit images. Assign the documented local textures at runtime.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(projectRoot, 'node_modules/@dgreenheck/ez-tree');
const modelDir = resolve(projectRoot, 'public/models/refined');
const textureDir = resolve(projectRoot, 'public/textures/refined');

// EZ-Tree eagerly constructs TextureLoader images during its import. Generation
// only needs geometry, so these inert images avoid all network/canvas work.
globalThis.document = {
  createElementNS() {
    return {
      addEventListener() {}, removeEventListener() {},
      set src(value) { this._src = value; }, get src() { return this._src; },
    };
  },
};
globalThis.FileReader = class {
  async readAsArrayBuffer(blob) {
    try {
      this.result = await blob.arrayBuffer();
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    } catch (error) { this.onerror?.(error); }
  }
};

const { Tree } = await import('@dgreenheck/ez-tree');
const { version } = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
assert.equal(version, '1.1.0', 'Revalidate assets before changing the generator version.');
await mkdir(modelDir, { recursive: true });
await mkdir(textureDir, { recursive: true });

const details = [];
for (const [species, seed, lod] of [
  ['oak', 35729, false], ['ash', 36330, false],
  ['oak', 35729, true], ['ash', 36330, true],
]) {
  const assetName = lod ? `${species}_lod` : species;
  const preset = JSON.parse(await readFile(
    resolve(packageRoot, `src/lib/presets/${species}_medium.json`), 'utf8'));
  preset.seed = seed;
  preset.bark.flatShading = false;
  // Preserve species-specific growth, while giving trunks a smooth silhouette
  // and bounding twig/leaf counts for repeated use in a mobile XR scene.
  preset.branch.children = lod ? { 0: 4, 1: 3, 2: 1 } : { 0: 5, 1: 3, 2: 2 };
  preset.branch.sections = lod ? { 0: 8, 1: 4, 2: 2, 3: 1 } : { 0: 10, 1: 5, 2: 3, 3: 1 };
  preset.branch.segments = lod ? { 0: 8, 1: 4, 2: 3, 3: 3 } : { 0: 12, 1: 6, 2: 4, 3: 3 };
  preset.leaves.count = lod ? 8 : species === 'oak' ? 16 : 15;
  // Broader leaf clusters fill out the canopy without increasing triangle count.
  preset.leaves.size *= 1.45;
  preset.leaves.billboard = 'double';
  preset.leaves.alphaTest = 0.45;

  const generated = new Tree();
  generated.loadFromJson(preset);
  const bounds = new THREE.Box3().setFromObject(generated);
  const scale = 8 / (bounds.max.y - bounds.min.y);
  // Original generator trunk is centered at x=z=0. Do not re-center the canopy.
  const normalization = new THREE.Matrix4().makeScale(scale, scale, scale);
  normalization.setPosition(0, -bounds.min.y * scale, 0);
  const exported = new THREE.Group();
  exported.name = assetName;
  exported.userData = {
    species, generator: '@dgreenheck/ez-tree@1.1.0', seed,
    heightMeters: 8, trunkBase: [0, 0, 0],
    runtimeTextures: `/textures/refined/${species}_leaves.png`,
  };

  let triangleCount = 0;
  for (const [name, original] of [['bark', generated.branchesMesh], ['leaves', generated.leavesMesh]]) {
    const geometry = original.geometry.clone();
    geometry.applyMatrix4(normalization);
    // Convert the generator's OpenGL-style UVs for unflipped PNG/JPG use in
    // glTF. Runtime TextureLoader maps must have flipY=false for these assets.
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    // The generator reuses one normal direction for crossed leaf cards.
    // Recompute the card normals so each plane is lit according to its surface.
    if (name === 'leaves') geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    for (const attribute of Object.values(geometry.attributes)) {
      assert(Array.from(attribute.array).every(Number.isFinite), `${species}/${name}: nonfinite attribute`);
    }
    assert.equal(geometry.index.count % 3, 0);
    assert(Math.max(...geometry.index.array) < geometry.attributes.position.count);
    triangleCount += geometry.index.count / 3;
    const material = new THREE.MeshStandardMaterial({
      name, color: 0xffffff, roughness: 0.92, metalness: 0,
      ...(name === 'leaves' ? { alphaTest: 0.45, side: THREE.DoubleSide } : {}),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    exported.add(mesh);
  }
  const normalizedBounds = new THREE.Box3().setFromObject(exported);
  assert(Math.abs(normalizedBounds.min.y) < 1e-5, `${species}: base must be at 0m`);
  assert(Math.abs(normalizedBounds.max.y - 8) < 1e-5, `${species}: height must be 8m`);
  assert(triangleCount <= (lod ? 3000 : 10000), `${assetName}: ${triangleCount} triangles exceeds the budget`);
  const buffer = await new GLTFExporter().parseAsync(exported, {
    binary: true, onlyVisible: true,
    copyright: 'Generated with EZ-Tree (c) 2024 Daniel Greenheck, MIT; see LICENSE-EZ-TREE.txt',
  });
  const output = resolve(modelDir, `${assetName}.glb`);
  await writeFile(output, Buffer.from(buffer));
  details.push({
    species: assetName, seed, leafSizeMultiplier: 1.45,
    ...(lod ? { sourceSpecies: species, detail: 'distant' } : {}),
    triangles: triangleCount, bytes: (await stat(output)).size,
    bounds: { min: normalizedBounds.min.toArray(), max: normalizedBounds.max.toArray() },
    meshes: exported.children.map(mesh => ({
      name: mesh.name, material: mesh.material.name,
      triangles: mesh.geometry.index.count / 3,
    })),
  });
}

for (const kind of ['color', 'normal', 'roughness']) {
  await copyFile(resolve(packageRoot, `src/lib/assets/bark/oak_${kind}_1k.jpg`),
    resolve(textureDir, `oak_${kind}.jpg`));
}
for (const species of ['oak', 'ash']) {
  await copyFile(resolve(packageRoot, `src/lib/assets/leaves/${species}_color.png`),
    resolve(textureDir, `${species}_leaves.png`));
}
for (const dir of [textureDir, modelDir]) {
  await copyFile(resolve(packageRoot, 'LICENSE'), resolve(dir, 'LICENSE-EZ-TREE.txt'));
}
const provenance = `# Refined tree assets\n\nGenerated by scripts/bake-trees.mjs from @dgreenheck/ez-tree 1.1.0.\n\n- Tree generator and bundled leaf images: Copyright (c) 2024 Daniel Greenheck, MIT. The package includes no separate leaf-image license; its MIT license is preserved in LICENSE-EZ-TREE.txt. Repository: https://github.com/dgreenheck/ez-tree\n- Oak bark maps (also used on the ash model): Poly Haven Bark Brown 02, CC0. Source: https://polyhaven.com/a/bark_brown_02 ; license: https://polyhaven.com/license . The bundled source attribution is preserved as BARK-SOURCES.md.\n- PNG leaves are 1024×1024 with transparency; bark maps are 1K. No texture pixels have been modified.\n\n## Runtime material assignment\n\nEach GLB has two meshes/materials named bark and leaves, no embedded images, and identity node transforms. All trees are 8 meters high; the trunk's x/z origin remains 0. Bounds are not centered around the canopy.\n\nSet every map.flipY=false. Set bark color map and leaf map colorSpace=THREE.SRGBColorSpace; normal/roughness maps remain linear. Bark map paths are oak_color.jpg, oak_normal.jpg, oak_roughness.jpg. Leaves use the matching species_leaves.png. Use DoubleSide and alphaTest=0.45 on leaves, transparent=false, depthWrite=true. Use white or subtly muted material tint rather than an opaque color replacement. The leaf PNG alpha mask is essential: an unmapped leaf material displays rectangles.\n\nTextures are separate so every instance and both tree species can share bark maps. Generate trees only at build time; load these GLBs in the application.\n`;
const lodNotes = '\n## Distant variants\n\n`oak_lod.glb` and `ash_lod.glb` reuse the matching full-detail species preset, seed, 1.45 leaf-size multiplier, and texture maps. Each has 2,816 triangles and is normalized to 8 meters, with its trunk at x=z=0 and lowest vertex at y=0. They keep the bark/leaves mesh and material names. Reduced branch counts and sections make these distant companion variants; their canopy outlines are not identical, so choose a variant by planting distance rather than visibly swapping it near the viewer. No additional textures or licenses are needed.\n';
await writeFile(resolve(modelDir, 'README.md'), provenance + lodNotes);
await writeFile(resolve(textureDir, 'README.md'), provenance + lodNotes);
await copyFile(resolve(packageRoot, 'src/lib/assets/bark/README.md'), resolve(textureDir, 'BARK-SOURCES.md'));
await writeFile(resolve(modelDir, 'manifest.json'), JSON.stringify(details, null, 2) + '\n');
console.log(JSON.stringify(details, null, 2));
