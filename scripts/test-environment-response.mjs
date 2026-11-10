// Local numerical/material checks. GPU compilation, stereo and participant
// comfort still require the browser/headset checks in the handoff.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' })
    };
    return nextLoad(url, context);
  }
});
const { EnvironmentalPresence, applyPlantPresence } = await import('../src/worlds/EnvironmentalPresence.ts');
const { applyWind } = await import('../src/worlds/props.ts');

test('presence activates smoothly, ignores invalid coordinates and decays fully after leaving the world', () => {
  const field = new EnvironmentalPresence();
  const viewer = new THREE.Vector3(24, 1.7, -12);
  assert.equal(field.weight(viewer, 3), 0);
  for (let i = 0; i < 120; i++) field.update(viewer, true, 1 / 60);
  assert.ok(field.strength.value > .999);
  assert.ok(field.position.value.equals(viewer));
  viewer.x = 100;
  assert.equal(field.position.value.x, 24, 'input vectors must not be retained by reference');
  field.update(new THREE.Vector3(NaN, 1, Infinity), true, .05);
  assert.ok(field.position.value.toArray().every(Number.isFinite));
  assert.ok(field.strength.value < .8, 'invalid tracking fades the response');
  for (let i = 0; i < 180; i++) field.update(viewer, false, 1 / 60);
  assert.equal(field.strength.value, 0);
  assert.equal(field.weight(viewer, 3), 0);
  field.update(viewer, true, 1 / 60);
  assert.ok(field.position.value.equals(viewer), 'new entry begins at the current pose, not the old world');
});

test('field response has frame-rate independent easing, finite bounded dt and a fixed metre radius', () => {
  const viewer = new THREE.Vector3(9, 1.65, -7);
  const fields = [30, 60, 90].map(rate => {
    const field = new EnvironmentalPresence();
    for (let i = 0; i < rate; i++) field.update(viewer, true, 1 / rate);
    return field;
  });
  fields.forEach(field => {
    assert.ok(Math.abs(field.strength.value - fields[0].strength.value) < 1e-12);
    assert.ok(field.weight(new THREE.Vector3(9, 0, -7), 2.2) > .99);
    assert.equal(field.weight(new THREE.Vector3(9 + 2.2, 0, -7), 2.2), 0);
    assert.equal(field.weight(viewer, NaN), 0);
    assert.equal(field.weight(viewer, -1), 0);
  });
  const field = new EnvironmentalPresence();
  field.update(viewer, true, 10);
  assert.ok(field.strength.value < .4, 'a suspended tab must not produce an instant full-strength response');
  const before = field.strength.value;
  field.update(viewer, true, NaN);
  assert.equal(field.strength.value, before);
});

test('plant materials retain their wind hooks and distinct shader variants without extra meshes', () => {
  const field = new EnvironmentalPresence();
  const fern = new THREE.MeshStandardMaterial(), alien = new THREE.MeshStandardMaterial();
  applyWind(fern, { value: 0 }, .04, 1.2);
  applyWind(alien, { value: 0 }, .025, 1.1);
  applyPlantPresence(fern, field, 2.2, .24);
  applyPlantPresence(alien, field, 2.8, .18, true);
  assert.notEqual(fern.customProgramCacheKey(), alien.customProgramCacheKey());
  for (const material of [fern, alien]) {
    const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <emissivemap_fragment>' };
    material.onBeforeCompile(shader, {});
    assert.equal(shader.uniforms.uPresencePosition, field.position);
    assert.equal(shader.uniforms.uPresenceStrength, field.strength);
    assert.ok(shader.vertexShader.includes('uWindTime'));
    assert.ok(shader.vertexShader.includes('modelMatrix * instanceMatrix'), 'rotated/scaled instances need world-space influence');
    assert.ok(shader.vertexShader.includes('max(position.y, 0.0)'), 'plant bases remain pinned');
    assert.ok(shader.vertexShader.includes('#include <project_vertex>'));
  }
});

test('bundled daytime environment matches its recorded checksum and decodes as a finite 1024 by 512 HDR', () => {
  const bytes = readFileSync(new URL('../public/hdri/kloppenheim_05_puresky_1k.hdr', import.meta.url));
  assert.equal(bytes.length, 1086297);
  assert.equal(createHash('md5').update(bytes).digest('hex'), 'fe0d85219b08932d0467c3752012b749');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '9da5a7f9c799fa6e41cac8fbc4fb7aa2d4556e2f00ce9943abe0fd83b6d4caf5');
  const hdr = new HDRLoader().setDataType(THREE.FloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(hdr.width, 1024); assert.equal(hdr.height, 512);
  assert.ok(hdr.data.every(Number.isFinite));
  assert.ok(hdr.data.some(value => value > 1), 'lighting must preserve high dynamic range');
});
