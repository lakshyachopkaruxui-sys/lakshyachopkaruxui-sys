import * as THREE from 'three';

export type HellLavaMode = 'channel' | 'slope' | 'crater' | 'fissure';
export interface HellLavaTextures {
  color: THREE.Texture;
  normal: THREE.Texture;
  emission: THREE.Texture;
}

const FIELD = /* glsl */`
  uniform float hellTime;
  varying vec2 vHellLavaUv;
  float hellLavaHash(vec2 p) {
    p=mod(p,64.);
    vec3 p3=fract(vec3(p.xyx)*.1031);
    p3+=dot(p3,p3.yzx+33.33);
    return fract((p3.x+p3.y)*p3.z);
  }
  float hellLavaNoise(vec2 p) {
    vec2 i=floor(p),f=fract(p);
    f=f*f*(3.-2.*f);
    float a=hellLavaHash(i),b=hellLavaHash(i+vec2(1.,0.));
    float c=hellLavaHash(i+vec2(0.,1.)),d=hellLavaHash(i+vec2(1.,1.));
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
  }
`;

/** Source-textured lava moves between chilled banks and transported crust.
 * Color, surface normals and temperature always sample the same advected UV.
 * The shoreline uses unadvected geometry UVs, so it cannot swim across the bank.
 * References: USGS Kilauea lava-levees and Mauna Loa branching-channel imagery. */
