import * as THREE from 'three';
import { assetUrl } from '../utils/assetUrl';
import { HeightField } from './terrain';
import { forestPlantingSpots } from './ForestDetails';
import { FOREST_SAMPLE, SAMPLE_COLONIES, inForestSample } from './ForestSampleLayout';
import { applySampleSoil } from './ForestSampleGround';

const centre = { x: 4, z: -2 };
const retainedPlants = forestPlantingSpots().filter(p => inForestSample(p.x, p.z));

/** Small raised organic deposits, rather than camera motion or steep terrain.
 * Zero height at the perimeter and existing fern crowns keeps the seam seated. */
export function sampleReliefAt(x: number, z: number) {
  const edge = Math.min(x - FOREST_SAMPLE.minX, FOREST_SAMPLE.maxX - x,
    z - FOREST_SAMPLE.minZ, FOREST_SAMPLE.maxZ - z);
  let plantClearance = 1;
  for (const p of retainedPlants) plantClearance = Math.min(plantClearance,
    THREE.MathUtils.smoothstep(Math.hypot(x - p.x, z - p.z), .16, .45));
  const colony = Math.max(...SAMPLE_COLONIES.map(p => Math.exp(-((x - p.x) ** 2 + (z - p.z) ** 2) / (p.radius * .55) ** 2)));
  const breakup = .5 + .25 * Math.sin(x * 5.1 + Math.sin(z * 2.4)) + .25 * Math.cos(z * 4.3 - x * 1.4);
  return THREE.MathUtils.smoothstep(edge, 0, .4) * plantClearance * (.012 + .068 * colony + .024 * breakup);
}

/** This fine grid supplies both the visible surface and exact foot/prop heights. */
export class ForestSampleSurface {
  readonly field: HeightField;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

  constructor(baseGround: (x: number, z: number) => number, source: THREE.MeshStandardMaterial,
    litter: THREE.Texture[]) {
    this.field = new HeightField(5, 64, (x, z) => baseGround(x + centre.x, z + centre.z)
      + sampleReliefAt(x + centre.x, z + centre.z));
    const geometry = this.field.geometry;
    geometry.translate(centre.x, 0, centre.z);
    const p = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 112 + .5, p.getZ(i) / 112 + .5);
    const material = source.clone();
    material.onBeforeCompile = source.onBeforeCompile;
    material.customProgramCacheKey = source.customProgramCacheKey;
    applySampleSoil(material);
    const previous = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.sampleLitterColor = { value: litter[0] };
      shader.uniforms.sampleLitterNormal = { value: litter[1] };
      shader.uniforms.sampleLitterARM = { value: litter[2] };
      shader.fragmentShader = 'uniform sampler2D sampleLitterColor, sampleLitterNormal, sampleLitterARM;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader
        .replace('texture2D(forestSoilColor, soilUV).rgb', 'mix(texture2D(forestSoilColor, soilUV).rgb, texture2D(sampleLitterColor,forestXZ/1.5).rgb*vec3(.82,.72,.56), sampleWeight)')
        .replaceAll('texture2D(forestSoilARM,soilUV)', 'mix(texture2D(forestSoilARM,soilUV),texture2D(sampleLitterARM,forestXZ/1.5),sampleWeight)')
        .replace('texture2D(forestSoilNormal,soilUV).xyz', 'mix(texture2D(forestSoilNormal,soilUV).xyz,texture2D(sampleLitterNormal,forestXZ/1.5).xyz,sampleWeight)');
    };
    material.customProgramCacheKey = () => `${key}|sample-relief-litter-v1`;
    material.polygonOffset = true; material.polygonOffsetFactor = -1;
    material.userData.sampleLitter = litter;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Forest sample moss and pine litter relief';
    this.mesh.receiveShadow = true;
  }

  heightAt(x: number, z: number) { return this.field.heightAt(x - centre.x, z - centre.z); }
}

export async function loadSampleLitter() {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(['Diffuse', 'nor_gl', 'arm'].map(kind =>
    loader.loadAsync(assetUrl(`/textures/forest-quality/forrest_ground_03_${kind}.jpg`))));
  if (results.some(result => result.status === 'rejected')) {
    results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
    throw new Error('Forest sample pine litter maps could not load');
  }
  const maps = results.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value);
  maps.forEach((map, i) => {
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
    map.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  });
  return maps;
}
