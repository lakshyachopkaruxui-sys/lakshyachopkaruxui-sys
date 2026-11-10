import * as THREE from 'three';

type Leg = {
  hip: THREE.Bone; knee: THREE.Bone; hoof: THREE.Bone;
  rest: THREE.Vector3; hoofRotation: THREE.Quaternion; offset: number; bend: number;
  planted: THREE.Vector3; liftOff: THREE.Vector3; wasStance: boolean; initialized: boolean;
};

/** A four-beat walking gait for the existing doe rig, not a slowed gallop.
 * Stance feet stay in forest-local coordinates. Two-bone IK preserves segment
 * lengths and places each hoof on the same surface used by player collisions.
 * No camera movement, model retargeting, or changes to the supplied GLB. */
export class DeerWalk {
  readonly stride = .60;
  readonly legs: Leg[] = [];
  private phase = 0;
  private readonly modelY: number;
  private readonly modelScale: number;
  private readonly neutral: { bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly joint = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly delta = new THREE.Quaternion();
  private readonly actorRotation = new THREE.Quaternion();
  private readonly endRotation = new THREE.Quaternion();

  constructor(private readonly actor: THREE.Group, private readonly model: THREE.Object3D,
    private readonly forest: THREE.Group, private readonly ground: (x: number, z: number) => number) {
    actor.updateWorldMatrix(true, true);
    this.modelY = model.position.y;
    this.modelScale = model.getWorldScale(new THREE.Vector3()).y;
    model.traverse(object => {
      if ((object as THREE.Bone).isBone) this.neutral.push({ bone: object as THREE.Bone,
        position: object.position.clone(), rotation: object.quaternion.clone() });
    });
    const inverse = actor.getWorldQuaternion(new THREE.Quaternion()).invert();
    // Hind-left, front-left, hind-right, front-right: lateral-sequence walk.
    for (const [name, offset, bend] of [
      ['Backleg_L', 0, -1], ['Frontleg_L', .75, 1],
      ['Backleg_R', .5, -1], ['Frontleg_R', .25, 1]
    ] as const) {
      const hip = model.getObjectByName(name) as THREE.Bone;
      const knee = model.getObjectByName(name + '001') as THREE.Bone;
      const hoof = model.getObjectByName(name + '002') as THREE.Bone;
      if (!hip || !knee || !hoof) throw new Error(`Missing doe leg: ${name}`);
      this.legs.push({ hip, knee, hoof, offset, bend,
        rest: actor.worldToLocal(hoof.getWorldPosition(new THREE.Vector3())),
        hoofRotation: inverse.clone().multiply(hoof.getWorldQuaternion(new THREE.Quaternion())),
        planted: new THREE.Vector3(), liftOff: new THREE.Vector3(), wasStance: true, initialized: false });
    }
  }

  update(distance: number, weight: number) {
    // The source idle has almost locked knees. A small walking crouch gives
    // the planted limbs room to extend without sliding or stretching bones.
    this.model.position.y = this.modelY - .045 * weight / this.modelScale;
    if (weight < .001) { this.legs.forEach(leg => { leg.initialized = false; }); return; }
    this.phase = (this.phase + Math.max(0, distance) / this.stride) % 1;
    // Keep the torso stable. Source Run moves the pelvis and shoulders in a
    // bounding gait, which cannot become a walk simply by lowering its speed.
    for (const pose of this.neutral) {
      pose.bone.position.lerp(pose.position, weight);
      pose.bone.quaternion.slerp(pose.rotation, weight);
    }
    this.actor.updateWorldMatrix(true, true);
    this.actor.getWorldQuaternion(this.actorRotation);
    for (const leg of this.legs) {
      const phase = (this.phase + leg.offset) % 1;
      const stance = phase < .68;
      // A planted hoof holds for 68% of the cycle; the remaining interval is
      // a low, smooth swing. With quarter-cycle offsets, support overlaps.
      this.desired.copy(leg.rest);
      this.desired.z += this.stride * .34;
      this.actor.localToWorld(this.desired);
      this.forest.worldToLocal(this.desired);
      this.desired.y = this.ground(this.desired.x, this.desired.z) + leg.rest.y;
      if (!leg.initialized) {
        leg.hoof.getWorldPosition(leg.planted);
        this.forest.worldToLocal(leg.planted);
        leg.planted.y = this.ground(leg.planted.x, leg.planted.z) + leg.rest.y;
        leg.liftOff.copy(leg.planted); leg.initialized = true;
      }
      if (stance && !leg.wasStance) leg.planted.copy(this.desired);
      if (!stance && leg.wasStance) leg.liftOff.copy(leg.planted);
      if (stance) this.target.copy(leg.planted);
      else {
        const t = (phase - .68) / .32;
        this.target.lerpVectors(leg.liftOff, this.desired, t * t * (3 - 2 * t));
        this.target.y += .065 * Math.sin(Math.PI * t) ** 2;
      }
      leg.wasStance = stance;
      this.forest.localToWorld(this.target);
      this.solve(leg, weight);
    }
    this.actor.updateWorldMatrix(true, true);
  }

  private aim(bone: THREE.Bone, child: THREE.Bone, target: THREE.Vector3, weight: number) {
    bone.getWorldPosition(this.a); child.getWorldPosition(this.b);
    this.b.sub(this.a).normalize(); this.c.copy(target).sub(this.a).normalize();
    this.delta.setFromUnitVectors(this.b, this.c);
    bone.getWorldQuaternion(this.rotation).premultiply(this.delta);
    bone.parent!.getWorldQuaternion(this.parentRotation).invert();
    this.rotation.premultiply(this.parentRotation);
    bone.quaternion.slerp(this.rotation, weight);
    bone.updateWorldMatrix(false, true);
  }

  private solve(leg: Leg, weight: number) {
    leg.hip.getWorldPosition(this.a); leg.knee.getWorldPosition(this.b); leg.hoof.getWorldPosition(this.c);
    const upper = this.a.distanceTo(this.b), lower = this.b.distanceTo(this.c);
    this.direction.subVectors(this.target, this.a);
    const length = THREE.MathUtils.clamp(this.direction.length(), Math.abs(upper - lower) + .001, upper + lower - .002);
    this.direction.normalize();
    this.target.copy(this.a).addScaledVector(this.direction, length);
    this.pole.set(0, 0, leg.bend).applyQuaternion(this.actorRotation);
    this.pole.addScaledVector(this.direction, -this.pole.dot(this.direction)).normalize();
    const along = (upper * upper - lower * lower + length * length) / (2 * length);
    const perpendicular = Math.sqrt(Math.max(0, upper * upper - along * along));
    this.joint.copy(this.a).addScaledVector(this.direction, along).addScaledVector(this.pole, perpendicular);
    this.aim(leg.hip, leg.knee, this.joint, weight);
    this.aim(leg.knee, leg.hoof, this.target, weight);
    this.endRotation.copy(this.actorRotation).multiply(leg.hoofRotation);
    leg.hoof.parent!.getWorldQuaternion(this.parentRotation).invert();
    this.endRotation.premultiply(this.parentRotation);
    leg.hoof.quaternion.slerp(this.endRotation, weight);
  }
}

