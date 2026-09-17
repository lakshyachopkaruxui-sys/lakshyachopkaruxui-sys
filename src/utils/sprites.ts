import * as THREE from 'three';

let dot: THREE.CanvasTexture | null = null;

/** A soft round dot, so particle systems read as motes rather than squares. */
export function dotTexture() {
  if (dot) return dot;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  dot = new THREE.CanvasTexture(canvas);
  dot.colorSpace = THREE.SRGBColorSpace;
  return dot;
}
