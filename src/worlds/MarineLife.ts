import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { fitProp, measureProp } from './props';
import { fallbackLargeFish, fallbackRay, reefFishGeometry, type ReefFishKind } from './proceduralMarine';

type Species = 'whale' | 'shark' | 'ray' | 'turtle' | 'barramundi';
type Orbit = { x: number; y: number; z: number; rx: number; rz: number; rise: number; period: number; phase: number; reverse?: boolean };
type Hero = { group: THREE.Group; model: THREE.Group; mixer?: THREE.AnimationMixer; orbit: Orbit; species: Species; source: 'asset' | 'original'; length: number; fins: THREE.Object3D[]; tail?: THREE.Object3D };
type Shoal = { mesh: THREE.InstancedMesh; kind: ReefFishKind; orbit: Orbit; members: { phase: number; across: number; rise: number; length: number; sway: number }[] };
type AssetSpec = { path: string; yaw: number; clip?: RegExp };

/** Every URL is a bundled, documented asset: nothing is fetched from an asset
 * marketplace at runtime. Forward-axis corrections are applied before fitting. */
export const MARINE_MODELS: Record<Exclude<Species, 'turtle'>, AssetSpec> = {
  whale: { path: '/models/marine/Whale.glb', yaw: 0, clip: /swim|idle/i },
  shark: { path: '/models/marine/Shark.glb', yaw: 0, clip: /swim|idle/i },
  ray: { path: '/models/marine/MantaRay.glb', yaw: 0, clip: /swim|idle/i },
  barramundi: { path: '/models/marine/BarramundiFish.glb', yaw: 0 }
};

/** Calm marine traffic in local world coordinates. The scene owns lighting,
 * terrain and the water; this component owns finite, repeatable swim paths.
 * No interaction with the headset pose, camera, gravity or user locomotion. */
export class MarineLife {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private heroes: Hero[] = [];
  private shoals: Shoal[] = [];
  private clock = { value: 0 };
  private lastTime = 0;
  private pose = new THREE.Object3D();
  private tangent = new THREE.Vector3();
  private position = new THREE.Vector3();
  private rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private failures: string[] = [];

  constructor(private parent: THREE.Group, private stencilLayer: () => number) {
    this.group.name = 'underwater-marine-life';
    this.addShoal('silver', 46, { x: -0.3, y: 7.55, z: -11, rx: 8.8, rz: 6.4, rise: 0.55, period: 55, phase: 0.12 });
    this.addShoal('tang', 32, { x: 0, y: 8.8, z: -17, rx: 13.3, rz: 8.1, rise: 0.6, period: 69, phase: 0.58, reverse: true });
    this.addShoal('banner', 24, { x: -0.2, y: 6.3, z: -14, rx: 5.1, rz: 7.2, rise: 0.35, period: 76, phase: 0.80 });
    this.update(0, 0);
    applyStencilLayer(this.group, this.stencilLayer());
    this.parent.add(this.group);
    this.ready = this.loadHeroes();
  }

  get whaleGroup(): THREE.Group | undefined {
    return this.heroes.find((hero) => hero.species === 'whale')?.group;
  }

  get swimState() {
    return {
      failedAssets: [...this.failures],
      heroes: this.heroes.map(({ group, species, source, length, mixer }) => ({
        species, source, length, position: group.position.clone(), rotation: group.quaternion.clone(), animationTime: mixer?.time ?? 0
      })),
      schools: this.shoals.map(({ kind, members, mesh }) => ({ kind, count: members.length, trianglesPerFish: mesh.geometry.index!.count / 3 }))
    };
  }

