import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { createHellLavaMaterial } = await import('../src/worlds/HellLavaMaterial.ts');

const textures = () => ({ color: new THREE.Texture(), normal: new THREE.Texture(), emission: new THREE.Texture() });
function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('lava keeps caller-owned maps and one shared time uniform without allocating textures or extra passes', () => {
  const maps = textures(), time = { value: 0 }, material = createHellLavaMaterial(time, maps);
  assert.equal(material.map, maps.color); assert.equal(material.normalMap, maps.normal); assert.equal(material.emissiveMap, maps.emission);
  assert.equal(material.transparent, false); assert.equal(material.depthWrite, true); assert.equal(material.metalness, 0);
  assert.equal(material.roughness, .94); assert.equal(material.emissiveIntensity, 1.25);
  const shader = compile(material);
  assert.equal(shader.uniforms.hellTime, time);
  const versions = Object.values(maps).map(texture => texture.version);
  for (let i = 0; i < 1000; i++) time.value = i / 72;
  assert.equal(shader.uniforms.hellTime.value, 999 / 72);
  assert.deepEqual(Object.values(maps).map(texture => texture.version), versions);
});

test('color, normal basis, normal samples and emission use a single advected coordinate while banks remain fixed', () => {
  const shader = compile(createHellLavaMaterial({ value: 12 }, textures()));
  for (const sampler of ['map', 'normalMap', 'emissiveMap']) {
    assert.ok(shader.fragmentShader.includes(`texture2D( ${sampler}, hellFlowUv )`), sampler);
  }
  assert.match(shader.fragmentShader,/getTangentFrame\(\s*-\s*vViewPosition,\s*normal,[\s\S]*?#if defined\( USE_NORMALMAP \)\s*hellFlowUv/);
  assert.equal((shader.fragmentShader.match(/vec2 hellFlowUv=/g) ?? []).length, 1);
  assert.ok(shader.fragmentShader.includes('float hellEdge=min(vHellLavaUv.x,1.-vHellLavaUv.x)'));
  assert.ok(shader.fragmentShader.includes('float hellBank=smoothstep(hellBankCut+.008,hellBankCut+.12,hellEdge)'));
  assert.ok(shader.fragmentShader.includes('hellFlowUv.y-=hellTravel'));
  assert.ok(shader.fragmentShader.includes('float hellTravel=mod(hellTime*.025*hellAdvect,1024.);'));
  assert.ok(!shader.fragmentShader.includes('totalEmissiveRadiance *= emissiveColor.rgb;'), 'do not brighten the whole source orange map');
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance*=hellHeat*hellMolten*hellSourceRadiance'));
  assert.ok(shader.fragmentShader.includes('hellSourceRadiance=pow(smoothstep(.035,.78,hellTextureHeat),1.15)'),
    'fine source temperature must control radiance, not just hue');
  assert.ok(shader.fragmentShader.includes('float roughnessFactor=mix(.96,.72,hellMolten)'), 'hot lava retains a rough folded surface');
  for (const chunk of ['map_fragment', 'normal_fragment_begin', 'normal_fragment_maps', 'emissivemap_fragment']) {
    assert.ok(!shader.fragmentShader.includes(`#include <${chunk}>`), `patch only expanded installed ${chunk}`);
  }
});

test('channel and slope boundaries stay stationary and retain the four-evaluation shader budget', () => {
  for (const mode of ['channel', 'slope']) {
    const shader = compile(createHellLavaMaterial({ value: 24 }, textures(), mode));
    const boundary = shader.fragmentShader.match(/float hellBankNoise=([^;]+);/)?.[1];
    assert.ok(boundary); assert.ok(boundary.includes('vHellLavaUv'));
    assert.ok(!/hellTime|hellFlowUv/.test(boundary), 'the edge must not advect or crawl with the molten interior');
    assert.ok(shader.fragmentShader.includes('float hellBankCut=.024+.066*hellBankNoise;'));
    assert.ok(shader.fragmentShader.includes('float hellAdvect=smoothstep(hellBankCut+.05,hellBankCut+.22,hellEdge);'));
    assert.ok(shader.fragmentShader.indexOf('if(hellEdge<hellBankCut)discard;') > shader.fragmentShader.indexOf('vec3 mapN'),
      'discard follows normal derivative evaluation');
    assert.equal((shader.fragmentShader.match(/hellLavaNoise\(/g) ?? []).length, 5, 'four evaluations plus one function declaration');
  }
  for (const mode of ['crater', 'fissure']) {
    const other = compile(createHellLavaMaterial({ value: 24 }, textures(), mode));
    assert.ok(!other.fragmentShader.includes('hellBankCut'), `${mode} cannot use channel shoreline assumptions`);
    assert.equal((other.fragmentShader.match(/hellLavaNoise\(/g) ?? []).length, 4);
  }
});

test('slope exposes broken molten rafts across its bed, rivers can divide and rejoin, and moving coordinates stay bounded', () => {
  const slope = compile(createHellLavaMaterial({ value: 24 }, textures(), 'slope'));
  const channel = compile(createHellLavaMaterial({ value: 24 }, textures(), 'channel'));
  assert.ok(slope.fragmentShader.includes('float hellTravel=mod(hellTime*.055*hellAdvect,1024.);'));
  const molten=slope.fragmentShader.match(/float hellMolten=([^;]+);/)?.[1];
  assert.ok(molten?.includes('hellFracture')&&molten.includes('hellRaftMask')&&molten.includes('hellBank'));
  assert.ok(!molten.includes('hellRun'),'a fixed central stripe cannot define the mountain flow');
  assert.ok(channel.fragmentShader.includes('max(hellRun,hellSideRun*.8)'));
  for (const shader of [slope, channel]) {
    assert.ok(!shader.fragmentShader.includes('abs(hellPlate-'), 'isovalue rings cannot replace directional mass flow');
    assert.ok(shader.fragmentShader.includes('p=mod(p,64.);'), 'noise repeats when advected coordinates wrap');
    assert.ok(shader.fragmentShader.includes('hellRaftMask=smoothstep(.50,.75,hellRaft)'));
    assert.ok(shader.fragmentShader.includes('hellSourceRadiance'), 'retain source texture temperature and small clinker detail');
  }
});

test('crater skips river bank assumptions, fissures retain a thin hot interior, and cache keys cannot alias modes', () => {
  const keys = new Set();
  for (const mode of ['channel', 'slope', 'crater', 'fissure']) {
    const material = createHellLavaMaterial({ value: 0 }, textures(), mode), shader = compile(material);
    keys.add(material.customProgramCacheKey()); assert.equal(material.userData.lavaMode, mode);
    if (mode === 'crater') assert.ok(shader.fragmentShader.includes('float hellBank=1.;'));
    if (mode === 'fissure') assert.ok(shader.fragmentShader.includes('float hellMolten=(.75+.25*hellFracture)*hellBank;'));
    assert.ok(shader.fragmentShader.includes('#include <fog_fragment>'));
    assert.ok(shader.fragmentShader.includes('#include <tonemapping_fragment>'));
    assert.ok(shader.fragmentShader.includes('#include <colorspace_fragment>'));
    assert.equal(material.stencilWrite, false, 'portal owner applies the current layer after construction');
  }
  assert.equal(keys.size, 4);
});
