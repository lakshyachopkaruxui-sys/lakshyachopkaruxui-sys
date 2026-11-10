import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetUrl } from '../utils/assetUrl';

export const HELL_SKY_ASSET = '/hdri/the_sky_is_on_fire_2k.hdr';

/** A single, stencil-compatible sky draw. The HDR is never converted to a cube map. */
export function createHellSky(time: THREE.IUniform<number> = { value: 0 }) {
  const fallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  fallback.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { panorama: { value: fallback as THREE.Texture }, panoramaReady: { value: 0 }, hellTime: time },
    vertexShader: `varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `uniform sampler2D panorama;
      uniform float panoramaReady, hellTime;
      varying vec3 direction;
      void main() {
        vec3 d = normalize(direction);
        float elevation = max(d.y, 0.);
        float latitude = asin(elevation) / 1.5707963268;
        // Keep every lookup above the photographed town and ocean. Repeat only longitude.
        vec2 uv = vec2(atan(d.z, d.x) / 6.2831853072 + .75, .565 + latitude * .435);
        // Slow shear follows the ash column's wind; longitude wraps without a seam.
        uv.x += hellTime * .000055 * (.35 + latitude * .65);
        vec3 photograph = texture2D(panorama, uv).rgb;
        float luminance = dot(photograph, vec3(.2126, .7152, .0722));
        // Separate the photographed cloud highlights from the blue-grey clear sky.
        // This curve retains cloud structure instead of tinting every pixel equally red.
        float cloud = smoothstep(.50, 1.16, luminance);
        float warm = clamp((photograph.r - photograph.b) / max(luminance, .02), 0., 1.);
        vec3 shadows = vec3(.009, .0015, .004);
        vec3 crimson = vec3(.23, .011, .014);
        vec3 ember = vec3(.58, .066, .011);
        vec3 clouds = mix(shadows, crimson, pow(cloud, 1.35));
        clouds = mix(clouds, ember, warm * smoothstep(.3, .93, cloud) * .72);
        clouds *= mix(1., .42, smoothstep(.22, .94, elevation));
        // A continuous ash horizon hides the lower panorama at every view angle.
        float horizon = pow(1. - elevation, 4.);
        float ventGlow = pow(max(dot(d, normalize(vec3(.04, .12, -1.))), 0.), 9.);
        vec3 haze = mix(vec3(.018, .002, .006), vec3(.22, .012, .008), horizon);
        haze += vec3(.18, .019, .002) * ventGlow * horizon;
        float photoWeight = panoramaReady * smoothstep(.035, .22, elevation);
        vec3 color = mix(haze, clouds, photoWeight);
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(125, 40, 20), material);
  mesh.name = 'Crimson ash sky';
  // Keep it in the opaque queue, after terrain/actors. Their depth lets mobile
  // GPUs reject covered sky pixels before shading the full HDR panorama.
  mesh.renderOrder = 1000;
  mesh.userData.source = 'The Sky Is On Fire — Greg Zaal / Poly Haven, CC0';
  mesh.userData.skyStatus = 'loading';

  const ready = new HDRLoader().loadAsync(assetUrl(HELL_SKY_ASSET)).then(texture => {
    // 2K half-float RGBA occupies 16 MiB. No mip chain, PMREM or additional render pass.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    material.uniforms.panorama.value = texture;
    material.uniforms.panoramaReady.value = 1;
    fallback.dispose();
    mesh.userData.skyStatus = 'ready';
    return true;
  }).catch(() => {
    // Loading failure retains the crimson horizon without blocking entry or the actors.
    mesh.userData.skyStatus = 'fallback';
    return false;
  });
  return { mesh, ready };
}
