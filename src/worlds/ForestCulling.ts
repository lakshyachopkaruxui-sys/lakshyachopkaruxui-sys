import * as THREE from 'three';

/** Thin ground patches and tall tree stands have very loose bounding spheres.
 * A conservative box rejects invisible batches without hiding visible plants.
 * FrustumArray.intersectsBox retains anything visible to either XR eye. */
export function useForestBoxCulling(mesh: THREE.InstancedMesh, bounds?: THREE.Box3, padding = .4) {
  if (!bounds) {
    mesh.computeBoundingBox();
    bounds = mesh.boundingBox!.clone().expandByScalar(padding);
  }
  const localBounds = bounds, worldBounds = new THREE.Box3();
  // Walking and head turns change the frustum, not these static patches.
  // Cache transformed bounds until placement or the owning world changes.
  // Bounds remain mutable during planting, so include all six coordinates.
  const previous = new Float64Array(22).fill(NaN);
  mesh.userData.forestCullBounds = localBounds;
  mesh.intersectsFrustum = frustum => {
    const matrix = mesh.matrixWorld.elements;
    let changed = false;
    for (let i = 0; i < 16; i++) if (previous[i] !== matrix[i]) { changed = true; break; }
    const min = localBounds.min, max = localBounds.max;
    if (changed || previous[16] !== min.x || previous[17] !== min.y || previous[18] !== min.z ||
      previous[19] !== max.x || previous[20] !== max.y || previous[21] !== max.z) {
      previous.set(matrix);
      previous[16] = min.x; previous[17] = min.y; previous[18] = min.z;
      previous[19] = max.x; previous[20] = max.y; previous[21] = max.z;
      worldBounds.copy(localBounds).applyMatrix4(mesh.matrixWorld);
    }
    return frustum.intersectsBox(worldBounds);
  };
}
