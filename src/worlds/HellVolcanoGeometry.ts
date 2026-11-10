import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { remapHellSpillCoordinates } from './HellSpillCoordinates';
import { createHellMountainProfile } from './HellMountainProfile';
import { hellLavaRouteAngle, hellLavaRouteWidth } from './HellLavaRoute';

export interface HellVolcanoGeometry {
  cone: THREE.BufferGeometry;
  crater: THREE.BufferGeometry;
  spill: THREE.BufferGeometry | null;
  poolHeight: number;
  poolCenter: THREE.Vector3;
  outlet: THREE.Vector3 | null;
  outcrops: { position: THREE.Vector3; normal: THREE.Vector3; height: number; yaw: number }[];
  rim: THREE.Vector3[];
}

/** Static, mutually fitted rock, caldera pool and overflow. No frame-time raycasts. */
export function buildHellVolcanoGeometry(cx: number, cz: number, radius: number,
  height: number, index = 0, withSpill = index === 0,
  floorAt?: (x: number, z: number) => number): HellVolcanoGeometry {
  const rings = withSpill ? 56 : 24, sectors = withSpill ? 128 : 80;
  const flowAngle = hellLavaRouteAngle;
  const { profile, cavityAt, poolCenter, poolHeight } = createHellMountainProfile(
    cx,cz,radius,height,index,withSpill,floorAt,flowAngle);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], cavities: number[] = [];
  const rim: THREE.Vector3[] = [], waterline: THREE.Vector3[] = [];
  const add = (p: THREE.Vector3, u = p.x / 3.2, v = p.z / 3.2, cavity = 0) => {
    positions.push(p.x, p.y, p.z); uvs.push(u, v); cavities.push(cavity);
  };
  const connect = (first: number, next: number) => {
    for (let j = 0; j < sectors; j++) {
      const a = first + j, b = next + j;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };
  const slopeLengths = new Float64Array(sectors + 1);
  const previousRing: THREE.Vector3[] = [];
  const ringStages = Array.from({length:rings+1},(_,row)=>row/rings);
  for (let row = 0; row <= rings; row++) {
    let perimeter = 0;
    let previousPoint: THREE.Vector3 | undefined;
    for (let j = 0; j <= sectors; j++) {
      const t = ringStages[row], a = j / sectors * Math.PI * 2 + (withSpill ? flowAngle(t)-Math.PI/2 : 0);
      const p = profile(t, a);
      if (previousPoint) perimeter += p.distanceTo(previousPoint);
      if (previousRing[j]) slopeLengths[j] += p.distanceTo(previousRing[j]);
      // Surface-distance UVs retain rock grain on steep slopes instead of
      // stretching a top-down projection into vertical stripes.
      add(p, perimeter / 3.2, slopeLengths[j] / 3.2,cavityAt(t,a));
      previousRing[j] = p; previousPoint = p;
      if (row === rings) rim.push(p);
    }
    if (row) connect((row - 1) * (sectors + 1), row * (sectors + 1));
  }
  // Duplicate the rim for a continuous arc-length/height UV chart on the inner wall.
  const wallStart = positions.length / 3;
  let arc = 0;
  for (let row = 0; row < 3; row++) {
    arc = 0;
    for (let j = 0; j <= sectors; j++) {
      if (j) arc += rim[j].distanceTo(rim[j - 1]);
      const p = rim[j].clone();
      if (row) {
        p.x = poolCenter.x + (p.x - poolCenter.x) * (row === 1 ? .82 : .58);
        p.z = poolCenter.z + (p.z - poolCenter.z) * (row === 1 ? .82 : .58);
        p.y = poolHeight - (row === 2 ? .65 : 0);
      }
      if (row === 1) waterline.push(p.clone());
      add(p, arc / 3.2, (p.y - poolHeight) / 3.2,row ? .45 : .15);
    }
    if (row) connect(wallStart + (row - 1) * (sectors + 1), wallStart + row * (sectors + 1));
  }
  const rawCone = makeGeometry(positions, uvs, indices);
  rawCone.setAttribute('mountainCavity',new THREE.Float32BufferAttribute(cavities,1));
  const cone = creaseRockGeometry(rawCone,Math.PI*.24);
  rawCone.dispose();
  // A flat liquid surface shares the rock wall's exact waterline, without a round
  // disc protruding through an irregular rim or a gap into the hollow mountain.
  const cp = [poolCenter.x, poolHeight, poolCenter.z];
  const cu = [(poolCenter.x-cx)/3,(poolCenter.z-cz)/3], ci: number[] = [];
  for (const p of waterline) { cp.push(p.x, poolHeight, p.z); cu.push((p.x - cx) / 3, (p.z - cz) / 3); }
  for (let j = 0; j < sectors; j++) ci.push(0, j + 2, j + 1);
  const crater = makeGeometry(cp, cu, ci);
  const surface = withSpill ? triangleHeightSampler(cone) : null;
  const spill = withSpill ? buildSpill(cone, profile, flowAngle, poolCenter, surface!) : null;
  const outlet = withSpill ? profile(0, flowAngle(0)).add(new THREE.Vector3(0, .045, 0)) : null;
  const outcrops = withSpill ? [[.18,.88,2.4],[.35,.98,3.1],[.58,1.08,2.2],[.74,1.00,2],
    [.24,2.14,3],[.44,2.30,2.4],[.62,2.12,2.7],[.89,2.23,1.9]].map(([t,a,scale],i) => {
    const position = profile(t,a); position.y = surface!.heightAt(position.x,position.z);
    const tangentT = profile(t+.001,a).sub(profile(t-.001,a));
    const tangentA = profile(t,a+.001).sub(profile(t,a-.001));
    const normal = tangentT.cross(tangentA).normalize();
    if(normal.y<0)normal.negate();
    return {position,normal,height:scale,yaw:i%2===0?.18:-.12};
  }) : [];
  return { cone, crater, spill, poolHeight, poolCenter, outlet, outcrops, rim };
}

