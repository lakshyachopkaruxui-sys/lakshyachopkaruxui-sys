import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THREE } from './shadow-test-fixture.mjs';

const { HellCelestial, HELL_CELESTIAL_MAPS } = await import('../src/worlds/HellCelestial.ts');
const { applyStencilLayer } = await import('../src/portal/PortalRenderer.ts');

function fixture(t) {
  const pending = [];
  t.mock.method(THREE.TextureLoader.prototype, 'load', (url, onLoad, _progress, onError) => {
    const texture = new THREE.Texture();
    pending.push({ url, texture, onLoad, onError });
    return texture;
  });
  const parent = new THREE.Group();
  const celestial = new HellCelestial(parent);
  const bodies = celestial.root.children.filter(node => node.isMesh);
  t.after(() => {
    const resources = new Set();
    for (const body of bodies) {
      resources.add(body.geometry);
      resources.add(body.material);
      for (const uniform of Object.values(body.material.uniforms)) {
        if (uniform.value?.isTexture) resources.add(uniform.value);
      }
    }
    for (const resource of resources) resource.dispose();
  });
  return { parent, celestial, bodies, pending };
}

function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'download must have a JPEG SOI marker');
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff, 'JPEG segments must begin with a marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'JPEG segment must fit the downloaded bytes');
    if (startOfFrame.has(marker)) {
      assert.equal(bytes[offset + 2], 8, 'browser maps should retain 8-bit JPEG channels');
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), channels: bytes[offset + 7] };
    }
    offset += length;
  }
  assert.fail('JPEG contains no supported dimensions segment');
}

test('downloaded lunar maps retain verified NASA bytes, dimensions and usable provenance', () => {
  const folder = new URL('../public/textures/hell/celestial/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('SOURCE.json', folder), 'utf8'));
  assert.equal(manifest.page, 'https://svs.gsfc.nasa.gov/4720/');
  assert.equal(manifest.licensePage, 'https://svs.gsfc.nasa.gov/help/');
  assert.match(manifest.credit, /Ernie Wright/);
  assert.match(manifest.credit, /LROC/);
  assert.match(manifest.credit, /LOLA/);
  assert.match(manifest.license, /Public domain/i);
  const expected = [
    { file: 'lroc_color_2k.jpg', width: 2048, height: 1024, hash: 'f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170' },
    { file: 'ldem_3_8bit.jpg', width: 1024, height: 512, hash: '6d93f887e7d8bedfe35ab89ba785e5e3ca12381bd092a5e6abe2c707dda8bb98' }
  ];
  assert.equal(manifest.files.length, expected.length);
  let compressedBytes = 0;
  for (const source of expected) {
    const record = manifest.files.find(file => file.file === source.file);
    assert.ok(record, `${source.file} must have a source record`);
    assert.equal(record.url, `https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/${source.file}`);
    const bytes = readFileSync(new URL(source.file, folder));
    const dimensions = jpegDimensions(bytes);
    assert.deepEqual([dimensions.width, dimensions.height], [source.width, source.height]);
    assert.deepEqual(record.dimensions, [source.width, source.height]);
    assert.ok(dimensions.channels === 1 || dimensions.channels === 3, 'no unnecessary alpha channel');
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.hash);
    assert.equal(record.sha256, source.hash);
    compressedBytes += bytes.length;
  }
  assert.ok(compressedBytes < 600 * 1024, 'both downloaded maps should remain under 600 KiB');
});

test('two celestial bodies share two mipmapped maps without light, shadow or transparent-shell cost', async t => {
  const { celestial, bodies, pending } = fixture(t);
  for (const request of pending) request.onLoad(request.texture);
  assert.equal(await celestial.ready, true);
  assert.equal(bodies.length, 2);
  assert.equal(celestial.root.children.length, 2, 'only the two opaque surface meshes are needed');
  assert.equal(bodies[0].material, bodies[1].material, 'both bodies must share one material and its textures');
  const textures = new Set();
  let triangles = 0;
  celestial.root.traverse(node => {
    assert.notEqual(node.isLight, true, 'celestial detail must not create extra lighting passes');
    if (!node.isMesh) return;
    assert.equal(node.castShadow, false);
    assert.equal(node.receiveShadow, false);
    assert.equal(node.material.transparent, false);
    assert.equal(node.material.side, THREE.FrontSide, 'avoid double-sided atmosphere or shell draws');
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    const normals = node.geometry.attributes.normal;
    for (let index = 0; index < normals.count; index++) {
      assert.ok(Math.abs(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index)) - 1) < 1e-6,
        'smooth sphere normals must remain unit length');
    }
    for (const uniform of Object.values(node.material.uniforms)) if (uniform.value?.isTexture) textures.add(uniform.value);
  });
  assert.equal(triangles, 10496, 'smooth silhouettes must stay inside the explicit two-body geometry budget');
  assert.equal(celestial.root.userData.budget.triangles, triangles);
  assert.equal(celestial.root.userData.budget.draws, bodies.length);
  assert.equal(textures.size, 2, 'no duplicate per-body map allocations');
  assert.ok(celestial.root.userData.budget.rgba8MipmappedBytes < 14 * 1024 * 1024);
  const material = bodies[0].material;
  assert.equal(material.uniforms.albedo.value.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.uniforms.relief.value.colorSpace, THREE.NoColorSpace);
  for (const texture of textures) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping, 'longitude wraps at the spherical seam');
    assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping, 'latitude must not repeat over a pole');
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, THREE.LinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.ok(texture.anisotropy <= 2);
  }
});

