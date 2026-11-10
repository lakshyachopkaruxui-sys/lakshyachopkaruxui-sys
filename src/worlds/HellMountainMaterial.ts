import * as THREE from 'three';

export interface HellMountainMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

export interface HellMountainOptions {
  /** Physical tile width, independent of the cone's generated UV chart. */
  tileMetres?: number;
  normalStrength?: number;
  color?: THREE.ColorRepresentation;
}

/** Static rock shading shared by all volcanic meshes. Texture ownership remains
 * with the caller. The owning world's local coordinates survive portal alignment.
 * Six texture samples: three seamless albedo projections, two reoriented normal
 * projections and one roughness projection. Optional mountainCavity vertex data
 * supplies sheltered fracture occlusion. No new texture, light or render pass. */
export function createHellMountainMaterial(maps: HellMountainMaps,
  options: HellMountainOptions = {}): THREE.MeshStandardMaterial {
  const tileMetres = THREE.MathUtils.clamp(options.tileMetres ?? 6.2, .4, 16);
  const strength = THREE.MathUtils.clamp(options.normalStrength ?? 1.04, 0, 2);
  const material = new THREE.MeshStandardMaterial({
    name: 'Weathered volcanic rock and mineral ash',
    color: options.color ?? 0xe0e6ed,
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    // The image is tangent-space. Our shader reorients it into object space,
    // then this Standard path supplies Three's per-view normalMatrix uniform.
    normalMapType: THREE.ObjectSpaceNormalMap,
    normalScale: new THREE.Vector2(strength, strength),
    roughness: .94, metalness: 0, dithering: true
  });
  material.userData.mountainBudget = { textureSamples: 6, extraTextures: 0,
    extraLights: 0, extraRenderPasses: 0, coordinates: 'owning-local metres' };
  // WebGLBindingStates uses these constant values when a supporting mesh does
  // not contain the hero mountain's optional fracture attribute.
  Object.assign(material, { defaultAttributeValues: { mountainCavity: [0] } });
  material.customProgramCacheKey = () => 'hell-projected-fractured-basalt-v2';
  material.onBeforeCompile = shader => {
    shader.uniforms.mountainTileScale = { value: 1 / tileMetres };
    shader.vertexShader = `attribute float mountainCavity;
varying float vMountainCavity;
varying vec3 vMountainLocal;
varying vec3 vMountainNormal;
` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vMountainCavity=clamp(mountainCavity,0.,1.);
      vMountainLocal=position;
      vMountainNormal=normal;
    `);
    shader.fragmentShader = `varying float vMountainCavity;
varying vec3 vMountainLocal;
varying vec3 vMountainNormal;
uniform float mountainTileScale;
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <normalmap_pars_fragment>', `
      #include <normalmap_pars_fragment>
      #ifdef USE_NORMALMAP
      vec3 mountainPerturb(vec3 surfaceNormal,vec3 axisTangent,vec2 projectedUv,float strength){
        vec3 sampleNormal=texture2D(normalMap,projectedUv).xyz*2.-1.;
        sampleNormal.xy*=normalScale*strength;
        vec3 tangent=normalize(axisTangent-surfaceNormal*dot(axisTangent,surfaceNormal));
        vec3 bitangent=normalize(cross(surfaceNormal,tangent));
        // Retain sharp photographed fracture relief without overturning the
        // geometric face at grazing angles or creating specular sparkle.
        return normalize(tangent*sampleNormal.x+bitangent*sampleNormal.y
          +surfaceNormal*max(sampleNormal.z,.38));
      }
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 mountainN=normalize(vMountainNormal);
      vec3 mountainAbs=abs(mountainN);
      vec3 mountainSign=vec3(mountainN.x<0.?-1.:1.,mountainN.y<0.?-1.:1.,mountainN.z<0.?-1.:1.);
      vec3 mountainWeights=pow(mountainAbs,vec3(5.));
      mountainWeights/=max(dot(mountainWeights,vec3(1.)),.0001);
      vec3 mountainP=vMountainLocal*mountainTileScale;
      vec2 mountainUvX=vec2(-mountainP.z*mountainSign.x,mountainP.y);
      vec2 mountainUvY=vec2(mountainP.x,-mountainP.z*mountainSign.y);
      vec2 mountainUvZ=vec2(mountainP.x*mountainSign.z,mountainP.y);
      vec3 mountainTx=vec3(0.,0.,-mountainSign.x);
      vec3 mountainTy=vec3(1.,0.,0.);
      vec3 mountainTz=vec3(mountainSign.z,0.,0.);
      vec2 mountainUvA,mountainUvB;
      vec3 mountainTa,mountainTb;
      float mountainWa,mountainWb;
      if(mountainAbs.x>=mountainAbs.y&&mountainAbs.x>=mountainAbs.z){
        mountainUvA=mountainUvX;mountainTa=mountainTx;mountainWa=mountainWeights.x;
        if(mountainAbs.y>=mountainAbs.z){mountainUvB=mountainUvY;mountainTb=mountainTy;mountainWb=mountainWeights.y;}
        else{mountainUvB=mountainUvZ;mountainTb=mountainTz;mountainWb=mountainWeights.z;}
      }else if(mountainAbs.y>=mountainAbs.z){
        mountainUvA=mountainUvY;mountainTa=mountainTy;mountainWa=mountainWeights.y;
        if(mountainAbs.x>=mountainAbs.z){mountainUvB=mountainUvX;mountainTb=mountainTx;mountainWb=mountainWeights.x;}
        else{mountainUvB=mountainUvZ;mountainTb=mountainTz;mountainWb=mountainWeights.z;}
      }else{
        mountainUvA=mountainUvZ;mountainTa=mountainTz;mountainWa=mountainWeights.z;
        if(mountainAbs.x>=mountainAbs.y){mountainUvB=mountainUvX;mountainTb=mountainTx;mountainWb=mountainWeights.x;}
        else{mountainUvB=mountainUvY;mountainTb=mountainTy;mountainWb=mountainWeights.y;}
      }
      float mountainLargest=max(mountainAbs.x,max(mountainAbs.y,mountainAbs.z));
      float mountainSmallest=min(mountainAbs.x,min(mountainAbs.y,mountainAbs.z));
      float mountainMiddle=mountainAbs.x+mountainAbs.y+mountainAbs.z-mountainLargest-mountainSmallest;
      // Only the weak projection fades at a three-way boundary. Ordinary 45-degree
      // slopes retain both normal projections rather than losing rock detail.
      mountainWb*=smoothstep(0.,.08,mountainMiddle-mountainSmallest);
      float mountainNormalFade=smoothstep(.01,.14,mountainLargest-mountainSmallest);
      vec3 mountainMetres=vMountainLocal;
      float mountainCavityAmount=clamp(vMountainCavity,0.,1.);
      float mountainMacro=clamp(.5+.25*sin(mountainMetres.x*.16+mountainMetres.z*.07
        +sin(mountainMetres.y*.13)*1.6)+.22*sin(mountainMetres.z*.19-mountainMetres.y*.06
        +mountainMetres.x*.04),0.,1.);
      float mountainAsh=smoothstep(.44,.86,max(mountainN.y,0.))*(.30+.70*mountainMacro)
        *(1.-mountainCavityAmount*.65);
      float mountainFresh=smoothstep(.54,.86,mountainMacro)*(1.-mountainAsh*.55);
      float mountainExposed=(1.-smoothstep(.24,.66,max(mountainN.y,0.)))
        *(1.-mountainCavityAmount);
      #ifdef USE_MAP
        vec4 mountainTexel=texture2D(map,mountainUvX)*mountainWeights.x
          +texture2D(map,mountainUvY)*mountainWeights.y+texture2D(map,mountainUvZ)*mountainWeights.z;
        float mountainLuma=dot(mountainTexel.rgb,vec3(.2126,.7152,.0722));
        mountainTexel.rgb=mix(mountainTexel.rgb,vec3(mountainLuma),.91);
        // Broad plate faces remain readable under red sky light. Dark seams
        // come from the photograph and authored recesses, not uniform grain.
        float mountainPlate=mix(.84,1.18,smoothstep(.018,.16,mountainLuma));
        vec3 mountainMineral=mix(vec3(1.04,1.09,1.15),vec3(.59,.64,.70),mountainFresh);
        mountainMineral=mix(mountainMineral,vec3(1.18,1.16,1.10),mountainAsh*.66);
        mountainMineral*=mix(1.,1.14,mountainExposed)*mix(1.,.76,mountainCavityAmount);
        diffuseColor*=vec4(mountainTexel.rgb*mountainMineral*mountainPlate,mountainTexel.a);
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      float roughnessFactor=roughness;
      #ifdef USE_ROUGHNESSMAP
        float mountainRoughness=texture2D(roughnessMap,mountainUvA).g;
        roughnessFactor=clamp(.80+.17*mountainRoughness+mountainAsh*.02
          +mountainCavityAmount*.035,.83,.99);
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
      #include <aomap_fragment>
      // Vertex-authored shelter affects incoming ambient light only. Direct
      // lava/sky light and Standard specular response remain physically lit.
      reflectedLight.indirectDiffuse*=1.-mountainCavityAmount*.36;
      reflectedLight.indirectSpecular*=1.-mountainCavityAmount*.22;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #ifdef USE_NORMALMAP
        vec3 mountainNormalA=mountainPerturb(mountainN,mountainTa,mountainUvA,mountainNormalFade);
        vec3 mountainNormalB=mountainPerturb(mountainN,mountainTb,mountainUvB,mountainNormalFade);
        vec3 mountainMapped=normalize(mountainNormalA*mountainWa+mountainNormalB*mountainWb);
        #ifdef FLIP_SIDED
          mountainMapped=-mountainMapped;
        #endif
        normal=normalize(normalMatrix*mountainMapped);
        #ifdef DOUBLE_SIDED
          normal*=faceDirection;
        #endif
      #endif
    `);
  };
  return material;
}
