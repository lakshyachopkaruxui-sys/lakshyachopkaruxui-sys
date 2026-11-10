import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith(new URL('../src/', import.meta.url).href) && !specifier.endsWith('.ts')) {
    return next(new URL(specifier + '.ts', context.parentURL).href, context);
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url.startsWith(new URL('../src/', import.meta.url).href)) {
    const file = url.endsWith('.ts') ? new URL(url) : new URL(url + '.ts');
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' }), shortCircuit: true };
  }
  return next(url, context);
} });
const { TearParticles } = await import('../src/particles/TearParticles.ts');

test('an empty or expired pool makes no particle draw and no attribute upload', () => {
  const particles = new TearParticles(new THREE.Scene()), zero = new THREE.Vector3();
  const attributes = particles.points.geometry.attributes;
  particles.update(.1, zero, new THREE.Vector3(0, 0, 1), 0, new THREE.Color('white'));
  assert.equal(particles.points.visible, false);
  assert.equal(attributes.position.version, 0);
  particles.burst([zero], 1, new THREE.Vector3(0, 0, 1), new THREE.Color('white'));
  particles.update(.1, zero, new THREE.Vector3(0, 0, 1), 0, new THREE.Color('white'));
  assert.equal(particles.points.visible, true);
  particles.update(10, zero, new THREE.Vector3(0, 0, 1), 0, new THREE.Color('white'));
  assert.equal(particles.points.visible, false);
  const versions = Object.values(attributes).map(attribute => attribute.version);
  particles.update(.1, zero, new THREE.Vector3(0, 0, 1), 0, new THREE.Color('white'));
  assert.deepEqual(Object.values(attributes).map(attribute => attribute.version), versions);
});

test('live particles retain additive RGB while preserving destination alpha', () => {
  const particles = new TearParticles(new THREE.Scene()), material = particles.points.material;
  assert.equal(material.blending, THREE.CustomBlending);
  assert.equal(material.blendSrc, THREE.OneFactor);
  assert.equal(material.blendDst, THREE.OneFactor);
  assert.equal(material.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(material.blendDstAlpha, THREE.OneFactor);
  const zero = new THREE.Vector3(), normal = new THREE.Vector3(0, 0, 1), color = new THREE.Color('white');
  particles.burst([zero], 1, normal, color); particles.update(.1, zero, normal, 0, color);
  const before = particles.points.geometry.attributes.color.version;
  particles.update(.1, zero, normal, 0, color);
  assert.equal(particles.points.visible, true);
  assert.equal(particles.points.geometry.attributes.color.version, before);
  particles.burst([zero], 1, normal, color); particles.update(.1, zero, normal, 0, color);
  assert.ok(particles.points.geometry.attributes.color.version > before);
});
