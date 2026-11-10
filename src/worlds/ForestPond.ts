import * as THREE from 'three';

export const FOREST_POND_LEVEL = .065;
export type PondPoint = { x: number; z: number };

export function forestPondRadius(x: number, z: number) {
  const nx = (x - 5) / 2.4, nz = (z + 9) / 4.2;
  const angle = Math.atan2(nz, nx);
  return Math.hypot(nx, nz) / (1 + .12 * Math.sin(angle * 3 + .7) + .05 * Math.sin(angle * 7));
}

/** A shallow earth lip holds the higher water. Both feet and planting use this
 * same terrain; the sample boundary and the rest of the forest stay untouched. */
export function forestPondBankLift(x: number, z: number) {
  const r = forestPondRadius(x, z);
  const radial = .17 * THREE.MathUtils.smoothstep(r, .72, 1.08)
    * (1 - THREE.MathUtils.smoothstep(r, 1.1, 1.48))
    * (1 - THREE.MathUtils.smoothstep(z, -5, -4.65));
  // Close the low northern saddle before the existing review patch. The lip
  // is broad enough to survive the floor's 43.75 cm vertex spacing.
  const north = .24 * THREE.MathUtils.smoothstep(z, -5.9, -5.2)
    * (1 - THREE.MathUtils.smoothstep(z, -5, -4.65))
    * (1 - THREE.MathUtils.smoothstep(Math.abs(x - 5), 1.8, 3));
  return Math.max(radial, north);
}

/** Clip the actual floor triangles at the water plane. Interpolated depth is
 * therefore exact, including at the shore, rather than a painted oval mask. */
