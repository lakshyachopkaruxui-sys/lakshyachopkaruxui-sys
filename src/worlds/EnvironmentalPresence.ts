import * as THREE from 'three';

/** A small, eased response to the participant's position. It never moves the
 * camera, changes locomotion or requires a new gesture. Coordinates are world
 * space so a world can be yaw-aligned to any tear without losing the response. */
export class EnvironmentalPresence {
  readonly position = { value: new THREE.Vector3() };
  readonly strength = { value: 0 };
  private initialized = false;

  update(position: THREE.Vector3, active: boolean, dt: number) {
    const valid = [position.x, position.y, position.z].every(Number.isFinite);
    const enabled = active && valid;
    const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    if (enabled) {
      if (!this.initialized) this.position.value.copy(position);
      else this.position.value.lerp(position, 1 - Math.exp(-step * 12));
      this.initialized = true;
    }
    this.strength.value = THREE.MathUtils.damp(this.strength.value, enabled ? 1 : 0, 5, step);
    if (!enabled && this.strength.value < 0.001) {
      this.strength.value = 0;
      this.initialized = false;
    }
  }

  /** Horizontal distance suits waist/ground-height flora. The viewer need not
   * crouch or touch a virtual object to discover that it responds. */
  weight(point: THREE.Vector3, radius: number) {
    if (!Number.isFinite(radius) || radius <= 0) return 0;
    const distance = Math.hypot(point.x - this.position.value.x, point.z - this.position.value.z);
    if (!Number.isFinite(distance)) return 0;
    return (1 - THREE.MathUtils.smoothstep(distance, 0, radius)) * this.strength.value;
  }
}

/** Bend foliage away from the viewer with a pinned base. This adds uniforms,
 * not a draw call or per-plant CPU update. World-space influence is converted
 * back through each instance's orthogonal scaled basis, preserving metre scale. */
export function applyPlantPresence(material: THREE.Material, presence: EnvironmentalPresence, radius: number, bend: number, glow = false) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uPresencePosition = presence.position;
    shader.uniforms.uPresenceStrength = presence.strength;
    shader.vertexShader = `uniform vec3 uPresencePosition; uniform float uPresenceStrength; varying float vPlantPresence;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      mat4 plantMatrix = modelMatrix;
      #ifdef USE_INSTANCING
        plantMatrix = modelMatrix * instanceMatrix;
      #endif
      vec3 plantOrigin = plantMatrix[3].xyz;
      vec2 plantDelta = plantOrigin.xz - uPresencePosition.xz;
      float plantDistance = length(plantDelta);
      vPlantPresence = (1.0 - smoothstep(0.0, ${radius.toFixed(3)}, plantDistance)) * uPresenceStrength;
      vec2 plantAway = plantDistance > .001 ? plantDelta / plantDistance : vec2(1.0, 0.0);
      float plantPin = smoothstep(0.0, 0.7, max(position.y, 0.0));
      vec3 plantShift = vec3(plantAway.x, 0.0, plantAway.y) * vPlantPresence * plantPin * ${bend.toFixed(3)};
      transformed += vec3(dot(plantShift, plantMatrix[0].xyz) / max(dot(plantMatrix[0].xyz, plantMatrix[0].xyz), .0001),
        dot(plantShift, plantMatrix[1].xyz) / max(dot(plantMatrix[1].xyz, plantMatrix[1].xyz), .0001),
        dot(plantShift, plantMatrix[2].xyz) / max(dot(plantMatrix[2].xyz, plantMatrix[2].xyz), .0001));
      #include <project_vertex>`);
    if (glow) {
      shader.fragmentShader = 'varying float vPlantPresence;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(.12, .22, .28) * vPlantPresence;`);
    }
  };
  material.customProgramCacheKey = () => `${previousKey}-presence-v1-${radius}-${bend}-${glow}`;
  material.needsUpdate = true;
}
