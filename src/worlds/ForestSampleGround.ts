import * as THREE from 'three';
import { FOREST_SAMPLE, SAMPLE_COLONIES } from './ForestSampleLayout';

/** Local soil exposure shares the planting colonies. The exact inward mask
 * leaves every fragment outside the approved rectangle unchanged. */
export function sampleSoilAt(x: number, z: number) {
  const edge = Math.min(x - FOREST_SAMPLE.minX, FOREST_SAMPLE.maxX - x,
    z - FOREST_SAMPLE.minZ, FOREST_SAMPLE.maxZ - z);
  const weight = THREE.MathUtils.smoothstep(edge, 0, .45);
  const colony = Math.max(...SAMPLE_COLONIES.map(p => 1 - THREE.MathUtils.smoothstep(
    Math.hypot(x - p.x, z - p.z), p.radius * .35, p.radius)));
  const variation = .5 + .25 * Math.sin(x * 3.3 + Math.sin(z * 1.7)) + .25 * Math.cos(z * 3.9 - x * 1.1);
  return { weight, soil: THREE.MathUtils.clamp(.78 - .30 * colony + .12 * (variation - .5), .42, .84) };
}

/** Reuse the existing soil color, normal and roughness in the same floor pass.
 * Called only after the new sample and the layered floor have loaded. */
export function applySampleSoil(material: THREE.MeshStandardMaterial) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const n = (value: number) => value.toFixed(4);
  const colonyCode = SAMPLE_COLONIES.map(p => `
    sampleColony = max(sampleColony, 1.0-smoothstep(${n(p.radius * .35)}, ${n(p.radius)},
      distance(forestXZ, vec2(${n(p.x)}, ${n(p.z)}))));`).join('');
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('float forestMix = forestContext.g;', `
      float forestMix = forestContext.g;
      vec2 sampleEdges = min(forestXZ-vec2(${n(FOREST_SAMPLE.minX)},${n(FOREST_SAMPLE.minZ)}),
        vec2(${n(FOREST_SAMPLE.maxX)},${n(FOREST_SAMPLE.maxZ)})-forestXZ);
      float sampleWeight = smoothstep(0.0,.45,min(sampleEdges.x,sampleEdges.y));
      if (sampleWeight > 0.0) {
        float sampleColony = 0.0;${colonyCode}
        float sampleVariation = .5+.25*sin(forestXZ.x*3.3+sin(forestXZ.y*1.7))
          +.25*cos(forestXZ.y*3.9-forestXZ.x*1.1);
        float sampleSoil = clamp(.78-.30*sampleColony+.12*(sampleVariation-.5),.42,.84);
        forestMix = mix(forestMix,max(forestMix,sampleSoil),sampleWeight);
      }
    `);
  };
  material.customProgramCacheKey = () => `${key}|sample-soil-v1`;
  material.userData.forestSampleSoil = { bounds: FOREST_SAMPLE, colonies: SAMPLE_COLONIES };
  material.needsUpdate = true;
}
