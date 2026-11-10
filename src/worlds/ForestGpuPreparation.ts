import * as THREE from 'three';

export type ForestGpuPreparationResult = {
  status: 'ready' | 'fallback' | 'cancelled';
  texturesUploaded: number;
  materials: number;
  bufferDraws: number;
  bufferBatches: number;
  compileVariants: { shadows: boolean; wallMs: number; additionalLights?: boolean }[];
  timings: { totalMs: number; textureUploadMs: number; environmentShaderMs: number; compileMs: number; preflightMs: number };
  error?: string;
};

export type ForestGpuPreparationOptions = {
  signal?: AbortSignal;
  preflight?: boolean;
  preparationMeshes?: readonly { mesh: THREE.Mesh; geometries?: readonly THREE.BufferGeometry[] }[];
  preflightBatchSize?: number;
  /** Lights that travel with the tear are absent in a portal preview, then
   * present after crossing. Prepare both light counts before interaction. */
  additionalLights?: readonly THREE.Light[];
  /** Existing instances of those lights can already belong to this scene. */
  excludedLights?: readonly THREE.Light[];
  /** Injectable only to make task-boundary ordering testable. */
  yieldTask?: () => Promise<void>;
};

type BufferDraw = { mesh: THREE.Mesh; geometry: THREE.BufferGeometry };

function withPreparationLights<T>(scene: THREE.Scene, options: ForestGpuPreparationOptions,
  additional: boolean, work: () => T): T {
  const excluded = (options.excludedLights ?? []).map(light => ({ light, visible: light.visible }));
  const added = additional ? (options.additionalLights ?? []) : [];
  const parents = added.map(light => ({ mesh: light, parent: light.parent, index: light.parent?.children.indexOf(light) ?? -1 }));
  try {
    for (const { light } of excluded) light.visible = false;
    for (const light of added) scene.add(light);
    return work();
  } finally {
    restoreParents(parents);
    for (const { light, visible } of excluded) light.visible = visible;
  }
}

function isWithin(object: THREE.Object3D, scene: THREE.Scene) {
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (parent === scene) return true;
  return false;
}

function restoreParents(saved: { mesh: THREE.Object3D; parent: THREE.Object3D | null; index: number }[]) {
  // Restore sibling order from indices captured before any move in the batch.
  for (const entry of saved) entry.mesh.removeFromParent();
  for (const entry of [...saved].sort((a, b) => a.index - b.index)) {
    if (!entry.parent) continue;
    entry.parent.add(entry.mesh);
    const children = entry.parent.children, current = children.indexOf(entry.mesh);
    children.splice(current, 1); children.splice(entry.index, 0, entry.mesh);
  }
}

function withAttachedMeshes<T>(scene: THREE.Scene, meshes: readonly THREE.Mesh[], work: () => T): T {
  const detached = [...new Set(meshes)].filter(mesh => !isWithin(mesh, scene)).map(mesh =>
    ({ mesh, parent: mesh.parent, index: mesh.parent?.children.indexOf(mesh) ?? -1 }));
  try { for (const { mesh } of detached) scene.add(mesh); return work(); }
  finally { restoreParents(detached); }
}

function preservingLightShadows<T>(scene: THREE.Scene, work: () => T): T {
  const saved: { shadow: THREE.LightShadow; needsUpdate: boolean; autoUpdate: boolean }[] = [];
  scene.traverse(object => {
    const shadow = (object as THREE.DirectionalLight).shadow;
    if (shadow) saved.push({ shadow, needsUpdate: shadow.needsUpdate, autoUpdate: shadow.autoUpdate });
  });
  try { return work(); }
  finally { for (const entry of saved) { entry.shadow.needsUpdate = entry.needsUpdate; entry.shadow.autoUpdate = entry.autoUpdate; } }
}

/** Use real object IDs and attribute references, so warmed VAOs/buffers belong
 * to gameplay meshes. Nothing is cloned or disposed, and no state spans await. */
