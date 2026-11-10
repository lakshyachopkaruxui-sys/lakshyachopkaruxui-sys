// Area-weight only the NORMAL buffer; every geometry coordinate, index and UV byte stays intact.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const file=new URL('../public/models/shadow/boulder_01/boulder-webxr.glb',import.meta.url),bytes=readFileSync(file);
const backup=new URL('../validation/horror-rebuild/boulder-before-normal-fix.glb',import.meta.url);
if(!existsSync(backup))writeFileSync(backup,bytes);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),binaryOffset=28+bytes.readUInt32LE(12);
const hash=b=>createHash('sha256').update(b).digest('hex');
const accessor=i=>{const a=json.accessors[i],v=json.bufferViews[a.bufferView];return{a,v,start:binaryOffset+(v.byteOffset??0)+(a.byteOffset??0),stride:v.byteStride??(a.type==='VEC3'?12:a.type==='VEC2'?8:a.componentType===5123?2:4)}};
const report={method:'Area-weighted face normals joined by coincident position across UV seams. NORMAL bytes only.',primitives:[]};
for(const mesh of json.meshes)for(const primitive of mesh.primitives){
 const p=accessor(primitive.attributes.POSITION),n=accessor(primitive.attributes.NORMAL),uv=accessor(primitive.attributes.TEXCOORD_0),index=accessor(primitive.indices);
 if(p.a.componentType!==5126||n.a.componentType!==5126)throw new Error('Expected float32');
 const positions=[],keys=[],sums=new Map(),beforeNormals=[],seams=new Map();
 for(let i=0;i<p.a.count;i++){const at=p.start+i*p.stride,v=[0,4,8].map(o=>bytes.readFloatLE(at+o));positions.push(v);const key=v.map(x=>Math.round(x*1e5)).join(',');keys.push(key);if(!sums.has(key))sums.set(key,[0,0,0]);const nn=[0,4,8].map(o=>bytes.readFloatLE(n.start+i*n.stride+o));beforeNormals.push(nn);if(!seams.has(key))seams.set(key,[]);seams.get(key).push(nn);}
 const getIndex=i=>index.a.componentType===5123?bytes.readUInt16LE(index.start+i*index.stride):bytes.readUInt32LE(index.start+i*index.stride);
 for(let i=0;i<index.a.count;i+=3){const ids=[getIndex(i),getIndex(i+1),getIndex(i+2)],a=positions[ids[0]],b=positions[ids[1]],c=positions[ids[2]],u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]);const face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const id of ids){const sum=sums.get(keys[id]);for(let k=0;k<3;k++)sum[k]+=face[k];}}
 let maximumChange=0,changed=0,seamsOver30deg=0;
 for(const group of seams.values())if(group.some(n=>n.reduce((s,x,k)=>s+x*group[0][k],0)<Math.cos(Math.PI/6)))seamsOver30deg++;
 const unchanged=[p,uv,index].map(a=>hash(bytes.subarray(a.start,a.start+a.v.byteLength-(a.a.byteOffset??0))));
 for(let i=0;i<n.a.count;i++){const sum=sums.get(keys[i]),length=Math.hypot(...sum);if(length<1e-10)continue;const normal=sum.map(x=>x/length),dot=normal.reduce((s,x,k)=>s+x*beforeNormals[i][k],0),angle=Math.acos(Math.max(-1,Math.min(1,dot)));maximumChange=Math.max(maximumChange,angle);if(angle>.01)changed++;normal.forEach((x,k)=>bytes.writeFloatLE(x,n.start+i*n.stride+k*4));}
 const after=[p,uv,index].map(a=>hash(bytes.subarray(a.start,a.start+a.v.byteLength-(a.a.byteOffset??0))));
 if(JSON.stringify(unchanged)!==JSON.stringify(after))throw new Error('Non-normal attribute changed');
 report.primitives.push({vertices:p.a.count,triangles:index.a.count/3,uniquePositions:sums.size,seamsWithNormalJumpOver30degBefore:seamsOver30deg,changedNormalsOverPoint01Radians:changed,maxNormalChangeDegrees:maximumChange*180/Math.PI,positionUvIndexHashes:after});
}
writeFileSync(file,bytes);report.outputSha256=hash(bytes);writeFileSync(new URL('../validation/horror-rebuild/boulder-normal-repair.json',import.meta.url),JSON.stringify(report,null,2));
const manifestFile=new URL('../public/models/shadow/boulder_01/SOURCE-MANIFEST.json',import.meta.url),manifest=JSON.parse(readFileSync(manifestFile));manifest.runtime.sha256=report.outputSha256;manifest.runtime.normalRepair=report;writeFileSync(manifestFile,JSON.stringify(manifest,null,2));console.log(JSON.stringify(report));