  private addShoal(kind: ReefFishKind, count: number, orbit: Orbit) {
    const geometry = reefFishGeometry(kind);
    const phases = new Float32Array(count);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.39, metalness: 0.09, side: THREE.DoubleSide });
    material.name = `Reef ${kind} · smooth fins and living tail`;
    applySwim(material, this.clock, true);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `${kind}-reef-school`;
    // The whole school moves. A fixed, conservative volume avoids stale
    // instanced bounds and expensive recomputation on a standalone headset.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(orbit.x, orbit.y, orbit.z), Math.max(orbit.rx, orbit.rz) + 5);
    const members: Shoal['members'] = [];
    for (let i = 0; i < count; i++) {
      const a = random(i * 13 + count), b = random(i * 23 + 17);
      phases[i] = random(i * 19 + 93) * Math.PI * 2;
      const length = (kind === 'silver' ? 0.53 : kind === 'tang' ? 0.46 : 0.41) * (0.81 + random(i * 29 + 53) * 0.38);
      let member: Shoal['members'][number] | undefined;
      for (let attempt = 0; attempt < 512; attempt++) {
        const seed = i * 109 + attempt * 197 + count;
        const candidate = { phase: (random(seed + 1) - 0.5) * (attempt > 255 ? 0.18 : 0.14),
          across: (random(seed + 11) - 0.5) * 2.7, rise: (random(seed + 37) - 0.5) * 1.5, length, sway: phases[i] };
        if (clearSchoolPosition(candidate, members, orbit)) { member = candidate; break; }
      }
      // This deterministic layout has room for every intended fish; an explicit
      // failure is safer than silently introducing interpenetrating bodies.
      if (!member) throw new Error(`No clear position for ${kind} shoal member ${i}`);
      members.push(member);
      mesh.setColorAt(i, new THREE.Color().setRGB(0.86 + a * 0.14, 0.91 + b * 0.09, 0.94 + a * 0.06));
    }
    geometry.setAttribute('aSwimPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shoals.push({ mesh, kind, orbit, members });
    this.group.add(mesh);
  }

  private async loadHeroes() {
    const loader = new GLTFLoader();
    const assets = new Map<Species, Promise<GLTF | null>>();
    for (const species of Object.keys(MARINE_MODELS) as (keyof typeof MARINE_MODELS)[]) {
      const spec = MARINE_MODELS[species];
      assets.set(species, loader.loadAsync(spec.path).catch(error => {
        this.failures.push(spec.path);
        console.warn(`MarineLife: ${species} asset unavailable; using original marine geometry.`, error);
        return null;
      }));
    }
    const definitions: { species: Species; length: number; orbit: Orbit }[] = [
      { species: 'whale', length: 10.5, orbit: { x: 0, y: 15.5, z: -18, rx: 22, rz: 17, rise: 0.9, period: 162, phase: 0.26 } },
      { species: 'shark', length: 3.7, orbit: { x: 0, y: 9.3, z: -14, rx: 13, rz: 9.5, rise: 0.55, period: 96, phase: 0.72 } },
      { species: 'shark', length: 2.9, orbit: { x: 1, y: 10.6, z: -20, rx: 17, rz: 11, rise: 0.7, period: 113, phase: 0.16, reverse: true } },
      { species: 'ray', length: 3.9, orbit: { x: 0, y: 7.5, z: -13, rx: 8, rz: 7.2, rise: 0.5, period: 93, phase: 0.39 } },
      { species: 'ray', length: 2.9, orbit: { x: -1, y: 9.2, z: -21, rx: 13, rz: 9, rise: 0.5, period: 107, phase: 0.59 } },
      { species: 'turtle', length: 1.2, orbit: { x: 0, y: 5.7, z: -13, rx: 4.9, rz: 6.2, rise: 0.28, period: 122, phase: 0.86 } },
      { species: 'turtle', length: 0.94, orbit: { x: 1, y: 6.5, z: -17, rx: 6, rz: 7, rise: 0.32, period: 135, phase: 0.43, reverse: true } }
    ];
    for (let i = 0; i < 5; i++) definitions.push({ species: 'barramundi', length: 0.83 + i * 0.05,
      orbit: { x: 0, y: 5.5 + i * 0.12, z: -11, rx: 4.4 + i * 0.1, rz: 5.5, rise: 0.25, period: 66, phase: 0.35 + i * 0.077 } });
    // Each species can arrive independently. Apply the CURRENT stencil before
    // attachment, even if the user crossed the portal while a GLB was loading.
    await Promise.all(definitions.map(async (definition, index) => {
      const asset = definition.species === 'turtle' ? null : await assets.get(definition.species)!;
      this.addHero(definition.species, definition.length, definition.orbit, asset, index);
    }));
    this.update(this.lastTime, 0);
  }

  private addHero(species: Species, length: number, orbit: Orbit, asset: GLTF | null, index: number) {
    const spec = species === 'turtle' ? undefined : MARINE_MODELS[species];
    const model = asset ? species === 'barramundi' ? canonicalStaticFish(asset.scene) : cloneSkeleton(asset.scene) as THREE.Group : species === 'ray' ? fallbackRay() : species === 'barramundi' ?
      new THREE.Group().add(new THREE.Mesh(reefFishGeometry('silver'), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide }))) : fallbackLargeFish(species);
    model.name = `${species}-${index + 1}-model`;
    if (asset && spec) model.rotation.y += spec.yaw;
    let mixer: THREE.AnimationMixer | undefined;
    if (asset && spec?.clip) {
      const clip = asset.animations.find(animation => spec.clip!.test(animation.name));
      if (clip) {
        mixer = new THREE.AnimationMixer(model);
        // Root translation is path-owned. Preserve real bone animation while
        // stripping scene-level locomotion so no asset drifts off its route.
        const tracks = clip.tracks.filter(track => !/^(?:root|scene|armature)\.(?:position|quaternion)$/i.test(track.name));
        mixer.clipAction(new THREE.AnimationClip(clip.name, clip.duration, tracks)).play();
        mixer.update(0);
      }
    }
    fitProp(model, length);
    model.position.sub(measureProp(model).getCenter(new THREE.Vector3()));
    model.updateMatrixWorld(true);
    if (mixer) { mixer.setTime(index * 0.37); mixer.timeScale = species === 'whale' ? 0.72 : 0.88 + index * 0.027; }
    model.traverse(object => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      const style = (source: THREE.Material) => {
        const material = source.clone() as THREE.MeshStandardMaterial;
        if (material.roughness !== undefined) material.roughness = THREE.MathUtils.clamp(material.roughness, 0.35, 0.73);
        if (material.metalness !== undefined) material.metalness = Math.min(material.metalness, 0.12);
        if (material.emissive && material.map) { material.emissive.set(0x24424b); material.emissiveMap = material.map; material.emissiveIntensity = 0.065; }
        if (species === 'barramundi') applySwim(material, this.clock, false);
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(style) : style(mesh.material);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
    });
    const group = new THREE.Group(); group.name = `${species}-${index + 1}`; group.add(model);
    const hero: Hero = { group, model, mixer, orbit, species, source: asset ? 'asset' : 'original', length,
      fins: [model.getObjectByName('marine-left-fin'), model.getObjectByName('marine-right-fin')].filter((fin): fin is THREE.Object3D => !!fin), tail: model.getObjectByName('marine-tail') };
    this.heroes.push(hero);
    this.placeHero(hero, this.lastTime, 0);
    applyStencilLayer(group, this.stencilLayer());
    this.group.add(group);
  }

  update(time: number, dt: number) {
    if (!Number.isFinite(time)) return;
    this.lastTime = time;
    this.clock.value = time;
    const safeDt = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    for (const shoal of this.shoals) {
      shoal.members.forEach((member, index) => {
        const phase = orbitPose(shoal.orbit, time, member.phase, this.position, this.tangent);
        this.position.x += Math.cos(phase) * member.across;
        this.position.z += Math.sin(phase) * member.across;
        this.position.y += member.rise + Math.sin(time * 0.6 + member.sway) * 0.09;
        this.pose.position.copy(this.position);
        this.rotation.set(-Math.asin(this.tangent.y), Math.atan2(this.tangent.x, this.tangent.z), Math.sin(phase) * 0.055);
        this.pose.quaternion.setFromEuler(this.rotation);
        this.pose.scale.setScalar(member.length);
        this.pose.updateMatrix();
        shoal.mesh.setMatrixAt(index, this.pose.matrix);
      });
      shoal.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const hero of this.heroes) this.placeHero(hero, time, safeDt);
  }

  private placeHero(hero: Hero, time: number, dt: number) {
    const phase = orbitPose(hero.orbit, time, 0, hero.group.position, this.tangent);
    this.rotation.set(-Math.asin(this.tangent.y), Math.atan2(this.tangent.x, this.tangent.z), Math.cos(phase) * (hero.species === 'ray' ? 0.065 : 0.025));
    hero.group.quaternion.setFromEuler(this.rotation);
    hero.mixer?.update(dt);
    hero.fins.forEach((fin, i) => fin.rotation.z = Math.sin(time * (hero.species === 'ray' ? 1.1 : 1.5) + hero.orbit.phase * 6) * (i === 0 ? 1 : -1) * 0.22);
    if (hero.tail) {
      const value = Math.sin(time * 1.9 + hero.orbit.phase * 6) * 0.19;
      if (hero.species === 'whale') hero.tail.rotation.x = value; else hero.tail.rotation.y = value;
    }
  }
}