function withBufferBatch<T>(scene: THREE.Scene, batch: readonly BufferDraw[], work: () => T): T {
  const visibility: { object: THREE.Object3D; visible: boolean }[] = [];
  scene.traverse(object => { if ((object as THREE.Mesh).material) visibility.push({ object, visible: object.visible }); });
  const ranges = new Map<THREE.BufferGeometry, { start: number; count: number }>();
  const saved = batch.map(({ mesh, geometry }) => {
    const instanced = mesh as THREE.InstancedMesh;
    if (!ranges.has(geometry)) ranges.set(geometry, { ...geometry.drawRange });
    return { mesh, geometry: mesh.geometry, requestedGeometry: geometry, parent: mesh.parent,
      index: mesh.parent?.children.indexOf(mesh) ?? -1, visible: mesh.visible, frustumCulled: mesh.frustumCulled,
      count: instanced.isInstancedMesh ? instanced.count : undefined,
      matrix: mesh.matrix.clone(), worldMatrix: mesh.matrixWorld.clone(), matrixAutoUpdate: mesh.matrixAutoUpdate,
      worldAutoUpdate: mesh.matrixWorldAutoUpdate, worldNeedsUpdate: mesh.matrixWorldNeedsUpdate };
  });
  try {
    for (const entry of visibility) entry.object.visible = false;
    for (const entry of saved) {
      scene.add(entry.mesh); entry.mesh.visible = true; entry.mesh.frustumCulled = false;
      entry.mesh.matrixAutoUpdate = false; entry.mesh.matrixWorldAutoUpdate = false;
      entry.mesh.matrix.copy(entry.worldMatrix); entry.mesh.matrixWorld.copy(entry.worldMatrix);
      entry.mesh.geometry = entry.requestedGeometry;
      // WebGLObjects uploads complete attributes, independently of draw count.
      entry.mesh.geometry.setDrawRange(0, 3);
      if (entry.count !== undefined) (entry.mesh as THREE.InstancedMesh).count = Math.min(1, entry.count);
    }
    return work();
  } finally {
    restoreParents(saved);
    for (const entry of saved) {
      entry.mesh.geometry = entry.geometry; entry.mesh.visible = entry.visible; entry.mesh.frustumCulled = entry.frustumCulled;
      if (entry.count !== undefined) (entry.mesh as THREE.InstancedMesh).count = entry.count;
      entry.mesh.matrix.copy(entry.matrix); entry.mesh.matrixWorld.copy(entry.worldMatrix);
      entry.mesh.matrixAutoUpdate = entry.matrixAutoUpdate; entry.mesh.matrixWorldAutoUpdate = entry.worldAutoUpdate;
      entry.mesh.matrixWorldNeedsUpdate = entry.worldNeedsUpdate;
    }
    for (const [geometry, range] of ranges) geometry.setDrawRange(range.start, range.count);
    for (const entry of visibility) entry.object.visible = entry.visible;
  }
}

/** Save state immediately around synchronous GPU work, never across an await.
 * PMREM may also render internally during compileAsync's synchronous prefix. */
function preservingRenderer<T>(renderer: THREE.WebGLRenderer, work: () => T): T {
  const state = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), level: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear, colorClear: renderer.autoClearColor, depthClear: renderer.autoClearDepth,
    stencilClear: renderer.autoClearStencil, xrEnabled: renderer.xr.enabled, cameraAutoUpdate: renderer.xr.cameraAutoUpdate,
    shadowsEnabled: renderer.shadowMap.enabled, shadowAutoUpdate: renderer.shadowMap.autoUpdate,
    shadowsNeedUpdate: renderer.shadowMap.needsUpdate, shadowType: renderer.shadowMap.type,
    infoAutoReset: renderer.info.autoReset, renderInfo: { ...renderer.info.render }
  };
  try { return work(); }
  finally {
    renderer.xr.enabled = state.xrEnabled; renderer.xr.cameraAutoUpdate = state.cameraAutoUpdate;
    renderer.autoClear = state.autoClear; renderer.autoClearColor = state.colorClear;
    renderer.autoClearDepth = state.depthClear; renderer.autoClearStencil = state.stencilClear;
    renderer.shadowMap.enabled = state.shadowsEnabled; renderer.shadowMap.autoUpdate = state.shadowAutoUpdate;
    renderer.shadowMap.needsUpdate = state.shadowsNeedUpdate; renderer.shadowMap.type = state.shadowType;
    renderer.setRenderTarget(state.target, state.face, state.level);
    renderer.setViewport(state.viewport); renderer.setScissor(state.scissor); renderer.setScissorTest(state.scissorTest);
    renderer.setClearColor(state.color, state.alpha);
    renderer.info.autoReset = state.infoAutoReset; Object.assign(renderer.info.render, state.renderInfo);
  }
}

