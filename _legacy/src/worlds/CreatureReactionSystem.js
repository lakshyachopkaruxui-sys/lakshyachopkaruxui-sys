import * as THREE from 'three';
import { damp, clamp } from '../utils/math.js';

// A deliberately simple state-based "creature" (brief: "This does not
// require complex artificial intelligence. Simple state-based behavior is
// sufficient. The goal is perceived responsiveness."). States: IDLE (far,
// gentle drift), CURIOUS (portal opened enough to notice — drifts closer,
// looks toward the opening), RETREATING (portal healing/closed — drifts
// back away). No pathfinding, no animation rig — just a lerped target
// position and a "look at" orientation on a simple mesh/group.
export class CreatureReactionSystem {
  constructor(object3d, { restPoint, curiousPoint, noticeThreshold = 0.3, loseInterestThreshold = 0.12 }) {
    this.object = object3d;
    this.restPoint = restPoint.clone();
    this.curiousPoint = curiousPoint.clone();
    this.noticeThreshold = noticeThreshold;
    this.loseInterestThreshold = loseInterestThreshold;
    this.state = 'idle';
    this._t = Math.random() * 100;
    this._targetPos = restPoint.clone();
    this._lookTarget = new THREE.Vector3();
  }

  update(dt, watchedOpenAmount, lookAtWorldPos) {
    this._t += dt;

    if (this.state !== 'curious' && watchedOpenAmount > this.noticeThreshold) {
      this.state = 'curious';
    } else if (this.state === 'curious' && watchedOpenAmount < this.loseInterestThreshold) {
      this.state = 'retreating';
    } else if (this.state === 'retreating' && this.object.position.distanceTo(this.restPoint) < 0.05) {
      this.state = 'idle';
    }

    this._targetPos.copy(this.state === 'curious' ? this.curiousPoint : this.restPoint);

    const bob = Math.sin(this._t * 1.6) * 0.06;
    const sway = Math.cos(this._t * 0.9) * 0.08;
    this.object.position.x = damp(this.object.position.x, this._targetPos.x + sway, 2.2, dt);
    this.object.position.y = damp(this.object.position.y, this._targetPos.y + bob, 2.2, dt);
    this.object.position.z = damp(this.object.position.z, this._targetPos.z, 2.2, dt);

    if (this.state === 'curious' && lookAtWorldPos) {
      this._lookTarget.copy(lookAtWorldPos);
      const dir = this._lookTarget.clone().sub(this.object.position);
      if (dir.lengthSq() > 1e-6) {
        const targetYaw = Math.atan2(dir.x, dir.z);
        const currentYaw = this.object.rotation.y;
        let diff = ((targetYaw - currentYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (diff < -Math.PI) diff += Math.PI * 2;
        this.object.rotation.y = currentYaw + diff * clamp(dt * 3, 0, 1);
      }
    }
  }
}
