import * as THREE from 'three';

/** Extend the approved litter maps without duplicating textures or adding a pass.
 * The original review patch keeps its own exact material and relief surface. */
export function applyForestLitter(material: THREE.MeshStandardMaterial, litter: THREE.Texture[]) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, { forestLitterColor: { value: litter[0] },
      forestLitterNormal: { value: litter[1] }, forestLitterARM: { value: litter[2] } });
    shader.fragmentShader = 'uniform sampler2D forestLitterColor, forestLitterNormal, forestLitterARM;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('vec3 mossColor =', `
      float coverGrowth = .5+.25*sin(forestXZ.x*.53+sin(forestXZ.y*.31))
        +.25*cos(forestXZ.y*.61-forestXZ.x*.23);
      float litterCover = 1.0-sampleWeight;
      // Replace the former trail's soil band with continuous woodland patches.
      // Moisture still contributes near roots and water; no path mask survives.
      float woodlandSoil = .60-.22*smoothstep(.22,.78,coverGrowth)+forestContext.b*.14;
      forestMix = mix(forestMix,woodlandSoil,litterCover);
      vec3 mossColor =`)
      .replace('texture2D(forestSoilColor, soilUV).rgb',
        'mix(texture2D(forestSoilColor, soilUV).rgb,texture2D(forestLitterColor,forestXZ/1.5).rgb*vec3(.82,.72,.56),litterCover)')
      .replaceAll('texture2D(forestSoilARM,soilUV)',
        'mix(texture2D(forestSoilARM,soilUV),texture2D(forestLitterARM,forestXZ/1.5),litterCover)')
      .replace('texture2D(forestSoilNormal,soilUV).xyz',
        'mix(texture2D(forestSoilNormal,soilUV).xyz,texture2D(forestLitterNormal,forestXZ/1.5).xyz,litterCover)');
  };
  material.customProgramCacheKey = () => `${key}|forest-litter-v2-no-trail`;
  material.userData.forestLitter = litter;
  material.needsUpdate = true;
}