/** Prepare only after Forest assets are ready, while the intro can show progress.
 * Each texture upload gets its own task. Individual uploads and PMREM generation
 * are synchronous driver work and cannot be made interruptible by async/await.
 * compileMs includes Three's lazy environment conversion and compilation wait.
 * This function does not gate gameplay; its caller must await it before entry. */
export async function prepareForestGpu(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  onProgress?: (message: string) => void, options: ForestGpuPreparationOptions = {}): Promise<ForestGpuPreparationResult> {
  const start = performance.now();
  const result: ForestGpuPreparationResult = { status: 'fallback', texturesUploaded: 0, materials: 0, bufferDraws: 0, bufferBatches: 0, compileVariants: [],
    timings: { totalMs: 0, textureUploadMs: 0, environmentShaderMs: 0, compileMs: 0, preflightMs: 0 } };
  const yieldTask = options.yieldTask ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  const textures = new Set<THREE.Texture>(), uploaded = new Set<THREE.Texture>(), materials = new Set<THREE.Material>();
  const restores: (() => void)[] = [];
  const extraMeshes = options.preparationMeshes ?? [];
  const bufferDraws: BufferDraw[] = [], drawKeys = new Map<THREE.Mesh, Set<THREE.BufferGeometry>>();
  const addDraw = (mesh: THREE.Mesh, geometry: THREE.BufferGeometry) => {
    if (!geometry || ((mesh as THREE.InstancedMesh).isInstancedMesh && (mesh as THREE.InstancedMesh).count === 0)) return;
    let geometries = drawKeys.get(mesh);
    if (!geometries) { geometries = new Set(); drawKeys.set(mesh, geometries); }
    if (geometries.has(geometry)) return;
    geometries.add(geometry); bufferDraws.push({ mesh, geometry });
  };
  const check = () => { if (options.signal?.aborted) throw new DOMException('Forest preparation cancelled', 'AbortError'); };
  const collect = (value: unknown, seen = new WeakSet<object>()) => {
    if (!value || typeof value !== 'object') return;
    if ((value as THREE.Texture).isTexture) {
      const texture = value as THREE.Texture;
      // Render-target textures are owned/initialized by their targets, not initTexture.
      if (!texture.isRenderTargetTexture) textures.add(texture);
      return;
    }
    if (seen.has(value) || ArrayBuffer.isView(value)) return;
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) collect(child, seen);
  };
  async function uploadPending() {
    for (const texture of textures) {
      if (uploaded.has(texture)) continue;
      await yieldTask(); check();
      onProgress?.(`Preparing Forest textures · ${uploaded.size + 1} of ${textures.size}`);
      const before = performance.now();
      preservingRenderer(renderer, () => renderer.initTexture(texture));
      result.timings.textureUploadMs += performance.now() - before;
      uploaded.add(texture); result.texturesUploaded = uploaded.size;
    }
  }
  try {
    check();
    scene.traverse(object => {
      const material = (object as THREE.Mesh).material;
      if (material) for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
    });
    scene.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.material && mesh.geometry) addDraw(mesh, mesh.geometry);
    });
    for (const entry of extraMeshes) {
      for (const material of Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]) materials.add(material);
      for (const geometry of entry.geometries ?? [entry.mesh.geometry]) addDraw(entry.mesh, geometry);
    }
    result.materials = materials.size;
    collect(scene.environment); collect(scene.background instanceof THREE.Texture ? scene.background : null);
    for (const material of materials) {
      // Standard maps are direct properties; ShaderMaterial textures are uniforms.
      for (const value of Object.values(material)) if (value?.isTexture) collect(value);
      collect((material as THREE.ShaderMaterial).uniforms);
      const hook = material.onBeforeCompile, key = material.customProgramCacheKey, stableKey = key.call(material);
      // Ground/foliage helpers inject closure-held sampler textures here. Preserve
      // the original program key, including Material's default hook-derived key.
      material.customProgramCacheKey = () => stableKey;
      material.onBeforeCompile = function (shader, activeRenderer) {
        hook.call(this, shader, activeRenderer); collect(shader.uniforms);
      };
      restores.push(() => { material.onBeforeCompile = hook; material.customProgramCacheKey = key; });
    }
    await uploadPending(); check();
    // Keep environment conversion in the renderer-owned cache. The installed
    // PMREMGenerator warns against disposing a second generator while another
    // exists. Its conversion cost is therefore included in compileMs below.
    // Quest disables shadows. Prepare both program variants now so entering an
    // XR session later does not merely postpone the same compilation stall.
    const lightingVariants = options.additionalLights?.length ? [false, true] : [false];
    for (const additionalLights of lightingVariants) for (const shadows of [true, false]) {
      await yieldTask(); check(); onProgress?.(`Preparing Forest ${shadows ? 'desktop' : 'VR'} lighting and shaders`);
      const compileStart = performance.now();
      // Restore state before waiting: Three's asynchronous tail only polls
      // program readiness. No renderer flags stay changed across that await.
      const compiled = preservingRenderer(renderer, () => {
        renderer.shadowMap.enabled = shadows;
        return withPreparationLights(scene, options, additionalLights, () =>
          withAttachedMeshes(scene, extraMeshes.map(entry => entry.mesh), () => renderer.compileAsync(scene, camera)));
      });
      await compiled;
      const duration = performance.now() - compileStart;
      result.timings.compileMs += duration;
      result.compileVariants.push({ shadows, wallMs: duration, ...(options.additionalLights?.length ? { additionalLights } : {}) }); check();
    }
    await uploadPending();
    if (options.preflight !== false) {
      const target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, stencilBuffer: true });
      target.texture.colorSpace = renderer.outputColorSpace;
      const batchSize = Math.max(1, Math.min(32, Math.floor(options.preflightBatchSize ?? 16) || 16));
      const configureTarget = () => {
        renderer.xr.enabled = false; renderer.xr.cameraAutoUpdate = false;
        renderer.autoClear = renderer.autoClearColor = renderer.autoClearDepth = renderer.autoClearStencil = true;
        renderer.setRenderTarget(target); renderer.setViewport(0, 0, 4, 4);
        renderer.setScissorTest(false); renderer.setClearColor(0, 1);
      };
      try {
        // Do not put two variants of the same mesh into one batch: it has one
        // geometry property. Drain bounded batches while keeping draw order.
        for (let startIndex = 0; startIndex < bufferDraws.length;) {
          const batch: BufferDraw[] = [], meshes = new Set<THREE.Mesh>();
          while (startIndex < bufferDraws.length && batch.length < batchSize) {
            const draw = bufferDraws[startIndex];
            if (meshes.has(draw.mesh)) break;
            batch.push(draw); meshes.add(draw.mesh); startIndex++;
          }
          await yieldTask(); check();
          onProgress?.(`Preparing Forest geometry · ${Math.min(startIndex, bufferDraws.length)} of ${bufferDraws.length}`);
          const before = performance.now();
          preservingRenderer(renderer, () => withPreparationLights(scene, options, false, () => preservingLightShadows(scene, () => withBufferBatch(scene, batch, () => {
            configureTarget();
            // Keep shadow shader defines, but do not redraw the 1024px map for
            // every tiny batch. One normal preflight below prepares that map.
            renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
            renderer.render(scene, camera);
          }))));
          result.timings.preflightMs += performance.now() - before;
          result.bufferDraws += batch.length; result.bufferBatches++;
        }
        await yieldTask(); check(); onProgress?.('Finishing Forest graphics preparation');
        const before = performance.now();
        preservingRenderer(renderer, () => withPreparationLights(scene, options, false, () => preservingLightShadows(scene, () => {
          configureTarget(); renderer.render(scene, camera);
        })));
        result.timings.preflightMs += performance.now() - before;
      } finally {
        target.dispose();
      }
    }
    check(); result.status = 'ready'; onProgress?.('Forest graphics ready');
  } catch (error) {
    result.status = options.signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'fallback';
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    for (const restore of restores) restore();
    result.timings.totalMs = performance.now() - start;
  }
  return result;
}
