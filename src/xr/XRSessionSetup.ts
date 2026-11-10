import type * as THREE from 'three';

export interface XRPresentationInfo {
  blendMode: XREnvironmentBlendMode;
  layer: 'projection' | 'webgl';
  sourceAlpha: boolean;
  contextAlpha: boolean;
  contextStencil: boolean;
}

/**
 * Enable composition-layer source alpha explicitly and verify the result.
 * Projection layers default to true in the specification; this is a guard
 * against changed layer state, not evidence of the earlier Quest failure.
 * XRWebGLLayer has no such switch; Three creates it with alpha:true.
 */
export function configureXRLayerAlpha(layer: XRWebGLLayer | XRProjectionLayer | null): 'projection' | 'webgl' {
  if (!layer) throw new Error('The headset did not provide a render layer. Exit and enter again.');
  if ('blendTextureSourceAlpha' in layer) {
    layer.blendTextureSourceAlpha = true;
    if (layer.blendTextureSourceAlpha !== true) {
      throw new Error('The headset render layer could not enable transparency. Reload the page and enter again.');
    }
    return 'projection';
  }
  return 'webgl';
}

/**
 * The caller requests the session directly from a user action and ends it on
 * failure. Await this helper before reporting startup complete. Do not race the
 * installation against an end event: leaving setSession running in the
 * background can attach an abandoned session after a retry has begun.
 */
export async function setupXRSession(renderer: THREE.WebGLRenderer, session: XRSession,
  mode: 'immersive-ar' | 'immersive-vr'): Promise<XRPresentationInfo> {
  let ended = false;
  const onEnd = () => { ended = true; };
  session.addEventListener('end', onEnd);
  try {
    if (mode === 'immersive-ar' && session.environmentBlendMode !== 'alpha-blend') {
      throw new Error('Live-room passthrough is required. Use Meta Quest Browser on the headset, or choose Desktop preview.');
    }
    const context = renderer.getContext();
    const attributes = context.getContextAttributes();
    if (context.isContextLost() || !attributes) {
      throw new Error('The graphics context was lost. Reload the page before entering the headset.');
    }
    if (!attributes.alpha || !attributes.stencil) {
      throw new Error('This graphics context cannot render transparent portals. Reload in a browser with alpha and stencil support.');
    }
    await renderer.xr.setSession(session);
    if (ended || renderer.xr.getSession() !== session || !renderer.xr.isPresenting) {
      // Three owns its session cleanup. Never manufacture a second end event
      // or overwrite its readonly presentation state after an async race.
      throw new Error('The headset session closed during startup. Reload the page before entering again.');
    }
    const layer = configureXRLayerAlpha(renderer.xr.getBaseLayer());
    return {
      blendMode: session.environmentBlendMode, layer, sourceAlpha: true,
      contextAlpha: attributes.alpha, contextStencil: attributes.stencil
    };
  } finally {
    session.removeEventListener('end', onEnd);
  }
}
