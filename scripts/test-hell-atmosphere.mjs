import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { HellAtmosphere, HELL_VENTS } = await import('../src/worlds/HellAtmosphere.ts');

test('localized Hell atmosphere stays within three batches and owns one tiny texture', async () => {
  const parent = new THREE.Group(), atmosphere = new HellAtmosphere(parent, () => 0, () => 2);
  await atmosphere.ready;
  assert.equal(atmosphere.status, 'ready');
  let draws = 0, triangles = 0, points = 0;
  const textures = new Set();
  atmosphere.root.traverse(object => {
    assert.equal(object.isLight, undefined, 'atmosphere must not add light or shadow passes');
    if (!object.material) return;
    draws++;
    assert.equal(object.material.stencilRef, 2);
    assert.equal(object.material.stencilFunc, THREE.EqualStencilFunc);
    assert.equal(object.material.depthWrite, false);
    assert.equal(object.castShadow, false);
    assert.equal(object.receiveShadow, false);
    assert.ok(object.material.uniforms.fogColor, 'local effects must use world fog');
    if (object.isMesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.count ?? 1);
    if (object.isPoints) points += object.geometry.attributes.position.count;
    for (const uniform of Object.values(object.material.uniforms)) if (uniform.value?.isTexture) textures.add(uniform.value);
  });
  assert.equal(draws, 3);
  assert.equal(triangles, 192);
  assert.equal(points, 140);
  assert.equal(textures.size, 1);
  const texture = [...textures][0];
  assert.equal(texture.image.width, 64);
  assert.equal(texture.image.height, 64);
  assert.equal(texture.image.data.byteLength, 16384);
  assert.ok(HELL_VENTS.every(([x,z]) => Math.hypot(x,z-2) > 4), 'arrival stays free of ground smoke');
  atmosphere.dispose();
});

test('all vent mouths sit on the actual supplied ground and face upward', () => {
  const heightAt = (x,z) => .11 * Math.sin(x * .4) + .06 * z;
  const parent = new THREE.Group(), atmosphere = new HellAtmosphere(parent, heightAt, () => 1);
  const cracks = atmosphere.root.getObjectByName('Three smouldering vent mouths');
  const positions = cracks.geometry.attributes.position, indices = cracks.geometry.index;
  for (let i = 0; i < positions.count; i++) {
    assert.ok(Math.abs(positions.getY(i) - heightAt(positions.getX(i),positions.getZ(i)) - .012) < 1e-6,
      'fissure must follow terrain rather than a flat floating plane');
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < indices.count; i += 3) {
    a.fromBufferAttribute(positions,indices.getX(i)); b.fromBufferAttribute(positions,indices.getX(i+1));
    c.fromBufferAttribute(positions,indices.getX(i+2));
    assert.ok(b.sub(a).cross(c.sub(a)).y > 0, 'front-side crack triangles face the viewer');
  }
  const wisps = atmosphere.root.getObjectByName('Low drifting vent wisps');
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  for (let i = 0; i < wisps.count; i++) {
    wisps.getMatrixAt(i,matrix); point.setFromMatrixPosition(matrix);
    assert.ok(Math.abs(point.y - heightAt(point.x,point.z) - .025) < 1e-6);
  }
  parent.position.set(50,0,-33); parent.rotation.y = .72; parent.updateMatrixWorld(true);
  assert.ok(wisps.matrixWorld.elements.every(Number.isFinite), 'portal alignment uses the owning root frame');
  atmosphere.dispose();
});

test('walking-time updates change uniforms without reallocating or uploading static buffers', () => {
  const atmosphere = new HellAtmosphere(new THREE.Group(), () => 0, () => 1);
  const buffers = [], materials = [];
  atmosphere.root.traverse(object => {
    if (!object.geometry) return;
    for (const attribute of Object.values(object.geometry.attributes)) buffers.push({ attribute, version: attribute.version });
    if (object.geometry.index) buffers.push({ attribute: object.geometry.index, version: object.geometry.index.version });
    if (object.instanceMatrix) buffers.push({ attribute: object.instanceMatrix, version: object.instanceMatrix.version });
    materials.push(object.material);
  });
  for (let i = 0; i < 1000; i++) atmosphere.update(i / 72);
  for (const { attribute, version } of buffers) assert.equal(attribute.version, version);
  for (const material of materials) assert.equal(material.uniforms.hellTime.value, 999 / 72);
  atmosphere.update(Number.NaN); atmosphere.update(Infinity);
  assert.ok(materials.every(material => Number.isFinite(material.uniforms.hellTime.value)));
  atmosphere.update(-2); assert.ok(materials.every(material => material.uniforms.hellTime.value === 0));
  atmosphere.dispose();
});

test('atmosphere generation is deterministic and disposal releases only its own resources once', () => {
  const parent = new THREE.Group(), first = new HellAtmosphere(parent, () => 0, () => 0);
  const second = new HellAtmosphere(new THREE.Group(), () => 0, () => 0);
  const firstSmoke = first.root.getObjectByName('Low drifting vent wisps');
  const secondSmoke = second.root.getObjectByName('Low drifting vent wisps');
  assert.deepEqual(firstSmoke.instanceMatrix.array,secondSmoke.instanceMatrix.array);
  assert.deepEqual(firstSmoke.material.uniforms.noiseMap.value.image.data,secondSmoke.material.uniforms.noiseMap.value.image.data);
  const disposed = { geometry: 0, material: 0, texture: 0, instance: 0 };
  first.root.traverse(object => {
    object.geometry?.addEventListener('dispose', () => disposed.geometry++);
    object.material?.addEventListener('dispose', () => disposed.material++);
  });
  firstSmoke.addEventListener('dispose', () => disposed.instance++);
  firstSmoke.material.uniforms.noiseMap.value.addEventListener('dispose', () => disposed.texture++);
  first.dispose(); first.dispose();
  assert.equal(first.root.parent,null);
  assert.deepEqual(disposed,{geometry:3,material:3,texture:1,instance:1});
  assert.ok(second.root.children.every(object => object.geometry), 'a separate atmosphere retains its resources');
  second.dispose();
});
