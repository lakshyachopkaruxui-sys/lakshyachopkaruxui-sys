import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'validation/forest-movement-performance-2026-10-17/';
const hash = data => createHash('sha256').update(data).digest('hex').toUpperCase();
const manifest = JSON.parse(readFileSync(folder + 'before-sha256.json', 'utf8').replace(/^\uFEFF/, ''));
const allowed = new Set(['src/worlds/WorldTwo.ts', 'src/worlds/ForestUnderstory.ts', 'src/worlds/ForestConifers.ts', 'src/app/App.ts']);
const changed = [];
for (const file of manifest) {
  const path = file.path.replaceAll('\\', '/');
  assert.ok(existsSync(path), 'Missing original file: ' + path);
  if (hash(readFileSync(path)) !== file.sha256) {
    assert.ok(allowed.has(path), 'Unexpected change outside Forest scope: ' + path);
    changed.push(path);
  }
}
const app = readFileSync('src/app/App.ts', 'utf8');
const oldLine = '      `fps        ${f(this.debug.fps, 0)}`,\n';
const newLines = '      `fps        ${f(this.outerWorld === this.worldTwo ? this.worldTwo.frameTiming.fps : this.debug.fps, 0)}`,\n'
  + '      ...(this.outerWorld === this.worldTwo ? [`frame p95  ${f(this.worldTwo.frameTiming.p95Ms, 1)} ms`] : []),\n';
const normalized = app.replaceAll('\r\n', '\n');
assert.ok(normalized.includes(newLines));
const restored = normalized.replace(newLines, oldLine);
const appHash = manifest.find(file => file.path.replaceAll('\\', '/') === 'src/app/App.ts').sha256;
const candidates = [restored, restored.replaceAll('\n', '\r\n')];
for (const added of [newLines, newLines.replaceAll('\n', '\r\n')])
  for (const removed of [oldLine, oldLine.replaceAll('\n', '\r\n')]) candidates.push(app.replace(added,removed));
assert.ok(candidates.some(text => hash(text) === appHash),
  'The only App change must be the conditional Forest developer readout');
const before = JSON.parse(readFileSync('validation/forest-performance-2026-10-17/movement-before.json'));
const after = JSON.parse(readFileSync('validation/forest-performance-2026-10-17/movement-after.json'));
assert.equal(before.plantingLayoutHash, after.plantingLayoutHash, 'all plant/prop coordinates, sizes, seeds and species must match');
const unchanged = result => result.instances.filter(mesh => !mesh.name.startsWith('Forest cover '))
  .map(mesh => JSON.stringify(mesh)).sort();
assert.deepEqual(unchanged(after), unchanged(before), 'permanent grass, trees, ferns, sample and other existing instance layouts must match');
assert.equal(after.requestedMatrixUploads, 0);
assert.ok(before.requestedMatrixUploads > 0);
const summary = { changedExistingFiles: changed, missingFiles: 0, changedExistingAssets: 0,
  appChange: 'Forest-only developer FPS and p95 readout', samePlantingLayout: true,
  unchangedExistingStaticInstances: unchanged(after).length, requestedMatrixUploadsAfter: 0,
  scope: 'Source/geometry integrity only. Not browser or headset FPS validation.' };
writeFileSync(folder + 'scope-integrity.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
