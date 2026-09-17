import * as THREE from 'three';

/**
 * Text that exists IN the world: drawn onto a canvas, shown on a plane that
 * floats in space and turns to face the viewer. No boxes or panels — the words
 * sit on a soft smoky patch of air, like light written into the scene.
 *
 * Markup: `[F]` draws a key glyph, `{pinch}` draws a pinch glyph, `|` starts
 * the smaller second line.
 */
export interface LabelContent {
  text: string;
  /** 0..1 progress line under the text, or null for none. */
  progress?: number | null;
  progressTone?: 'normal' | 'strain' | 'ready';
  /** Step marks: total and current (0-based), or null. */
  steps?: { total: number; current: number } | null;
  tone?: 'warm' | 'alert' | 'title';
}

const W = 1024;
const FONT_FAMILY = "Georgia, 'Times New Roman', serif";

export class DiegeticLabel {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshBasicMaterial;
  private key = '';
  private opacity = 0;
  targetOpacity = 1;

  constructor(
    widthMetres: number,
    private heightPx: number,
    options: { depthTest?: boolean; renderOrder?: number } = {}
  ) {
    this.canvas.width = W;
    this.canvas.height = heightPx;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: options.depthTest ?? false,
      toneMapped: false,
      fog: false
    });
    const h = (widthMetres * heightPx) / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthMetres, h), this.material);
    this.mesh.renderOrder = options.renderOrder ?? 50;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  set(content: LabelContent) {
    const p = content.progress == null || !Number.isFinite(content.progress)
      ? -1
      : Math.round(THREE.MathUtils.clamp(content.progress, 0, 1) * 60);
    const k = [content.text, p, content.progressTone, content.steps?.current, content.steps?.total, content.tone].join('§');
    if (k === this.key) return;
    this.key = k;
    this.draw(content);
  }

  /** A page of field notes: a heading and a list of lines with key glyphs. */
  setNotes(heading: string, lines: string[]) {
    const k = ['notes', heading, ...lines].join('§');
    if (k === this.key) return;
    this.key = k;
    const ctx = this.ctx;
    const H = this.heightPx;
    ctx.clearRect(0, 0, W, H);
    // A quiet reference card, only summoned when the visitor needs it.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(15, 21, 23, 0.90)';
    roundRect(ctx, 30, 30, W - 60, H - 60, 18);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(229, 213, 184, 0.22)';
    ctx.lineWidth = 2;
    roundRect(ctx, 30, 30, W - 60, H - 60, 18);
    ctx.stroke();

    ctx.font = `italic 58px ${FONT_FAMILY}`;
    ctx.fillStyle = '#e8d8bc';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText(heading, W / 2, 120);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';

    const lineH = Math.min(74, (H - 220) / Math.max(1, lines.length));
    lines.forEach((line, i) => this.richLine(line, 200 + i * lineH, this.fitSize(line, 43, false), '#e9e6df', false));
    this.texture.needsUpdate = true;
  }

  /** Face the viewer (turning only around the vertical axis) and fade. */
  update(dt: number, viewer: THREE.Vector3) {
    const elapsed = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    const target = Number.isFinite(this.targetOpacity) ? THREE.MathUtils.clamp(this.targetOpacity, 0, 1) : 0;
    this.opacity += (target - this.opacity) * (1 - Math.exp(-elapsed * 6));
    this.material.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01 && this.key !== '';
    const dx = viewer.x - this.mesh.position.x;
    const dz = viewer.z - this.mesh.position.z;
    this.mesh.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  private draw(c: LabelContent) {
    const ctx = this.ctx;
    const H = this.heightPx;
    ctx.clearRect(0, 0, W, H);
    this.texture.needsUpdate = true;
    if (!c.text) return;

    // Smoky patch of darker air behind the words, so they read on bright
    // forest or pale sky without a hard-edged panel.
    // Ellipse sized to stay INSIDE the canvas — if it reaches the edge it gets
    // cut off into a visible rectangle.
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, (H * 0.94) / W);
    const haze = ctx.createRadialGradient(0, 0, 10, 0, 0, W * 0.49);
    haze.addColorStop(0, `rgba(8, 13, 16, ${c.tone === 'title' ? 0.28 : 0.80})`);
    haze.addColorStop(0.55, `rgba(8, 13, 16, ${c.tone === 'title' ? 0.18 : 0.60})`);
    haze.addColorStop(1, 'rgba(8, 8, 14, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-W / 2, -W / 2, W, W);
    ctx.restore();

    const [main, sub] = c.text.split('|');
    const title = c.tone === 'title';
    const ink = c.tone === 'alert' ? '#f2cca1' : '#f1eee5';
    // Keep the full chapter name, with a quiet shared prefix and a readable
    // main line. Long names should not become tiny text in the headset.
    if (title && main.startsWith('The World of ') && !sub) {
      const chapter = main.slice('The World of '.length);
      const chapterSize = this.fitSize(chapter, 112, true);
      const blockH = 38 + 26 + chapterSize;
      const top = (H - blockH) / 2;
      this.richLine('The World of', top + 38 * 0.85, 38, '#d5d6d0', false);
      this.richLine(chapter, top + 38 + 26 + chapterSize * 0.85, chapterSize, ink, true);
      return;
    }
    // Shrink long lines until they fit, rather than letting them run off the edge.
    const mainSize = this.fitSize(main.trim(), title ? 92 : 62, title);
    const subSize = sub ? this.fitSize(sub.trim(), 40, false) : 40;
    const extrasHeight = (c.progress != null ? 38 : 0) + (c.steps ? (c.progress != null ? 32 : 40) : 0);
    const blockH = mainSize + (sub ? subSize + 26 : 0) + extrasHeight;
    let y = (H - blockH) / 2 + mainSize * 0.85;

    this.richLine(main.trim(), y, mainSize, ink, title);
    if (sub) {
      y += subSize + 26;
      this.richLine(sub.trim(), y, subSize, '#d5d6d0', false);
    }

    if (c.progress != null) {
      y += 38;
      const w = 320, x0 = (W - w) / 2;
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
      const tone = c.progressTone === 'ready' ? '#c2d9b5' : c.progressTone === 'strain' ? '#d9ad86' : '#d9c8a7';
      ctx.strokeStyle = tone;
      ctx.shadowColor = tone;
      ctx.shadowBlur = 0;
      const progress = Number.isFinite(c.progress) ? THREE.MathUtils.clamp(c.progress, 0, 1) : 0;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + Math.max(2, w * progress), y); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (c.steps) {
      y += c.progress != null ? 32 : 40;
      const gap = 34, x0 = W / 2 - ((c.steps.total - 1) * gap) / 2;
      for (let i = 0; i < c.steps.total; i++) {
        const cx = x0 + i * gap;
        const r = i === c.steps.current ? 6 : 4;
        ctx.save();
        ctx.translate(cx, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = i < c.steps.current ? 'rgba(224, 209, 178, 0.65)' : i === c.steps.current ? '#e0d1b2' : 'rgba(255,255,255,0.22)';
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
    }
    this.texture.needsUpdate = true;
  }

  private fitSize(text: string, size: number, title: boolean) {
    for (let s = size; s > 18; s -= 2) {
      if (this.measureRich(text, s, title) <= W * 0.86) return s;
    }
    return 18;
  }

  private measureRich(text: string, size: number, title: boolean) {
    const ctx = this.ctx;
    const font = `${title ? 'italic 400' : '500'} ${size}px ${FONT_FAMILY}`;
    const keyFont = `600 ${Math.round(size * 0.62)}px ${FONT_FAMILY}`;
    let total = 0;
    for (const part of text.split(/(\[[^\]]+\]|\{pinch\})/).filter(Boolean)) {
      if (part === '{pinch}') total += size * 1.1;
      else if (part.startsWith('[')) {
        ctx.font = keyFont;
        total += Math.max(size * 0.95, ctx.measureText(part.slice(1, -1)).width + size * 0.55) + size * 0.2;
      } else {
        ctx.font = font;
        total += ctx.measureText(part).width;
      }
    }
    return total;
  }

  /** One centred line with inline key / pinch glyphs. */
  private richLine(text: string, baseline: number, size: number, colour: string, title: boolean) {
    const ctx = this.ctx;
    const font = `${title ? 'italic 400' : '500'} ${size}px ${FONT_FAMILY}`;
    const keyFont = `600 ${Math.round(size * 0.62)}px ${FONT_FAMILY}`;
    const parts = text.split(/(\[[^\]]+\]|\{pinch\})/).filter(Boolean);

    const widthOf = (part: string) => {
      if (part === '{pinch}') return size * 1.1;
      if (part.startsWith('[')) {
        ctx.font = keyFont;
        return Math.max(size * 0.95, ctx.measureText(part.slice(1, -1)).width + size * 0.55) + size * 0.2;
      }
      ctx.font = font;
      return ctx.measureText(part).width;
    };
    const total = parts.reduce((s, p) => s + widthOf(p), 0);
    let x = (W - total) / 2;

    for (const part of parts) {
      const w = widthOf(part);
      if (part === '{pinch}') {
        this.pinchGlyph(x + w / 2, baseline - size * 0.32, size * 0.42);
      } else if (part.startsWith('[')) {
        const label = part.slice(1, -1);
        const kw = w - size * 0.2;
        const kh = size * 0.92;
        const kx = x + size * 0.1;
        const ky = baseline - size * 0.78;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(224, 214, 194, 0.15)';
        roundRect(ctx, kx, ky, kw, kh, size * 0.18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(230, 218, 196, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(230, 218, 196, 0.14)';
        roundRect(ctx, kx, ky + kh - size * 0.1, kw, size * 0.1, size * 0.05);
        ctx.fill();
        ctx.font = keyFont;
        ctx.fillStyle = '#f1eee5';
        ctx.textAlign = 'center';
        ctx.fillText(label, kx + kw / 2, ky + kh * 0.66);
        ctx.textAlign = 'left';
      } else {
        ctx.font = font;
        ctx.fillStyle = colour;
        ctx.shadowColor = title ? 'rgba(229, 214, 184, 0.35)' : 'rgba(0, 0, 0, 0.95)';
        ctx.shadowBlur = title ? 10 : 5;
        ctx.fillText(part, x, baseline);
        ctx.shadowBlur = 0;
      }
      x += w;
    }
  }

  /** Two fingertips meeting — the headset version of a key glyph. */
  private pinchGlyph(cx: number, cy: number, r: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#e0d1b2';
    ctx.fillStyle = '#e0d1b2';
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(cx - r, cy - r * 0.9); ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.2, cx - r * 0.12, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + r, cy + r * 0.9); ctx.quadraticCurveTo(cx + r * 0.2, cy + r * 0.2, cx + r * 0.12, cy); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
