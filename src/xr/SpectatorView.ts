import * as THREE from 'three';
import type { PortalRenderer } from '../portal/PortalRenderer';

export interface SpectatorOptions {
  sessionMode: 'immersive-vr' | 'immersive-ar' | null;
  /** The headset is driven by THIS computer's browser, not a remote Quest tab. */
  sameComputer: boolean;
  enabled?: boolean;
}

/**
 * A flat eye view on the canvas of the computer running the XR session.
 * This does not stream between devices or capture compositor passthrough.
 * Call immediately AFTER the normal XR PortalRenderer render each frame.
 */
export class SpectatorView {
  enabled = true;
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly canvasSize = new THREE.Vector2();
  private readonly savedViewport = new THREE.Vector4();
  private readonly savedScissor = new THREE.Vector4();
  private readonly savedClearColor = new THREE.Color();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly portal: PortalRenderer
  ) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  /** Returns whether a spectator frame was drawn. Never changes scene state. */
  render(baseCamera: THREE.PerspectiveCamera, passes: THREE.Scene[], options: SpectatorOptions): boolean {
    const renderer = this.renderer;
    const session = renderer.xr.getSession();
    if (
      !this.enabled || options.enabled === false || !options.sameComputer ||
      options.sessionMode !== 'immersive-vr' || !renderer.xr.isPresenting ||
      !renderer.xr.enabled || !session || session.environmentBlendMode !== 'opaque' ||
      session.visibilityState === 'hidden' ||
      /Android|Quest|Oculus|Mobile|iPhone|iPad|VisionOS/i.test(navigator.userAgent)
    ) return false;

    // Use an actual eye's projection, not the ArrayCamera's union frustum.
    // A flat monitor can show one eye; it cannot reproduce binocular vision.
    const eye = renderer.xr.getCamera().cameras[0];
    if (!eye) return false;
    renderer.getSize(this.canvasSize);
    if (this.canvasSize.x <= 0 || this.canvasSize.y <= 0) return false;

    const eyeViewport = eye.viewport;
    const projection = eye.projectionMatrix.elements;
    const aspect = eyeViewport && eyeViewport.w > 0
      ? eyeViewport.z / eyeViewport.w
      : Math.abs(projection[5] / projection[0]);
    if (!Number.isFinite(aspect) || aspect <= 0) return false;

    const camera = this.camera;
    camera.near = eye.near ?? baseCamera.near;
    camera.far = eye.far ?? baseCamera.far;
    camera.layers.mask = eye.layers.mask;
    camera.matrix.copy(eye.matrixWorld);
    camera.matrixWorld.copy(eye.matrixWorld);
    camera.matrixWorldInverse.copy(eye.matrixWorldInverse);
    camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
    camera.projectionMatrix.copy(eye.projectionMatrix);
    camera.projectionMatrixInverse.copy(eye.projectionMatrixInverse);

    // XR changes the canvas backing dimensions to the stereo framebuffer size,
    // while CSS still fits the laptop window. Fit in displayed CSS pixels, then
    // convert back to renderer viewport units so the eye is not squeezed.
    const displayWidth = renderer.domElement.clientWidth || this.canvasSize.x;
    const displayHeight = renderer.domElement.clientHeight || this.canvasSize.y;
    const fittedWidth = Math.min(displayWidth, displayHeight * aspect);
    const width = fittedWidth * this.canvasSize.x / displayWidth;
    const height = (fittedWidth / aspect) * this.canvasSize.y / displayHeight;
    const x = (this.canvasSize.x - width) * 0.5;
    const y = (this.canvasSize.y - height) * 0.5;

    const target = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const xrEnabled = renderer.xr.enabled;
    const scissorTest = renderer.getScissorTest();
    const clearAlpha = renderer.getClearAlpha();
    renderer.getViewport(this.savedViewport);
    renderer.getScissor(this.savedScissor);
    renderer.getClearColor(this.savedClearColor);

    try {
      // WebGLRenderer replaces a supplied camera with the XR ArrayCamera while
      // xr.enabled is true. Disable it only for this extra, ordinary canvas pass.
      renderer.xr.enabled = false;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, this.canvasSize.x, this.canvasSize.y);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.setViewport(x, y, width, height);
      renderer.setScissor(x, y, width, height);
      renderer.setScissorTest(true);
      this.portal.render(camera, passes);
      return true;
    } finally {
      try {
        renderer.setClearColor(this.savedClearColor, clearAlpha);
        // Restore the canvas's logical-pixel settings BEFORE rebinding the XR
        // target. setRenderTarget restores that target's physical-pixel viewport
        // and scissor. Setting a canvas viewport afterwards would overwrite them.
        renderer.setViewport(this.savedViewport);
        renderer.setScissor(this.savedScissor);
        renderer.setScissorTest(scissorTest);
        renderer.setRenderTarget(target, cubeFace, mipLevel);
      } finally {
        renderer.xr.enabled = xrEnabled;
      }
    }
  }
}