/** Analytic closed orbit: position AND tangent are continuous at the seam. */
function orbitPose(orbit: Orbit, time: number, offset: number, position: THREE.Vector3, tangent: THREE.Vector3) {
  const direction = orbit.reverse ? -1 : 1;
  const phase = (time / orbit.period * direction + orbit.phase + offset) * Math.PI * 2;
  position.set(orbit.x + Math.cos(phase) * orbit.rx, orbit.y + Math.sin(phase * 2) * orbit.rise, orbit.z + Math.sin(phase) * orbit.rz);
  tangent.set(-Math.sin(phase) * orbit.rx * direction, Math.cos(phase * 2) * orbit.rise * 2 * direction, Math.cos(phase) * orbit.rz * direction).normalize();
  return phase;
}

/** Smooth tail deformation on instanced fish. Its derivative also bends the
 * normal, keeping specular light attached to the moving tail. */
function applySwim(material: THREE.MeshStandardMaterial, clock: THREE.IUniform, instanced: boolean) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uMarineTime = clock;
    const declarations = `uniform float uMarineTime;\n${instanced ? 'attribute float aSwimPhase;' : ''}\n`;
    shader.vertexShader = declarations + shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      float swimPhase = ${instanced ? 'aSwimPhase' : '0.0'};
      float tailWeight = clamp(-position.z / 0.58, 0.0, 1.0);
      float tailAngle = uMarineTime * 6.4 + swimPhase + position.z * 7.0;
      float tailSlope = 0.075 * (cos(tailAngle) * 7.0 * tailWeight * tailWeight - sin(tailAngle) * 2.0 * tailWeight / 0.58);
      objectNormal.z -= tailSlope * objectNormal.x;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.x += sin(tailAngle) * 0.075 * tailWeight * tailWeight;`);
  };
  material.customProgramCacheKey = () => `marine-tail-v1-${instanced}`;
}

function random(seed: number) { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }

function clearSchoolPosition(candidate: Shoal['members'][number], members: Shoal['members'], orbit: Orbit) {
  for (const other of members) {
    const clearance = (candidate.length + other.length) * 0.63;
    for (let sample = 0; sample < 32; sample++) {
      const phase = sample / 32 * Math.PI * 2;
      const a = phase + candidate.phase * Math.PI * 2, b = phase + other.phase * Math.PI * 2;
      const dx = Math.cos(a) * (orbit.rx + candidate.across) - Math.cos(b) * (orbit.rx + other.across);
      const dz = Math.sin(a) * (orbit.rz + candidate.across) - Math.sin(b) * (orbit.rz + other.across);
      const rawY = Math.sin(a * 2) * orbit.rise + candidate.rise - Math.sin(b * 2) * orbit.rise - other.rise;
      // Two independent breathing motions can shrink vertical separation by
      // at most 0.18 m. Reserve that space before the experience starts.
      const dy = Math.max(0, Math.abs(rawY) - 0.18);
      if (dx * dx + dy * dy + dz * dz < clearance * clearance) return false;
    }
  }
  return true;
}

/** Bake a static source's authoring transforms into canonical unit geometry.
 * The Barramundi node's 180° Y rotation already faces its nose along +Z.
 * Its texture, UVs and smooth normals survive this transform; tail motion then
 * uses the same local coordinates as our authored shoals. */
function canonicalStaticFish(source: THREE.Group) {
  source.updateMatrixWorld(true);
  const box = measureProp(source), centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const normalise = new THREE.Matrix4().makeScale(1 / size.z, 1 / size.z, 1 / size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  const model = new THREE.Group();
  source.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalise, mesh.matrixWorld));
    model.add(new THREE.Mesh(geometry, mesh.material));
  });
  return model;
}