function makeGeometry(positions: number[], uvs: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function buildSpill(cone: THREE.BufferGeometry, profile: (t: number, angle: number) => THREE.Vector3,
  flowAngle: (t: number) => number, poolCenter: THREE.Vector3, surface: ReturnType<typeof triangleHeightSampler>) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const lifts: number[] = [], joins: number[] = [];
  const rows = 48, across = 2, clearance = .045;
  const centers: {position:THREE.Vector3;t:number}[]=[];
  for(let row=0;row<=rows;row++){
    const inner=row<6,t=inner?1:1-(row-6)/(rows-6),a=flowAngle(t);
    const center=profile(t,a);
    if(inner){
      const scale=THREE.MathUtils.lerp(.82,1,row/6);
      center.x=poolCenter.x+(center.x-poolCenter.x)*scale;
      center.z=poolCenter.z+(center.z-poolCenter.z)*scale;
    }
    const inset=.065*(1-THREE.MathUtils.smoothstep(t,0,.03));
    const inward=Math.hypot(center.x-poolCenter.x,center.z-poolCenter.z);
    center.x-=(center.x-poolCenter.x)/inward*inset;
    center.z-=(center.z-poolCenter.z)/inward*inset;
    const support=surface.heightAt(center.x,center.z);
    if(!Number.isFinite(support))throw new Error('Lava centerline left its supporting mountain');
    center.y=row===0?poolCenter.y:support+clearance*THREE.MathUtils.smoothstep(row,0,5);
    centers.push({position:center,t});
  }
  const radii=centers.map((center,row)=>{
    if(row===0||row===rows)return Infinity;
    const a=centers[row-1].position,b=center.position,c=centers[row+1].position;
    const ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),ac=Math.hypot(c.x-a.x,c.z-a.z);
    const cross=Math.abs((b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x));
    const bendRadius=cross>1e-8?ab*bc*ac/(2*cross):Infinity;
    return bendRadius;
  });
  const widths=centers.map((center,row)=>Math.min(hellLavaRouteWidth(center.t),
    .55*Math.min(radii[Math.max(0,row-1)],radii[row],radii[Math.min(rows,row+1)])));
  let length=0;
  for(let row=0;row<=rows;row++){
    const {position:center,t}=centers[row];
    if(row)length+=center.distanceTo(centers[row-1].position);
    const before=centers[Math.max(0,row-1)].position,after=centers[Math.min(rows,row+1)].position;
    const dx=after.x-before.x,dz=after.z-before.z,distance=Math.hypot(dx,dz);
    const align=1-THREE.MathUtils.smoothstep(t,0,.055);
    const normal=new THREE.Vector2(-dz/distance,dx/distance).lerp(new THREE.Vector2(-1,0),align).normalize();
    const nx=normal.x,nz=normal.y,width=widths[row];
    for(let col=0;col<=across;col++){
      const side=col/across*2-1,x=center.x+nx*width*side,z=center.z+nz*width*side;
      const support=surface.heightAt(x,z);
      if(!Number.isFinite(support))throw new Error('Lava bank left its supporting mountain at '+x+', '+z);
      const lift=clearance*THREE.MathUtils.smoothstep(row,0,5),y=row===0?poolCenter.y:support+lift;
      positions.push(x,y,z);uvs.push(col/across,length/3);
      lifts.push(y-support);joins.push(Math.min(1,row/5));
      if(row<rows&&col<across){const a=row*(across+1)+col,b=a+across+1;indices.push(a,a+1,b,a+1,b+1,b);}
    }
  }
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const up=(positions[b+2]-positions[a+2])*(positions[c]-positions[a])-(positions[b]-positions[a])*(positions[c+2]-positions[a+2]);
    if(up<=0)throw new Error('Lava ribbon folds before fitting at source triangle '+i/3);
  }
  const geometry=conformSpill(cone,positions,uvs,indices,lifts,joins,poolCenter.y,surface.candidates);
  const xs=centers.slice(6).map(center=>center.position.x);
  geometry.userData.authoredLateralSpan=Math.max(...xs)-Math.min(...xs);
  return geometry;
}

