import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/** Load a .glb once and reuse it. */
export function loadProp(path: string): Promise<THREE.Group> {
  let entry = cache.get(path);
  if (!entry) {
    entry = new Promise((resolve, reject) => {
      loader.load(path, (gltf) => resolve(gltf.scene), undefined, reject);
    });
    cache.set(path, entry);
  }
  return entry;
}

/**
 * Bounding box of a loaded model, computed from geometry rather than
 * Box3.setFromObject — skinned meshes report nonsense through the usual path.
 */
export function measureProp(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  // SkinnedMesh overrides updateMatrixWorld (not updateWorldMatrix). Refresh
  // bind inverses too, especially after a fit/clone, before measuring vertices.
  object.updateMatrixWorld(true);
  // Precise mode runs every vertex through its bones, so rigged models whose
  // armature carries a scale (the jellyfish is authored ~400 units across,
  // shrunk by its skeleton) are measured at the size they actually render.
  return new THREE.Box3().setFromObject(object, true);
}

/**
 * Scale a model so its largest dimension is `targetSize` metres. Model kits
 * disagree wildly about units (some are 1 unit tall, some are 400), so never
 * assume — measure.
 */
export function fitProp(object: THREE.Object3D, targetSize: number) {
  const size = measureProp(object).getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0) return 1;
  const scale = targetSize / largest;
  object.scale.multiplyScalar(scale);
  return scale;
}

/**
 * Move a (still unparented) model so its lowest point is at y = 0 and it is
 * centred on x/z. Many models are pivoted at their middle, which buries the
 * bottom half in the ground when you set position.y to the floor height.
 */
export function standOnOrigin(object: THREE.Object3D) {
  const box = measureProp(object);
  const centre = box.getCenter(new THREE.Vector3());
  object.position.x -= centre.x;
  object.position.z -= centre.z;
  object.position.y -= box.min.y;
}

export interface Placement {
  position: THREE.Vector3;
  rotationY: number;
  scale: number;
  /** Optional per-instance tint, multiplied into the model's own colours. */
  tint?: THREE.Color;
}

/**
 * Turn one loaded prop into a single InstancedMesh per sub-mesh, so a forest of
 * hundreds of trees costs a handful of draw calls instead of hundreds.
 */
export async function scatterProp(
  parent: THREE.Object3D,
  path: string,
  placements: Placement[],
  options: { tint?: THREE.Color; castShadow?: boolean } = {}
): Promise<THREE.InstancedMesh[]> {
  if (placements.length === 0) return [];
  const source = await loadProp(path);
  source.updateWorldMatrix(true, true);

  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  const made: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const mesh of meshes) {
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone();
    if (options.tint && (material as THREE.MeshStandardMaterial).color) {
      (material as THREE.MeshStandardMaterial).color.multiply(options.tint);
    }
    const instanced = new THREE.InstancedMesh(mesh.geometry, material, placements.length);
    instanced.castShadow = !!options.castShadow;
    instanced.frustumCulled = true;
    // The sub-mesh may sit at an offset inside the model; keep that offset.
    local.copy(mesh.matrixWorld);
    placements.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rotationY);
      s.setScalar(p.scale);
      m.compose(p.position, q, s).multiply(local);
      instanced.setMatrixAt(i, m);
      if (p.tint) instanced.setColorAt(i, p.tint);
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
    parent.add(instanced);
    made.push(instanced);
  }
  return made;
}

/** Wind sway injected into any standard material, driven by a shared clock uniform. */
export function applyWind(material: THREE.Material, timeUniform: THREE.IUniform, strength: number, stiffness = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = timeUniform;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec3 windOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
       #else
         vec3 windOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
       #endif
       float gust = sin(uWindTime * 0.9 + windOrigin.x * 0.25 + windOrigin.z * 0.2)
                  + 0.45 * sin(uWindTime * 2.3 + windOrigin.z * 0.6)
                  + 0.2 * sin(uWindTime * 4.1 + windOrigin.x * 0.9);
       float height = max(transformed.y, 0.0);
       float bend = pow(height, ${stiffness.toFixed(2)}) * ${strength.toFixed(4)};
       transformed.x += gust * bend;
       transformed.z += cos(uWindTime * 1.1 + windOrigin.x * 0.4) * bend * 0.55;`
    );
  };
  material.needsUpdate = true;
}