export function forestPondGeometry(terrain: THREE.BufferGeometry) {
  const source = terrain.attributes.position, indices = terrain.index!;
  const p: number[] = [], depths: number[] = [], uv: number[] = [];
  type Vertex = { x: number; y: number; z: number };
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const root = find(next); parent.set(id, root); return root;
  };
  const candidates: { triangle: Vertex[]; submerged: number[] }[] = [];
  let seed = -1, nearest = Infinity;
  for (let i = 0; i < indices.count; i += 3) {
    const triangle: Vertex[] = [];
    const submerged: number[] = [];
    for (let j = 0; j < 3; j++) {
      const k = indices.getX(i + j);
      triangle.push({ x: source.getX(k), y: source.getY(k), z: source.getZ(k) });
      if (source.getY(k) < FOREST_POND_LEVEL) submerged.push(k);
    }
    const cx = (triangle[0].x + triangle[1].x + triangle[2].x) / 3;
    const cz = (triangle[0].z + triangle[1].z + triangle[2].z) / 3;
    // Outside the containing bank there are unrelated low areas of forest.
    if (forestPondRadius(cx, cz) > 1.22 || !submerged.length) continue;
    for (const id of submerged) {
      if (!parent.has(id)) parent.set(id, id);
      const distance = (source.getX(id) - 5) ** 2 + (source.getZ(id) + 9) ** 2;
      if (distance < nearest) { seed = id; nearest = distance; }
    }
    for (const id of submerged) parent.set(find(id), find(submerged[0]));
    candidates.push({ triangle, submerged });
  }
  // Fill only the connected bowl. Low forest ground beyond the bank is not
  // part of this body of water, even if it is below the new water elevation.
  const basin = seed < 0 ? -1 : find(seed);
  for (const { triangle, submerged } of candidates) {
    if (find(submerged[0]) !== basin) continue;
    const clipped: Vertex[] = [];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      const insideA = a.y < FOREST_POND_LEVEL, insideB = b.y < FOREST_POND_LEVEL;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) {
        const t = (FOREST_POND_LEVEL - a.y) / (b.y - a.y);
        clipped.push({ x: a.x + (b.x - a.x) * t, y: FOREST_POND_LEVEL, z: a.z + (b.z - a.z) * t });
      }
    }
    for (let j = 1; j < clipped.length - 1; j++) {
      for (const v of [clipped[0], clipped[j], clipped[j + 1]]) {
        p.push(v.x, FOREST_POND_LEVEL, v.z);
        depths.push(Math.max(0, FOREST_POND_LEVEL - v.y));
        uv.push(v.x / 2.8, v.z / 2.8);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('pondDepth', new THREE.Float32BufferAttribute(depths, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

export function forestPondShore(heightAt: (x: number, z: number) => number): PondPoint[] {
  return Array.from({ length: 96 }, (_, i) => {
    const a = i / 96 * Math.PI * 2, dx = Math.cos(a) * 2.4, dz = Math.sin(a) * 4.2;
    let lo = .2, hi = .2;
    while (hi < 1.6 && heightAt(5 + dx * hi, -9 + dz * hi) < FOREST_POND_LEVEL) {
      lo = hi; hi += .02;
    }
    for (let j = 0; j < 22; j++) {
      const mid = (lo + hi) / 2;
      if (heightAt(5 + dx * mid, -9 + dz * mid) < FOREST_POND_LEVEL) lo = mid; else hi = mid;
    }
    return { x: 5 + dx * hi, z: -9 + dz * hi };
  });
}

/** Two small opposing ripple scales, precomputed once. No per-frame geometry,
 * reflection camera, refraction target, or full-scene transmission pass. */
export function forestPondMaterial(time: { value: number }) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = x / size * Math.PI * 2, b = y / size * Math.PI * 2;
    const nx = .11 * Math.cos(a * 3 + b * 2 + .7 * Math.sin(b * 5)) + .045 * Math.cos(a * 7 - b * 5);
    const ny = .08 * Math.cos(a * 2 - b * 3 + .9 * Math.sin(a * 4)) - .045 * Math.cos(a * 5 + b * 7);
    const n = new THREE.Vector3(nx, ny, 1).normalize();
    data.set([(n.x * .5 + .5) * 255, (n.y * .5 + .5) * 255, (n.z * .5 + .5) * 255, 255], (y * size + x) * 4);
  }
  const normal = new THREE.DataTexture(data, size, size);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.magFilter = THREE.LinearFilter; normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.generateMipmaps = true; normal.needsUpdate = true;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x526e5b, roughness: .18, metalness: 0, ior: 1.333,
    clearcoat: 0, transmission: 0, envMapIntensity: .85,
    normalMap: normal, normalScale: new THREE.Vector2(.55, .55),
    transparent: true, opacity: .88, depthWrite: false,
    side: THREE.FrontSide, forceSinglePass: true
  });
  material.name = 'Forest pond · shallow olive water and fine ripples';
  material.onBeforeCompile = shader => {
    shader.uniforms.pondTime = time;
    shader.vertexShader = 'attribute float pondDepth;\nvarying float vPondDepth;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPondDepth = pondDepth;');
    shader.fragmentShader = 'uniform float pondTime;\nvarying float vPondDepth;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float pondBody = smoothstep(.015, .29, vPondDepth);
      // The existing bed shows through the shallows; opacity reaches zero at
      // the exact terrain intersection, eliminating the hard polygon outline.
      diffuseColor.rgb *= mix(vec3(1.30,1.20,.94), vec3(.73,.91,.92), pondBody);
      diffuseColor.a *= smoothstep(0.0,.035,vPondDepth) * mix(.46,1.0,pondBody);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = mix(.34,roughnessFactor,smoothstep(.0,.10,vPondDepth));');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec3 rippleA = texture2D(normalMap,vNormalMapUv+vec2(pondTime*.010,pondTime*.006)).xyz*2.0-1.0;
        vec3 rippleB = texture2D(normalMap,vNormalMapUv*1.73+vec2(-pondTime*.006,pondTime*.009)).xyz*2.0-1.0;
        vec3 mapN = normalize(vec3((rippleA.xy+rippleB.xy*.45)*smoothstep(0.0,.07,vPondDepth),1.0));
      `));
  };
  material.customProgramCacheKey = () => 'forest-pond-depth-ripples-v1';
  return material;
}

/** Apply after the existing forest floor hooks. This narrow, height-based damp
 * band shares the floor's real photographs and adds no geometry or draw call. */
export function applyForestPondBank(material: THREE.MeshStandardMaterial) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      float pondDistance = length((vForestLocal.xz-vec2(5.0,-9.0))/vec2(2.4,4.2));
      float pondBankMask = 1.0-smoothstep(1.08,1.5,pondDistance);
      float pondWet = pondBankMask*(1.0-smoothstep(${FOREST_POND_LEVEL.toFixed(3)},.24,vForestLocal.y));
      diffuseColor.rgb *= mix(vec3(1.0),vec3(.64,.71,.65),pondWet);
      #include <roughnessmap_fragment>
    `);
    // Applied after all the floor's normal roughness clamps, including litter.
    shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>',
      'roughnessFactor = mix(roughnessFactor,.61,pondWet);\n#include <metalnessmap_fragment>');
  };
  material.customProgramCacheKey = () => `${key}|pond-damp-bank-v1`;
  material.needsUpdate = true;
}
