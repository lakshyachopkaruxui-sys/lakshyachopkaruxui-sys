import * as THREE from 'three';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { FOREST_SAMPLE } from './ForestSampleLayout';

/** Keep this temporary review aid until the user explicitly requests removal. */
export const SHOW_FOREST_SAMPLE_MARKER = false;

/** One static, camera-facing marker: readable from either side in desktop/XR.
 * The bottom-centre anchor pins the arrow tip just above the sample centre. */
export function createForestSampleMarker(ground: (x: number, z: number) => number, layer: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 640;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#09252e';
  context.beginPath(); context.roundRect(16, 16, 480, 136, 20); context.fill();
  context.strokeStyle = '#69edff'; context.lineWidth = 5; context.stroke();
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#ffffff'; context.font = 'bold 32px sans-serif';
  context.fillText('FOREST SAMPLE', 256, 59);
  context.fillStyle = '#69edff'; context.font = 'bold 44px sans-serif';
  context.fillText('5 × 5 m', 256, 112);
  context.beginPath();
  context.moveTo(213, 190); context.lineTo(299, 190);
  context.lineTo(299, 394); context.lineTo(388, 394);
  context.lineTo(256, 624); context.lineTo(124, 394);
  context.lineTo(213, 394); context.closePath();
  context.fillStyle = '#69edff'; context.fill();
  context.strokeStyle = '#09252e'; context.lineWidth = 18; context.lineJoin = 'round'; context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, depthTest: true, depthWrite: false, toneMapped: false, fog: false
  }));
  marker.name = 'Temporary forest sample downward arrow';
  marker.userData.temporaryForestSampleMarker = true;
  const x = (FOREST_SAMPLE.minX + FOREST_SAMPLE.maxX) / 2;
  const z = (FOREST_SAMPLE.minZ + FOREST_SAMPLE.maxZ) / 2;
  marker.position.set(x, ground(x, z) + .12, z);
  marker.center.set(.5, 0); marker.scale.set(1.6, 2, 1);
  applyStencilLayer(marker, layer);
  return marker;
}
