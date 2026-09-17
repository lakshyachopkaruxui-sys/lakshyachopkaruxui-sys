import * as THREE from 'three';
import { setStencilTest } from '../tear/Membrane';

export type PortalOutput = 'opaque' | 'passthrough' | 'portal-passthrough';

/**
 * Renders nested worlds with the stencil buffer (verified by stencil-test.html):
 *   1. outer world (stencil == 0)
 *   2. tear mask: stencil 0 → 1 inside the hole, then depth reset inside it
 *   3. inner world (stencil == 1)
 * Each pass is a separate scene render into the same framebuffer, which also
 * works per eye in WebXR because each eye renders into its own viewport.
 */
export class PortalRenderer {
  private readonly opaqueOutput = new THREE.Scene();
  private readonly roomThroughPortal = new THREE.Scene();

  constructor(private renderer: THREE.WebGLRenderer) {
    renderer.autoClear = false;
    // In alpha-blend XR, compositor passthrough shows through every pixel whose
    // final alpha is below 1. Preserve the scene's RGB and replace only alpha.
    // This also covers gaps between world geometry and translucent effects.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0, 3, -1, 0, -1, 3, 0
    ], 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }',
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.ZeroFactor,
      depthTest: false,
      depthWrite: false,
      stencilWrite: false,
      toneMapped: false,
      fog: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.layers.enableAll();
    this.opaqueOutput.add(mesh);

    // Returning from a virtual world: only the already-written tear stencil
    // may reveal the compositor's real room. Clear RGB as well as alpha, since
    // alpha-blend XR uses premultiplied output and stale RGB would glow there.
    const cutout = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.ZeroFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.ZeroFactor,
      colorWrite: true,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilWriteMask: 0,
      stencilFunc: THREE.EqualStencilFunc,
      stencilRef: 1,
      stencilFuncMask: 0xff,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
      toneMapped: false,
      fog: false
    }));
    cutout.frustumCulled = false;
    cutout.layers.enableAll();
    this.roomThroughPortal.add(cutout);
  }

  render(camera: THREE.Camera, passes: THREE.Scene[], output: PortalOutput = 'opaque') {
    this.preserveXRBuffers();
    // Set the GL clear value immediately before the explicit clear: Three's
    // WebGLBackground changes it to transparent during alpha-blend XR renders.
    this.renderer.setClearAlpha(output === 'passthrough' ? 0 : 1);
    this.renderer.clear(true, true, true);
    for (const scene of passes) this.renderer.render(scene, camera);
    if (output !== 'passthrough' && this.renderer.xr.isPresenting &&
      this.renderer.xr.getSession()?.environmentBlendMode === 'alpha-blend') {
      // A full-screen triangle is drawn for each XR eye, with no depth/stencil
      // restriction. Keep the existing scene RGB while guaranteeing final A=1.
      this.renderer.render(this.opaqueOutput, camera);
      if (output === 'portal-passthrough') this.renderer.render(this.roomThroughPortal, camera);
    }
  }

  /** The tear's scene passes share depth, stencil and the accumulated colour. */
  private preserveXRBuffers() {
    if (!this.renderer.xr.enabled || !this.renderer.xr.isPresenting) return;
    // WebXRManager marks its target; @types/three does not expose that marker.
    const target = this.renderer.getRenderTarget() as (THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }) | null;
    if (!target?.isXRRenderTarget) return;

    // Three derives these defaults from the compositor's ignoreDepthValues.
    // That only says the compositor does not need depth; OUR later passes do.
    // On Quest, false makes Three invalidate the combined depth/stencil buffer
    // after every render(), destroying the mask before the inner scene draws.
    target.storeMultisampledColorBuffer = true;
    target.storeMultisampledDepthBuffer = true;
    target.storeMultisampledStencilBuffer = true;

    // Three r186's separate-MSAA fallback also discards its colour renderbuffer
    // on OculusBrowser regardless of storeMultisampledColorBuffer. Use its
    // existing single-sample texture framebuffer for that exceptional path.
    // Rebinding BEFORE clear is essential: samples also selects the framebuffer.
    // Normal Quest render-to-texture MSAA stays enabled. External compositor
    // depth disables that extension inside Three (resolveDepthBuffer === true).
    const quest = typeof navigator !== 'undefined' && /OculusBrowser/i.test(navigator.userAgent);
    const usesRenderToTexture = this.renderer.extensions.has('WEBGL_multisampled_render_to_texture') && !target.resolveDepthBuffer;
    if (quest && target.samples > 0 && !usesRenderToTexture) {
      target.samples = 0;
      this.renderer.setRenderTarget(target);
    }
  }
}

/** Assign every material under `root` to a stencil layer. */
export function applyStencilLayer(root: THREE.Object3D, layer: number) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if ((mat as THREE.ShaderMaterial).defines?.MASK_MODE || (mat as THREE.ShaderMaterial).defines?.DEPTH_RESET) continue;
      setStencilTest(mat, layer);
    }
  });
}
