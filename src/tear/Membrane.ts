import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { MAX_CRACK_POINTS, type TearSimulation } from './TearSimulation';
import { MEMBRANE_FRAGMENT, MEMBRANE_VERTEX } from './membraneShader';

const T = CONFIG.tear;

/**
 * The visible torn membrane plus its two invisible portal passes:
 *  - mask:  writes stencil (parentLayer → parentLayer+1) where the hole is
 *  - reset: pushes depth to the far plane inside the hole so the inner
 *           world is not hidden behind whatever the outer world drew there
 * All three share one geometry and one deformation shader.
 */
export class Membrane {
  readonly paper: THREE.Mesh;
  readonly maskRoot = new THREE.Group();
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(private anchor: THREE.Object3D, maskScene: THREE.Scene, readonly parentLayer = 0) {
    const geometry = new THREE.PlaneGeometry(T.membraneWidth, T.membraneHeight, T.gridSegments, Math.round((T.gridSegments * T.membraneHeight) / T.membraneWidth));
    const cell = T.membraneWidth / T.gridSegments;

    this.uniforms = {
      uCrack: { value: Array.from({ length: MAX_CRACK_POINTS }, () => new THREE.Vector3()) },
      uCrackCount: { value: 0 },
      uTornA: { value: 0 },
      uTornB: { value: 0 },
      uArcA: { value: 0 },
      uArcB: { value: 0 },
      uGripMat: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uGripArc: { value: [0, 0] },
      uGripDisp: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uStrain: { value: 0 },
      uEnergy: { value: 0 },
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uIdleGlow: { value: CONFIG.light.idleGlow },
      uFallAlong: { value: T.gripFalloffAlong },
      uFallAcross: { value: T.gripFalloffAcross },
      uEdgeCurl: { value: T.edgeCurl },
      uWrinkle: { value: T.strainWrinkle },
      uCell: { value: cell },
      uSize: { value: new THREE.Vector2(T.membraneWidth, T.membraneHeight) },
      uPaperColor: { value: new THREE.Color(0xd9d2c3) },
      uLeakColor: { value: new THREE.Color(0xffc27a) },
      uAmbient: { value: new THREE.Color(0x8a93a6) }
    };

    const paperMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: MEMBRANE_VERTEX,
      fragmentShader: MEMBRANE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    setStencilTest(paperMat, parentLayer);
    this.paper = new THREE.Mesh(geometry, paperMat);
    this.paper.frustumCulled = false;
    this.paper.renderOrder = 10;
    anchor.add(this.paper);

    const maskMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: MEMBRANE_VERTEX,
      fragmentShader: MEMBRANE_FRAGMENT,
      defines: { MASK_MODE: 1 },
      colorWrite: false,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    maskMat.stencilWrite = true;
    maskMat.stencilFunc = THREE.EqualStencilFunc;
    maskMat.stencilRef = parentLayer;
    maskMat.stencilFail = THREE.KeepStencilOp;
    maskMat.stencilZFail = THREE.KeepStencilOp;
    maskMat.stencilZPass = THREE.IncrementStencilOp;

    const resetMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: MEMBRANE_VERTEX,
      fragmentShader: MEMBRANE_FRAGMENT,
      defines: { DEPTH_RESET: 1 },
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
      side: THREE.DoubleSide
    });
    setStencilTest(resetMat, parentLayer + 1);

    const mask = new THREE.Mesh(geometry, maskMat);
    const reset = new THREE.Mesh(geometry, resetMat);
    mask.frustumCulled = reset.frustumCulled = false;
    mask.renderOrder = 0;
    reset.renderOrder = 1;
    this.maskRoot.matrixAutoUpdate = false;
    this.maskRoot.add(mask, reset);
    maskScene.add(this.maskRoot);
  }

  sync(sim: TearSimulation, time: number, leakColor: THREE.Color) {
    const u = this.uniforms;
    const pts = u.uCrack.value as THREE.Vector3[];
    const n = sim.points.length;
    for (let i = 0; i < MAX_CRACK_POINTS; i++) pts[i].copy(sim.points[Math.min(i, n - 1)]);
    u.uCrackCount.value = n;
    u.uTornA.value = sim.tornA;
    u.uTornB.value = sim.tornB;
    u.uArcA.value = sim.arcA;
    u.uArcB.value = sim.arcB;
    for (let h = 0; h < 2; h++) {
      const g = sim.grips[h];
      (u.uGripMat.value as THREE.Vector4[])[h].set(g.material.x, g.material.y, g.side, g.weight);
      (u.uGripArc.value as number[])[h] = g.arc;
      (u.uGripDisp.value as THREE.Vector3[])[h].copy(g.disp);
    }
    u.uStrain.value = sim.strain;
    u.uEnergy.value = sim.energy;
    u.uOpen.value = sim.openness;
    u.uTime.value = time;
    (u.uLeakColor.value as THREE.Color).copy(leakColor);

    this.anchor.updateMatrixWorld();
    this.maskRoot.matrix.copy(this.anchor.matrixWorld);
    this.maskRoot.matrixWorldNeedsUpdate = true;
  }
}

/** Make a material draw only where the stencil equals `layer`. */
export function setStencilTest(m: THREE.Material, layer: number) {
  m.stencilWrite = true;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilRef = layer;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  m.stencilZPass = THREE.KeepStencilOp;
}
