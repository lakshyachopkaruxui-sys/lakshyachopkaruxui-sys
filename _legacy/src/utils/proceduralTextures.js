import * as THREE from 'three';

// Small procedurally-generated (canvas-based) textures. No external image
// assets are used anywhere in this project — see README "Asset Strategy".

/**
 * A vertical alpha fringe: solid near v=0 (outer, intact paper edge),
 * dissolving into ragged noise toward v=1 (inner, curled/torn edge).
 * Tiled horizontally so it repeats around the tear's curled edge ribbon.
 */
export function createFibreFringeTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    // solid near v=0, increasingly ragged/sparse near v=1
    for (let x = 0; x < size; x++) {
      const n = fringeNoise(x * 0.18, y * 0.23) * fringeNoise(x * 0.07 + 40.0, y * 0.05 + 12.0);
      const threshold = v * v; // ramps 0..1, biased toward staying solid early
      let alpha = 1 - threshold - n * threshold * 1.4;
      alpha = Math.max(0, Math.min(1, alpha));
      const i = (y * size + x) * 4;
      const shade = 200 - v * 90; // slightly darker toward the torn inner edge
      img.data[i] = shade;
      img.data[i + 1] = shade * 0.96;
      img.data[i + 2] = shade * 0.9;
      img.data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A faint jagged crack line on a transparent background — the "strange
 * visual seam" the player notices before ever touching it (brief's Stage
 * One: "almost nothing visible"). Drawn as a wandering broken line with a
 * soft glow, not a shape that reads as an obvious UI affordance.
 */
export function createCrackHintTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  let x = size * 0.5;
  let y = size * 0.15;
  ctx.lineCap = 'round';

  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    let px = x, py = y;
    for (let i = 0; i < 14; i++) {
      px += (fringeNoise(i * 3.1 + pass * 11.0, pass * 7.0) - 0.5) * size * 0.09;
      py += size * 0.06 + fringeNoise(i * 5.3, pass * 3.0 + 2.0) * size * 0.02;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(255,255,255,${0.5 - pass * 0.15})`;
    ctx.lineWidth = 3 - pass;
    ctx.filter = pass === 0 ? 'blur(4px)' : 'none';
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** A soft radial-falloff dot, for particle sprites (dust/fibres/light motes). */
export function createSoftDotTexture(size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function fringeNoise(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