/** Keep original vertices and duplicate only genuine hard-normal boundaries.
 * Visible triangle count and draw calls remain unchanged. */
function creaseRockGeometry(source: THREE.BufferGeometry, angle: number) {
  const creased=toCreasedNormals(source,angle), smooth=creased.getAttribute('normal');
  const original=source.getIndex()!, groups: {normal: THREE.Vector3;index:number}[][]=[];
  const names=Object.keys(source.attributes).filter(name=>name!=='normal');
  const arrays=Object.fromEntries(names.map(name=>[name,Array.from(source.getAttribute(name).array)])) as Record<string,number[]>;
  const normals=new Array(source.getAttribute('position').count*3).fill(0), indices:number[]=[];
  const desired=new THREE.Vector3();
  let count=source.getAttribute('position').count;
  for(let corner=0;corner<original.count;corner++){
    const vertex=original.getX(corner);desired.fromBufferAttribute(smooth,corner);
    const options=groups[vertex]??(groups[vertex]=[]);
    let match=options.find(option=>option.normal.distanceToSquared(desired)<1e-10);
    if(!match){
      const target=options.length?count++:vertex;
      match={normal:desired.clone(),index:target};options.push(match);
      if(target!==vertex)for(const name of names){
        const attribute=source.getAttribute(name);
        for(let k=0;k<attribute.itemSize;k++)arrays[name].push(attribute.array[vertex*attribute.itemSize+k]);
      }
      normals[target*3]=desired.x;normals[target*3+1]=desired.y;normals[target*3+2]=desired.z;
    }
    indices.push(match.index);
  }
  const result=new THREE.BufferGeometry();
  for(const name of names)result.setAttribute(name,new THREE.Float32BufferAttribute(arrays[name],source.getAttribute(name).itemSize));
  result.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  result.setIndex(indices);result.computeBoundingSphere();creased.dispose();
  return result;
}

