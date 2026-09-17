import * as THREE from 'three';
import { applyStencilLayer } from '../portal/PortalRenderer';

export interface WatcherCover {
  /** Coordinates in the watcher parent's frame, at the stone's grounded base. */
  position: THREE.Vector3;
  radius: number;
  height: number;
  mesh: THREE.Mesh;
}

interface Obstacle { center: THREE.Vector2; radius: number; }

/** An unknown silhouette which creeps while unseen, never jumps between cover. */
export class WorldWatcher {
  readonly root = new THREE.Group();
  readonly covers: readonly WatcherCover[];
  readonly ready = Promise.resolve();
  private viewer = new THREE.Vector3();
  private forward = new THREE.Vector3(0, 0, -1);
  private inverse = new THREE.Matrix4();
  private ray = new THREE.Raycaster();
  private direction = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private eyes: THREE.Mesh[] = [];
  private eyeMaterial: THREE.MeshBasicMaterial;
  private bodyMaterial: THREE.MeshStandardMaterial;
  private obstacles: Obstacle[] = [];
  private navigationNodes: THREE.Vector2[] = [];
  private route: THREE.Vector2[] = [];
  private routeViewer = new THREE.Vector2();
  private routeAge = 0;
  private active = false;
  private elapsed = 0;
  private unseen = 0;
  private noticeTime = 0;
  private hintPending = false;
  private hintIssued = false;
  private currentSite = -1;
  private moves = 0;
  private approachDistance = 0;
  private approachSteps = 0;
  private phase = 'inactive';
  private proximityHidden = false;
  private reveal = 0;
  // The home island's minimum rim is > 13.9 m. Stay well inside it.
  private readonly islandRadius = 13.3;
  private readonly stoppingDistance = 4.8;
  private readonly speed = 0.18;

