import * as THREE from 'three';

/** Matte foliage keeps the photographic colour, cutout, live diffuse lighting
 * and shadows without evaluating a glossy PBR/environment reflection per leaf.
 * The original material and its textures remain available to other objects. */
export function forestLeafMaterial(source: THREE.MeshStandardMaterial) {
  const material = new THREE.MeshLambertMaterial({
    name: source.name, color: source.color.clone(), map: source.map,
    alphaMap: source.alphaMap, alphaTest: source.alphaTest,
    alphaToCoverage: source.alphaToCoverage, side: source.side,
    normalMap: source.normalMap, normalScale: source.normalScale.clone(),
    vertexColors: source.vertexColors, transparent: false,
    emissive: new THREE.Color(0xffffff), emissiveIntensity: source.emissiveIntensity || .10,
    fog: source.fog, depthWrite: source.depthWrite
  });
  const previous = source.onBeforeCompile, key = source.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    // Installed Three r186 supplies diffuse HDR illumination to Lambert using
    // scene.environment, including its intensity and rotation. Keep that path.
    // map_fragment already decoded these same atlas pixels. Reuse them for
    // restrained leaf-coloured fill instead of sampling emissiveMap again.
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#ifdef USE_MAP\n totalEmissiveRadiance *= sampledDiffuseColor.rgb;\n#endif');
  };
  material.customProgramCacheKey = () => `${key}|forest-diffuse-leaves-v3-native-sky`;
  material.userData = { ...source.userData, forestDiffuseLeaves: true };
  return material;
}