/** Index triangles once so fitting a detailed spill does not perform thousands
 * of full-mesh raycasts during startup. Returns the same upper surface height. */
function triangleHeightSampler(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position'), index = geometry.getIndex()!, step = 2;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const x0 = Math.floor(Math.min(p.getX(a), p.getX(b), p.getX(c)) / step);
    const x1 = Math.floor(Math.max(p.getX(a), p.getX(b), p.getX(c)) / step);
    const z0 = Math.floor(Math.min(p.getZ(a), p.getZ(b), p.getZ(c)) / step);
    const z1 = Math.floor(Math.max(p.getZ(a), p.getZ(b), p.getZ(c)) / step);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = x + ':' + z; if (!cells.has(key)) cells.set(key, []); cells.get(key)!.push(i);
    }
  }
  const heightAt = (x: number, z: number) => {
    let height = -Infinity;
    for (const i of cells.get(Math.floor(x / step) + ':' + Math.floor(z / step)) ?? []) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const ax = p.getX(a), az = p.getZ(a), bx = p.getX(b), bz = p.getZ(b), cx = p.getX(c), cz = p.getZ(c);
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(det) < 1e-10) continue;
      const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) >= -1e-7) height = Math.max(height, wa * p.getY(a) + wb * p.getY(b) + wc * p.getY(c));
    }
    return height;
  };
  const candidates = (x0: number, z0: number, x1: number, z1: number) => {
    const found = new Set<number>();
    for (let x = Math.floor(x0 / step); x <= Math.floor(x1 / step); x++)
      for (let z = Math.floor(z0 / step); z <= Math.floor(z1 / step); z++)
        for (const triangle of cells.get(x + ':' + z) ?? []) found.add(triangle);
    return found;
  };
  return { heightAt, candidates };
}

type FlowPoint = { x: number; z: number; u: number; v: number; lift: number; join: number };

/** Split the ribbon at every supporting rock facet. Each emitted lava triangle
 * now follows one actual rock plane, so rough cliffs cannot cut through it. */