  constructor(
    private parent: THREE.Group,
    covers: WatcherCover[],
    private heightAt: (x: number, z: number) => number,
    private stencilLayer: () => number,
    _loadModel = true
  ) {
    this.covers = covers;
    this.root.name = 'quiet observer behind stone';
    this.root.visible = false;
    parent.add(this.root);
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x100c16, roughness: 1, metalness: 0,
      transparent: true, opacity: 0, depthWrite: false
    });
    const silhouette = new THREE.Group();
    silhouette.name = 'unknown shadow creature';
    // A closed, asymmetric mantle: no recognisable face, cheerful costume,
    // or exposed seam where a billboard would turn sideways.
    const profile = [
      [0, 0], [0.12, 0.035], [0.15, 0.24], [0.125, 0.62],
      [0.13, 1.04], [0.19, 1.44], [0.125, 1.66], [0.055, 1.74], [0, 1.76]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const mantleGeometry = new THREE.LatheGeometry(profile, 20);
    const vertices = mantleGeometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const y = vertices.getY(i);
      vertices.setXYZ(i, vertices.getX(i) + Math.sin(y * 2.4) * 0.028,
        y, vertices.getZ(i) * 0.64 + Math.sin(y * 1.8) * 0.018);
    }
    mantleGeometry.computeVertexNormals();
    const mantle = new THREE.Mesh(mantleGeometry, this.bodyMaterial);
    mantle.name = 'unfamiliar elongated shadow';
    silhouette.add(mantle);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), this.bodyMaterial);
    head.name = 'featureless narrow head';
    head.position.set(0, 1.91, 0.018);
    head.scale.set(0.125, 0.19, 0.10);
    silhouette.add(head);
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.15, 1.59, 0),
        new THREE.Vector3(side * 0.245, 1.30, -0.02),
        new THREE.Vector3(side * 0.22, 0.93, -0.055),
        new THREE.Vector3(side * 0.255, 0.53, 0.008)
      ]);
      const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.023, 7, false), this.bodyMaterial);
      arm.name = 'indistinct trailing limb';
      silhouette.add(arm);
    }
    this.root.add(silhouette);
    this.eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0xc7c9cd, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: true
    });
    const eyeGeometry = new THREE.SphereGeometry(0.025, 12, 8);
    for (const x of [-0.047, 0.047]) {
      const eye = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
      eye.name = 'watcher pale eye';
      eye.position.set(x, 1.93, 0.119);
      eye.scale.set(1.3, 0.60, 0.35);
      this.root.add(eye);
      this.eyes.push(eye);
    }
    applyStencilLayer(this.root, this.stencilLayer());
    this.buildNavigation();
  }

  /** Inputs are world-space and never mutated. Inactive previews have no observer. */
  update(viewerWorld: THREE.Vector3, forwardWorld: THREE.Vector3, active: boolean, dt: number) {
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    if (!active) {
      this.active = false; this.root.visible = false; this.phase = 'inactive';
      this.hintPending = false; this.noticeTime = 0; this.route = [];
      return;
    }
    if (!this.active) {
      this.active = true; this.elapsed = 0; this.unseen = 0;
      this.currentSite = -1; this.noticeTime = 0; this.hintPending = false; this.hintIssued = false;
      this.proximityHidden = false; this.reveal = 0; this.moves = 0;
      this.approachDistance = 0; this.approachSteps = 0; this.route = []; this.routeAge = 0;
      this.root.visible = false; this.phase = 'settling';
      this.bodyMaterial.opacity = 0; this.eyeMaterial.opacity = 0;
    }
    if (![...viewerWorld, ...forwardWorld].every(Number.isFinite) || forwardWorld.lengthSq() < 1e-8 || delta === 0) return;
    this.parent.updateWorldMatrix(true, false);
    this.inverse.copy(this.parent.matrixWorld).invert();
    this.viewer.copy(viewerWorld).applyMatrix4(this.inverse);
    this.forward.copy(forwardWorld).transformDirection(this.inverse).normalize();
    for (const cover of this.covers) cover.mesh.updateWorldMatrix(true, false);
    this.elapsed += delta;
    if (this.elapsed < 6) { this.phase = 'settling'; return; }
    if (this.currentSite < 0 && !this.placeAtDistantCover()) {
      this.phase = 'waiting for distant cover'; return;
    }

    const horizontalDistance = Math.hypot(this.root.position.x - this.viewer.x, this.root.position.z - this.viewer.z);
    // A visitor may walk toward it. It never flees or reappears in personal
    // space: close approach conceals it until the next visit to this world.
    if (horizontalDistance < 3) this.proximityHidden = true;
    if (this.proximityHidden) {
      this.root.visible = false; this.phase = 'concealed'; this.route = []; return;
    }
    this.root.visible = true;
    this.reveal = Math.min(1, this.reveal + delta / 2.2);
    const fade = THREE.MathUtils.smoothstep(this.reveal, 0, 1);
    this.bodyMaterial.opacity = fade * 0.86;
    this.eyeMaterial.opacity = fade * 0.80;

    const visibleCone = this.inView(this.root.position);
    this.unseen = visibleCone ? 0 : this.unseen + delta;
    this.routeAge += delta;
    let moved = false;
    // First discover it in the distance. Only after that actual sighting can
    // it approach; broad peripheral vision freezes even an obscured body.
    if (this.hintIssued && !visibleCone && this.unseen >= 0.8 && this.reveal === 1 && horizontalDistance > this.stoppingDistance) {
      moved = this.approach(delta);
    }
    this.root.rotation.y = Math.atan2(this.viewer.x - this.root.position.x, this.viewer.z - this.root.position.z);
    this.root.updateWorldMatrix(true, true);
    this.eye.copy(this.eyes[0].position).add(this.eyes[1].position).multiplyScalar(0.5);
    this.eye.applyQuaternion(this.root.quaternion).add(this.root.position);
    this.direction.subVectors(this.eye, this.viewer);
    const eyeDistance = this.direction.length();
    const looking = eyeDistance > 0 && this.direction.divideScalar(eyeDistance).dot(this.forward) > 0.91;
    const noticed = looking && !this.occluded(this.eye) && fade > 0.45;
    this.phase = noticed ? 'observed' : moved ? 'drawing nearer' : 'watching';
    this.noticeTime = noticed ? this.noticeTime + delta : 0;
    if (!this.hintIssued && this.noticeTime > 0.55) {
      this.hintIssued = true; this.hintPending = true;
    }
  }

  private buildNavigation() {
    this.parent.updateWorldMatrix(true, true);
    const inverse = this.parent.matrixWorld.clone().invert();
    for (const cover of this.covers) {
      cover.mesh.geometry.computeBoundingBox();
      const box = cover.mesh.geometry.boundingBox!.clone().applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, cover.mesh.matrixWorld));
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      // Circumscribe the actual stone footprint plus the trailing limbs.
      this.obstacles.push({ center: new THREE.Vector2(center.x, center.z), radius: Math.max(cover.radius, size.x / 2, size.z / 2) + 0.31 });
    }
    for (const obstacle of this.obstacles) {
      // Adjacent octagon chords remain outside the collision circle.
      const radius = (obstacle.radius + 0.065) / Math.cos(Math.PI / 8);
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2;
        const point = obstacle.center.clone().add(new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(radius));
        if (this.clearPoint(point)) this.navigationNodes.push(point);
      }
    }
  }

  private placeAtDistantCover() {
    let best: THREE.Vector3 | null = null, bestIndex = -1, score = Infinity;
    const viewer = new THREE.Vector2(this.viewer.x, this.viewer.z);
    for (let i = 0; i < this.obstacles.length; i++) {
      const obstacle = this.obstacles[i];
      const away = obstacle.center.clone().sub(viewer);
      if (away.lengthSq() < 0.01) continue;
      away.normalize();
      const position = obstacle.center.clone().addScaledVector(away, obstacle.radius + 0.08);
      const distance = position.distanceTo(viewer);
      if (distance < 11 || distance > 14 || !this.clearPoint(position)) continue;
      const candidate = new THREE.Vector3(position.x, this.heightAt(position.x, position.y), position.y);
      const upper = candidate.clone(); upper.y += 1.93;
      // Keep the eyes discoverable above or beside the chosen low stone.
      if (this.occluded(upper)) continue;
      const difference = Math.abs(distance - 12.6) + (this.inView(candidate) ? 2 : 0);
      if (difference < score) { score = difference; best = candidate; bestIndex = i; }
    }
    if (!best) return false;
    this.root.position.copy(best);
    this.currentSite = bestIndex;
    this.moves++;
    applyStencilLayer(this.root, this.stencilLayer());
    return true;
  }

  private clearPoint(point: THREE.Vector2) {
    return point.length() <= this.islandRadius && this.obstacles.every(obstacle => point.distanceToSquared(obstacle.center) >= obstacle.radius * obstacle.radius);
  }

  private clearSegment(from: THREE.Vector2, to: THREE.Vector2) {
    if (!this.clearPoint(from) || !this.clearPoint(to)) return false;
    const dx = to.x - from.x, dz = to.y - from.y, lengthSq = dx * dx + dz * dz;
    return this.obstacles.every(obstacle => {
      const u = lengthSq < 1e-12 ? 0 : THREE.MathUtils.clamp(((obstacle.center.x - from.x) * dx + (obstacle.center.y - from.y) * dz) / lengthSq, 0, 1);
      const x = from.x + dx * u - obstacle.center.x, z = from.y + dz * u - obstacle.center.y;
      return x * x + z * z >= obstacle.radius * obstacle.radius - 1e-9;
    });
  }

  private planRoute() {
    this.route = []; this.routeAge = 0;
    this.routeViewer.set(this.viewer.x, this.viewer.z);
    const start = new THREE.Vector2(this.root.position.x, this.root.position.z);
    const towardViewer = this.routeViewer.clone().sub(start);
    const travel = towardViewer.length() - this.stoppingDistance;
    if (travel <= 0) return;
    towardViewer.normalize();
    let target = start.clone();
    // If the desired resting point lies in a stone, stop slightly earlier.
    for (let advance = travel; advance > 0.08; advance -= 0.15) {
      target = start.clone().addScaledVector(towardViewer, advance);
      if (this.clearPoint(target)) break;
    }
    if (!this.clearPoint(target) || target.distanceToSquared(start) < 0.0064) return;
    const nodes = [start, target, ...this.navigationNodes];
    const distance = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = nodes.map(() => false);
    distance[0] = 0;
    for (let count = 0; count < nodes.length; count++) {
      let nearest = -1;
      for (let i = 0; i < nodes.length; i++) if (!visited[i] && Number.isFinite(distance[i]) && (nearest < 0 || distance[i] < distance[nearest])) nearest = i;
      if (nearest < 0 || nearest === 1) break;
      visited[nearest] = true;
      for (let i = 1; i < nodes.length; i++) {
        if (visited[i] || !this.clearSegment(nodes[nearest], nodes[i])) continue;
        const candidate = distance[nearest] + nodes[nearest].distanceTo(nodes[i]);
        if (candidate < distance[i]) { distance[i] = candidate; previous[i] = nearest; }
      }
    }
    if (!Number.isFinite(distance[1])) return;
    for (let at = 1; at !== 0 && at >= 0; at = previous[at]) this.route.unshift(nodes[at].clone());
  }

  private approach(dt: number) {
    const viewer = new THREE.Vector2(this.viewer.x, this.viewer.z);
    if (this.route.length === 0 || (this.routeAge > 0.8 && this.routeViewer.distanceToSquared(viewer) > 0.16)) this.planRoute();
    if (this.route.length === 0) return false;
    const current = new THREE.Vector2(this.root.position.x, this.root.position.z);
    const destination = this.route[0];
    const direction = destination.clone().sub(current);
    const remaining = direction.length();
    if (remaining < 1e-7) { this.route.shift(); return false; }
    const distance = Math.min(remaining, dt * this.speed);
    const next = current.clone().addScaledVector(direction, distance / remaining);
    if (next.distanceTo(viewer) < this.stoppingDistance - 1e-6 || !this.clearSegment(current, next)) {
      this.route = []; return false;
    }
    this.root.position.set(next.x, this.heightAt(next.x, next.y), next.y);
    this.approachDistance += distance; this.approachSteps++;
    if (remaining <= distance + 1e-7) this.route.shift();
    return true;
  }

  private inView(position: THREE.Vector3) {
    this.direction.subVectors(position, this.viewer);
    this.direction.y += 1.1;
    const distance = this.direction.length();
    if (distance < 0.001) return true;
    const halfAngle = Math.min(Math.PI * 0.495, THREE.MathUtils.degToRad(80) + Math.asin(Math.min(0.99, 1.1 / distance)));
    return this.direction.divideScalar(distance).dot(this.forward) >= Math.cos(halfAngle);
  }

  private occluded(localTarget: THREE.Vector3) {
    const from = this.parent.localToWorld(this.viewer.clone());
    const target = this.parent.localToWorld(localTarget.clone());
    const direction = target.sub(from);
    const distance = direction.length();
    if (distance < 0.01) return false;
    this.ray.set(from, direction.divideScalar(distance));
    this.ray.near = 0.02; this.ray.far = Math.max(0.02, distance - 0.025);
    return this.ray.intersectObjects(this.covers.map(cover => cover.mesh), false).length > 0;
  }

  consumeReturnHint() {
    const pending = this.hintPending;
    this.hintPending = false;
    return pending;
  }

  get diagnostics() {
    return {
      active: this.active, phase: this.phase, siteIndex: this.currentSite,
      relocations: this.moves, visible: this.root.visible, elapsed: this.elapsed,
      unseenSeconds: this.unseen, position: this.root.position.clone(),
      viewer: this.viewer.clone(), forward: this.forward.clone(),
      approachDistance: this.approachDistance, approachSteps: this.approachSteps,
      horizontalDistance: Math.hypot(this.root.position.x - this.viewer.x, this.root.position.z - this.viewer.z),
      opacity: this.eyeMaterial.opacity
    };
  }
}
