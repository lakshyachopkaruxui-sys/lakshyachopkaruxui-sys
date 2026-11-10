import * as THREE from 'three';
import { assetUrl } from '../utils/assetUrl';
import { coniferSpots, type ForestTreeBase } from './ForestConifers';

/** Broad, continuous patches shared by the ground material and sedge placement. */
export function forestGrowthAt(x: number, z: number) {
  const patch = .5 + .25 * Math.sin(x * .53 + Math.sin(z * .31))
    + .25 * Math.cos(z * .61 - x * .23);
  return THREE.MathUtils.smoothstep(patch, .22, .78);
}

/** Forest-local masks keep trail and root deposits aligned after rotated entry. */
export function forestSurfaceAt(x: number, z: number, trees: readonly ForestTreeBase[]) {
  const growth = forestGrowthAt(x, z);
  const edge = Math.sin(z * 1.7 + Math.sin(x * .8)) * .13;
  const path = Math.abs(x - Math.sin(z * .15) * 1.25);
  const trail = (1 - THREE.MathUtils.smoothstep(path + edge, .42, 1.48))
    * (1 - THREE.MathUtils.smoothstep(z, 1, 5));
  const shore = 1 - THREE.MathUtils.smoothstep(Math.hypot((x - 5) / 2.4, (z + 9) / 4.2), .9, 1.5);
  let shade = 0, roots = 0;
  for (const tree of trees) {
    const radius = 2.6 * tree.scale + .5;
    const dx = x - tree.x - 2.4 * tree.scale, dz = z - tree.z + 2.16 * tree.scale;
    const d = (dx * dx + dz * dz) / (radius * radius);
    if (d < 5) shade += Math.exp(-d * .85) * .48;
    // Soil collects around the measured trunk, not the asymmetric canopy centre.
    const rootDistance = Math.hypot(x - tree.x, z - tree.z);
    roots = Math.max(roots, 1 - THREE.MathUtils.smoothstep(rootDistance, .24 * tree.scale, 1.65 * tree.scale + .2));
  }
  const breakup = .88 + .12 * Math.sin(x * 1.7) * Math.cos(z * 1.3);
  return {
    illumination: 1 - Math.min(.48, shade * breakup),
    soil: Math.max(.12 + (1 - growth) * .2, trail * .86, shore * .84, roots * .88),
    moisture: shore * .65 + roots * .15,
    growth, trail, roots
  };
}

/** One linear data texture holds canopy light, soil coverage and moisture.
 * No screen-space effect, extra draw pass, or separate texture per tree. */
export function canopyLightMap(trees: readonly ForestTreeBase[] = coniferSpots()) {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i / (size - 1) - .5) * 112, z = (j / (size - 1) - .5) * 112;
    const surface = forestSurfaceAt(x, z, trees);
    data.set([Math.round(surface.illumination * 255), Math.round(surface.soil * 255),
      Math.round(surface.moisture * 255), 255], (j * size + i) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  texture.name = 'Forest-local canopy, root soil and moisture';
  return texture;
}

/** Reuse licensed moss/soil with a compatible earthy trail. All maps load
 * together; an unavailable scan leaves the existing fallback intact. */
export async function loadLayeredForestFloor(material: THREE.MeshStandardMaterial,
  roots: Promise<readonly ForestTreeBase[]> = Promise.resolve(coniferSpots())) {
  const loader = new THREE.TextureLoader();
  const files = ['/textures/refined/ground_color.jpg', '/textures/refined/ground_normal.jpg',
    '/textures/refined/ground_roughness.jpg', ...['Diffuse', 'nor_gl', 'arm'].map(kind =>
      `/textures/forest-quality/forest_ground_04_${kind}.jpg`)];
  const [results, treeBases] = await Promise.all([
    Promise.allSettled(files.map(file => loader.loadAsync(assetUrl(file)))), roots
  ]);
  if (results.some(result => result.status === 'rejected')) {
    results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
    console.warn('Layered forest surface unavailable; keeping original local materials.');
    return false;
  }
  const maps = results.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value);
  maps.forEach((texture, index) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = index % 3 === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
  });
  maps.slice(0, 3).forEach(texture => texture.repeat.setScalar(112 / 2.1));
  const previous = [material.map, material.normalMap, material.roughnessMap];
  [material.map, material.normalMap, material.roughnessMap] = maps;
  material.vertexColors = false; material.color.set(0xffffff);
  material.normalScale.set(.38, .38); material.roughness = 1;
  const canopy = canopyLightMap(treeBases);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { forestSoilColor: { value: maps[3] }, forestSoilNormal: { value: maps[4] },
      forestSoilARM: { value: maps[5] }, forestCanopy: { value: canopy } });
    shader.vertexShader = 'varying vec3 vForestLocal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvForestLocal = position;');
    shader.fragmentShader = `varying vec3 vForestLocal;
      uniform sampler2D forestSoilColor, forestSoilNormal, forestSoilARM, forestCanopy;
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      vec2 forestXZ = vForestLocal.xz;
      vec2 soilUV = forestXZ / 3.2;
      vec2 contextUV = (forestXZ/112.0+.5)*(255.0/256.0)+.5/256.0;
      vec3 forestContext = texture2D(forestCanopy, contextUV).rgb;
      float forestMix = forestContext.g;
      vec3 mossColor = diffuseColor.rgb * vec3(.62,.66,.50);
      vec3 soilColor = texture2D(forestSoilColor, soilUV).rgb * vec3(.70,.68,.60);
      diffuseColor.rgb = mix(mossColor, soilColor, forestMix);
      float soilAO = texture2D(forestSoilARM,soilUV).r;
      diffuseColor.rgb *= forestContext.r * mix(1.0,.84,forestContext.b)
        * mix(1.0,mix(.86,1.0,soilAO),forestMix);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(mix(roughnessFactor,
        texture2D(forestSoilARM,soilUV).g,forestMix),.84,1.0);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
      `vec3 mapN = normalize(mix(texture2D(normalMap,vNormalMapUv).xyz*2.0-1.0,
        texture2D(forestSoilNormal,soilUV).xyz*2.0-1.0,forestMix));`));
  };
  material.customProgramCacheKey = () => 'forest-moss-root-soil-v2';
  material.needsUpdate = true;
  previous.forEach(texture => texture?.dispose());
  return true;
}