export function createHellLavaMaterial(time: THREE.IUniform<number>, textures: HellLavaTextures,
  mode: HellLavaMode = 'channel') {
  const material = new THREE.MeshStandardMaterial({
    name: `Cooled volcanic lava: ${mode}`,
    color: 0xffffff, map: textures.color, normalMap: textures.normal,
    emissiveMap: textures.emission, emissive: 0xffffff, emissiveIntensity: 1.25,
    metalness: 0, roughness: .94, normalScale: new THREE.Vector2(.8, .8)
  });
  material.userData.lavaMode = mode;
  material.userData.lavaShader = 'broken-flow-v9';
  const slope = mode === 'slope', banked = mode === 'channel' || slope, fissure = mode === 'fissure';
  const speed = slope ? '.055' : fissure ? '.009' : '.025';
  material.onBeforeCompile = shader => {
    shader.uniforms.hellTime = time;
    shader.vertexShader = 'varying vec2 vHellLavaUv;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvHellLavaUv=uv;');
    shader.fragmentShader = FIELD + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', /* glsl */`
      #include <logdepthbuf_fragment>
      float hellEdge=min(vHellLavaUv.x,1.-vHellLavaUv.x);
      ${banked ? `
      float hellBankNoise=hellLavaNoise(vec2(vHellLavaUv.y*4.8,step(.5,vHellLavaUv.x)*19.3+3.7));
      float hellBankCut=.024+.066*hellBankNoise;` : ''}
      float hellBank=${banked ? `smoothstep(hellBankCut+.008,hellBankCut+.12,hellEdge)` : fissure
        ? `smoothstep(0.,.18,vHellLavaUv.x)*smoothstep(0.,.18,1.-vHellLavaUv.x)` : '1.'};
      float hellAdvect=${banked ? 'smoothstep(hellBankCut+.05,hellBankCut+.22,hellEdge)' : fissure ? '.35' : '.7'};
      // A 1,024-tile wrap agrees with the periodic 64-cell hash and every moving
      // noise frequency below. Texture repeat and the entire flow field meet.
      float hellTravel=mod(hellTime*${speed}*hellAdvect,1024.);
      vec2 hellFlowUv=vHellLavaUv*vec2(2.15,2.4);
      hellFlowUv.y-=hellTravel;
      float hellDrift=hellLavaNoise(vec2(hellFlowUv.y*.125,11.7));
      float hellRaft=hellLavaNoise(vec2(vHellLavaUv.x*7.+.37,hellFlowUv.y*.75+4.2));
      float hellFracture=hellLavaNoise(vec2(vHellLavaUv.x*17.+hellDrift*.7,hellFlowUv.y*2.+9.7));
      hellFlowUv.x+=(hellDrift-.5)*.10*hellAdvect;
      hellFlowUv.y+=(hellFracture-.5)*.025*hellAdvect;
      float hellRunCenter=${slope ? '.5+(hellDrift-.5)*.12' : '.48+(hellDrift-.5)*.22'};
      float hellRunWidth=${slope ? '.16+.04*hellRaft' : '.12+.035*hellRaft'};
      float hellRun=1.-smoothstep(hellRunWidth*.45,hellRunWidth,abs(vHellLavaUv.x-hellRunCenter));
      float hellSideCenter=.64-(hellDrift-.5)*.18;
      float hellSideWidth=.055+.022*hellFracture;
      float hellSideRun=1.-smoothstep(hellSideWidth*.4,hellSideWidth,abs(vHellLavaUv.x-hellSideCenter));
      float hellRaftMask=smoothstep(.50,.75,hellRaft);
      float hellSplinters=smoothstep(.68,.86,hellFracture)*smoothstep(.10,.2,hellEdge);
      float hellMolten=${fissure ? '(.75+.25*hellFracture)' : slope
        ? 'mix(.16,.92,smoothstep(.22,.70,hellFracture))*(1.-hellRaftMask*.70)' : mode === 'crater'
          ? 'max(smoothstep(.32,.72,hellRaft),hellSplinters*.35)'
          : 'max(max(hellRun,hellSideRun*.8)*(1.-hellRaftMask*.84),hellSplinters*.24)'}*hellBank;
    `);

    const map = THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'hellFlowUv')
      .replace('diffuseColor *= sampledDiffuseColor;', /* glsl */`
        float hellGrain=clamp(dot(sampledDiffuseColor.rgb,vec3(.55,.3,.15))*1.7,0.,1.);
        float hellFineSource=smoothstep(.035,.73,max(sampledDiffuseColor.r,max(sampledDiffuseColor.g,sampledDiffuseColor.b)));
        hellMolten*=mix(.28,1.,hellFineSource);
        vec3 hellCrust=mix(vec3(.012,.014,.017),vec3(.065,.068,.073),sqrt(hellGrain));
        // Incandescent gaps have little diffuse reflection; the surrounding
        // silvery charcoal crust remains lit by the existing scene lights.
        diffuseColor.rgb*=mix(hellCrust,vec3(.035,.025,.018),hellMolten*.6);
        diffuseColor.a*=sampledDiffuseColor.a;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', map);
    for (const chunk of ['normal_fragment_begin', 'normal_fragment_maps'] as const) {
      const expanded = THREE.ShaderChunk[chunk].replaceAll('vNormalMapUv', 'hellFlowUv');
      shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, chunk === 'normal_fragment_maps'
        ? expanded.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale*mix(1.,.65,hellMolten);') : expanded);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor=mix(.96,.72,hellMolten);');
    const emission = THREE.ShaderChunk.emissivemap_fragment.replaceAll('vEmissiveMapUv', 'hellFlowUv')
      .replace('totalEmissiveRadiance *= emissiveColor.rgb;', /* glsl */`
        float hellTextureHeat=clamp(max(emissiveColor.r,max(emissiveColor.g,emissiveColor.b)),0.,1.);
        float hellSourceRadiance=pow(smoothstep(.035,.78,hellTextureHeat),1.15);
        float hellTemperature=hellTextureHeat;
        hellTemperature*=.98+.02*sin(hellFlowUv.y*.39269908+hellDrift*2.);
        vec3 hellHeat=mix(vec3(.72,.015,.001),vec3(1.5,.19,.009),smoothstep(.18,.75,hellTemperature));
        hellHeat=mix(hellHeat,vec3(1.7,.62,.10),smoothstep(.90,.995,hellTemperature));
        totalEmissiveRadiance*=hellHeat*hellMolten*hellSourceRadiance;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', emission);
    if (banked) {
      // Trim only the stationary outer rind. Defer discard until after normal
      // derivatives so the jagged bank does not disrupt the tangent frame.
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
        'if(hellEdge<hellBankCut)discard;\n#include <opaque_fragment>');
    }
  };
  material.customProgramCacheKey = () => `hell-broken-flow-v9:${mode}`;
  return material;
}