test('celestial readiness waits for both maps and retains the latest portal layer after loading', async t => {
  const { parent, celestial, bodies, pending } = fixture(t);
  assert.deepEqual(pending.map(request => request.url), [...HELL_CELESTIAL_MAPS]);
  assert.equal(celestial.status, 'loading');
  assert.equal(bodies[0].material.uniforms.mapsReady.value, 0);
  let settled = false;
  celestial.ready.then(() => { settled = true; });
  applyStencilLayer(parent, 1);
  pending[0].onLoad(pending[0].texture);
  await Promise.resolve();
  assert.equal(settled, false, 'a single loaded map cannot declare complete readiness');
  assert.equal(celestial.status, 'loading');
  applyStencilLayer(parent, 2);
  pending[1].onLoad(pending[1].texture);
  assert.equal(await celestial.ready, true);
  assert.equal(celestial.status, 'ready');
  for (const body of bodies) {
    assert.equal(body.material.uniforms.mapsReady.value, 1);
    assert.equal(body.material.stencilRef, 2);
    assert.equal(body.material.stencilFunc, THREE.EqualStencilFunc);
  }
  applyStencilLayer(parent, 0);
  assert.ok(bodies.every(body => body.material.stencilRef === 0), 'outer-world promotion must remain possible');
});

test('either missing celestial map settles to fallback without rejecting entry or losing opaque bodies', async t => {
  for (const failedMap of [0, 1]) {
    await t.test(`missing map ${failedMap}`, async child => {
      const { parent, celestial, bodies, pending } = fixture(child);
      applyStencilLayer(parent, 1);
      pending[failedMap].onError(new Error('Test download unavailable'));
      pending[1 - failedMap].onLoad(pending[1 - failedMap].texture);
      assert.equal(await celestial.ready, false);
      assert.equal(celestial.status, 'fallback');
      assert.equal(bodies.length, 2);
      for (const body of bodies) {
        assert.equal(body.visible, true);
        assert.equal(body.material.uniforms.mapsReady.value, 0);
        assert.equal(body.material.transparent, false);
        assert.equal(body.material.stencilRef, 1);
      }
    });
  }
});

test('both planet light hooks follow the owning key after translation and yaw without following moon rotation', async t => {
  const { parent, celestial, bodies, pending } = fixture(t);
  for (const request of pending) request.onLoad(request.texture);
  await celestial.ready;
  const ancestor = new THREE.Group();
  ancestor.add(parent);
  const light = new THREE.DirectionalLight();
  light.position.set(-14, 24, 7);
  light.target.position.set(0, 0, -8);
  parent.add(light, light.target);
  const expected = new THREE.Vector3(), target = new THREE.Vector3();
  const sunUniform = bodies[0].material.uniforms.sunWorld;
  assert.equal(bodies[1].material.uniforms.sunWorld, sunUniform, 'the two bodies share a light basis');
  const originalVector = sunUniform.value;
  const verify = () => {
    ancestor.updateMatrixWorld(true);
    expected.copy(light.getWorldPosition(new THREE.Vector3())).sub(light.target.getWorldPosition(target)).normalize();
    for (const body of bodies) {
      body.onBeforeRender();
      assert.equal(sunUniform.value, originalVector, 'render hooks update the vector without reallocating it');
      assert.ok(sunUniform.value.distanceTo(expected) < 1e-12, 'celestial phase must share the actual owning key direction');
    }
  };
  verify();
  const beforeTranslation = sunUniform.value.clone();
  parent.position.set(47, 6, -31);
  ancestor.position.set(-120, 9, 200);
  verify();
  assert.ok(sunUniform.value.distanceTo(beforeTranslation) < 1e-12, 'translation cannot tilt a distant light direction');
  parent.rotation.y = .87;
  parent.scale.setScalar(1.7);
  ancestor.rotation.y = -.29;
  verify();
  const afterYaw = sunUniform.value.clone();
  assert.ok(afterYaw.distanceTo(beforeTranslation) > .1, 'owning-world yaw must affect lighting');
  bodies[0].rotation.set(.29, 2.2, -.3);
  bodies[1].rotation.set(-.6, -.4, .8);
  verify();
  assert.ok(sunUniform.value.distanceTo(afterYaw) < 1e-12, 'independent texture/body rotations cannot drag the sun direction');
  parent.rotation.y = -1.16;
  verify();
});
