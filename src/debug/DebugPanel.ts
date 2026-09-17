import * as THREE from 'three';

/**
 * Developer debug readout. Off by default; enable with ?debug or the ` key.
 * Shows as a DOM overlay on desktop and as a floating panel inside the headset.
 */
export class DebugPanel {
  enabled: boolean;
  private dom = document.getElementById('debug') as HTMLDivElement;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private accum = 0;
  private frames = 0;
  fps = 0;

  constructor(overlay: THREE.Scene, enabledByDefault: boolean) {
    this.enabled = enabledByDefault || new URLSearchParams(location.search).has('debug');
    this.canvas.width = 512;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.45),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false })
    );
    this.mesh.position.set(-0.95, 1.45, -0.9);
    this.mesh.rotation.y = 0.5;
    overlay.add(this.mesh);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.enabled = !this.enabled;
    });
  }

  tick(dt: number) {
    this.accum += dt;
    this.frames++;
    if (this.accum >= 0.5) {
      this.fps = this.frames / this.accum;
      this.accum = 0;
      this.frames = 0;
      return true;
    }
    return false;
  }

  show(lines: string[], inXR: boolean) {
    this.dom.hidden = !this.enabled || inXR;
    this.mesh.visible = this.enabled && inXR;
    if (!this.enabled) return;
    const text = lines.join('\n');
    if (!inXR) {
      this.dom.textContent = text;
      return;
    }
    const c = this.ctx;
    c.clearRect(0, 0, 512, 512);
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(0, 0, 512, 512);
    c.fillStyle = '#bfe';
    c.font = '18px monospace';
    lines.forEach((l, i) => c.fillText(l, 12, 28 + i * 22));
    this.texture.needsUpdate = true;
  }
}