function conformSpill(cone: THREE.BufferGeometry, input: number[], uv: number[], sourceIndices: number[],
  sourceLifts: number[], sourceJoins: number[], poolHeight: number,
  candidates: (x0: number, z0: number, x1: number, z1: number) => Set<number>) {
  const rock = cone.getAttribute('position'), rockIndex = cone.getIndex()!;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [], lifts: number[] = [], joins: number[] = [];
  const mixPoint = (a: FlowPoint, b: FlowPoint, t: number): FlowPoint => ({
    x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t),
    u: THREE.MathUtils.lerp(a.u, b.u, t), v: THREE.MathUtils.lerp(a.v, b.v, t),
    lift: THREE.MathUtils.lerp(a.lift, b.lift, t), join: THREE.MathUtils.lerp(a.join, b.join, t) });
  for (let triangle = 0; triangle < sourceIndices.length; triangle += 3) {
    const flow = sourceIndices.slice(triangle, triangle + 3).map(i => ({ x: input[i * 3], z: input[i * 3 + 2],
      u: uv[i * 2], v: uv[i * 2 + 1], lift: sourceLifts[i], join: sourceJoins[i] }));
    const options = candidates(Math.min(...flow.map(p => p.x)), Math.min(...flow.map(p => p.z)),
      Math.max(...flow.map(p => p.x)), Math.max(...flow.map(p => p.z)));
    for (const offset of options) {
      const corners = [0, 1, 2].map(k => rockIndex.getX(offset + k));
      const a = corners[0], b = corners[1], c = corners[2];
      const ax = rock.getX(a), az = rock.getZ(a), bx = rock.getX(b), bz = rock.getZ(b), cx = rock.getX(c), cz = rock.getZ(c);
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-10) continue;
      const orientation = Math.sign((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      let polygon = flow;
      for (let edge = 0; edge < 3 && polygon.length; edge++) {
        const start = corners[edge], end = corners[(edge + 1) % 3];
        const x = rock.getX(start), z = rock.getZ(start), dx = rock.getX(end) - x, dz = rock.getZ(end) - z;
        const signed = (p: FlowPoint) => orientation * (dx * (p.z - z) - dz * (p.x - x));
        const clipped: FlowPoint[] = [];
        let previous = polygon[polygon.length - 1], previousDistance = signed(previous);
        for (const point of polygon) {
          const distance = signed(point), before = previousDistance >= -1e-8, inside = distance >= -1e-8;
          if (before !== inside) clipped.push(mixPoint(previous, point, previousDistance / (previousDistance - distance)));
          if (inside) clipped.push(point);
          previous = point; previousDistance = distance;
        }
        polygon = clipped;
      }
      if (polygon.length < 3) continue;
      const first = positions.length / 3;
      for (const point of polygon) {
        const wa = ((bz - cz) * (point.x - cx) + (cx - bx) * (point.z - cz)) / det;
        const wb = ((cz - az) * (point.x - cx) + (ax - cx) * (point.z - cz)) / det;
        const y = wa * rock.getY(a) + wb * rock.getY(b) + (1 - wa - wb) * rock.getY(c);
        const lift = point.join < 1e-8 ? poolHeight - y : point.lift;
        positions.push(point.x, y + lift, point.z); uvs.push(point.u, point.v); lifts.push(lift); joins.push(point.join);
      }
      for (let i = 1; i + 1 < polygon.length; i++) {
        const p = polygon[0], q = polygon[i], r = polygon[i + 1];
        if (Math.abs((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x)) > 1e-9)
          indices.push(first, first + i, first + i + 1);
      }
    }
  }
  // Clipping can produce microscopic slivers which collapse after Float32
  // conversion. Filter in the actual upload precision and compact unused data.
  const uploaded = Float32Array.from(positions), valid: number[] = [], used = new Set<number>();
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const abx=uploaded[b*3]-uploaded[a*3],abz=uploaded[b*3+2]-uploaded[a*3+2];
    const acx=uploaded[c*3]-uploaded[a*3],acz=uploaded[c*3+2]-uploaded[a*3+2];
    const bcx=uploaded[c*3]-uploaded[b*3],bcz=uploaded[c*3+2]-uploaded[b*3+2];
    const up=abz*acx-abx*acz;
    const longest=Math.sqrt(Math.max(abx*abx+abz*abz,acx*acx+acz*acz,bcx*bcx+bcz*bcz));
    if(Math.abs(up)<1e-7||Math.abs(up)/longest<.00015)continue;
    valid.push(a,up>0?b:c,up>0?c:b);used.add(a);used.add(b);used.add(c);
  }
  const remap=new Map<number,number>(),compact:number[]=[],compactUv:number[]=[],compactLifts:number[]=[],compactJoins:number[]=[];
  for(const old of used){
    remap.set(old,compact.length/3);compact.push(uploaded[old*3],uploaded[old*3+1],uploaded[old*3+2]);
    compactUv.push(uvs[old*2],uvs[old*2+1]);compactLifts.push(lifts[old]);compactJoins.push(joins[old]);
  }
  const geometry = makeGeometry(compact, compactUv, valid.map(i=>remap.get(i)!));
  geometry.setAttribute('lavaLift', new THREE.Float32BufferAttribute(compactLifts, 1));
  geometry.setAttribute('flowJoin', new THREE.Float32BufferAttribute(compactJoins, 1));
  geometry.userData.conforming = true; geometry.userData.clearance = .045;
  remapHellSpillCoordinates(geometry);
  return geometry;
}
