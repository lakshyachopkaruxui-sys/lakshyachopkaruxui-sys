import * as THREE from 'three';

/** Exact angle-addition form of the existing forest wind. Evaluate eight time
 * functions once per frame, and static spatial phases once per plant, instead
 * of four transcendental functions for every grass vertex in both XR eyes. */
export class ForestGrassWind {
  readonly sine = { value: new THREE.Vector4() };
  readonly cosine = { value: new THREE.Vector4(1, 1, 1, 1) };

  update(time: number) {
    this.sine.value.set(Math.sin(time * .9), Math.sin(time * 2.3), Math.sin(time * 4.1), Math.sin(time * 1.1));
    this.cosine.value.set(Math.cos(time * .9), Math.cos(time * 2.3), Math.cos(time * 4.1), Math.cos(time * 1.1));
  }

  prepareBend(geometry: THREE.BufferGeometry, stiffness: number) {
    const position = geometry.getAttribute('position');
    const weights = new Float32Array(position.count);
    for (let i = 0; i < weights.length; i++) weights[i] = Math.pow(Math.max(position.getY(i), 0), stiffness);
    geometry.setAttribute('forestBendWeight', new THREE.BufferAttribute(weights, 1));
  }

  apply(material: THREE.Material, precomputedBend = false) {
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      if (precomputedBend) {
        shader.vertexShader = 'attribute float forestBendWeight;\n' + shader.vertexShader
          .replace(/pow\(height, [0-9.]+\)/g, 'forestBendWeight');
      }
      shader.uniforms.uForestWindSin = this.sine; shader.uniforms.uForestWindCos = this.cosine;
      shader.vertexShader = `uniform vec4 uForestWindSin, uForestWindCos;
        attribute vec4 forestWindPhaseA, forestWindPhaseB;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(/float gust = sin\(uWindTime[^;]+;/,
        `float gust = uForestWindSin.x * forestWindPhaseA.x + uForestWindCos.x * forestWindPhaseA.y
          + .45 * (uForestWindSin.y * forestWindPhaseA.z + uForestWindCos.y * forestWindPhaseA.w)
          + .2 * (uForestWindSin.z * forestWindPhaseB.x + uForestWindCos.z * forestWindPhaseB.y);`)
        .replace('cos(uWindTime * 1.1 + windOrigin.x * 0.4)',
          '(uForestWindCos.w * forestWindPhaseB.z - uForestWindSin.w * forestWindPhaseB.w)');
    };
    material.customProgramCacheKey = () => `${key}|forest-precomputed-wind-v2|${precomputedBend}`;
  }

  bind(mesh: THREE.InstancedMesh, far?: THREE.BufferGeometry) {
    const a = new Float32Array(mesh.count * 4), b = new Float32Array(mesh.count * 4);
    const matrices = mesh.instanceMatrix.array;
    for (let i = 0; i < mesh.count; i++) {
      const x = matrices[i * 16 + 12], z = matrices[i * 16 + 14];
      const phase1 = x * .25 + z * .2, phase2 = z * .6, phase3 = x * .9, phase4 = x * .4;
      a.set([Math.cos(phase1), Math.sin(phase1), Math.cos(phase2), Math.sin(phase2)], i * 4);
      b.set([Math.cos(phase3), Math.sin(phase3), Math.cos(phase4), Math.sin(phase4)], i * 4);
    }
    const near = sharedGeometry(mesh.geometry);
    near.setAttribute('forestWindPhaseA', new THREE.InstancedBufferAttribute(a, 4));
    near.setAttribute('forestWindPhaseB', new THREE.InstancedBufferAttribute(b, 4));
    mesh.geometry = near;
    if (!far) return { near };
    const distant = sharedGeometry(near); distant.setIndex(far.index);
    return { near, far: distant };
  }
}

/** Only the two phase attributes are new per patch. Reuse source vertex/index
 * storage; duplicating scanned meshes per patch would waste headset memory. */
function sharedGeometry(source: THREE.BufferGeometry) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  geometry.boundingBox = source.boundingBox;
  geometry.boundingSphere = source.boundingSphere;
  return geometry;
}
