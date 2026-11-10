// Focused desktop WebGL inspection. Uses a direct scene transition for the
// screenshot; the complete keyboard journey is tested by browser-smoke.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const folder = new URL('../validation/forest-revision/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'warn') console.log(message.text());
  if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text());
});
try {
  await page.goto(process.env.TEAR_TEST_URL || 'http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Desktop preview', exact: true }).click();
  await page.waitForFunction(() => window.app?.mode === 'desktop');
  await page.evaluate(async () => { await window.app.worldTwo.ready; });
  const state = await page.evaluate(() => {
    const app = window.app;
    for (let i = 0; i < 3; i++) { app.stepThrough(); app.sim.reset(); app.placeSeamInFront(); }
    return { scans: app.worldTwo.scannedDetails.assetStatus, floor: app.worldTwo.forestFloorReady,
      deer: app.worldTwo.fauna.status, conifers: app.worldTwo.conifers.status, sky: app.worldTwo.photographicSkyReady, treeMeshes: app.worldTwo.conifers.root.children.map(o => ({name:o.name,count:o.count, radius:o.boundingSphere?.radius})), instances: app.worldTwo.scannedDetails.root.children.map(mesh => ({ name: mesh.name, count: mesh.count, triangles: mesh.geometry.index.count / 3 * mesh.count })) };
  });
  assert.deepEqual(state.scans, { ferns: 'ready', stumps: 'ready' });
  assert.equal(state.floor, true); assert.equal(state.deer, 'ready'); assert.equal(state.conifers, 'ready'); assert.equal(state.sky, true);
  // Wildlife remains alive while a desktop visitor simply watches, without
  // requiring mouse lock or movement input.
  await page.waitForFunction(() => window.app.worldTwo.fauna.animals[0].distanceTravelled > .35, null, { timeout: 60000 });
  state.unlockedWildlife = await page.evaluate(() => ({ pointerLocked: !!document.pointerLockElement,
    distanceTravelled: window.app.worldTwo.fauna.animals[0].distanceTravelled }));
  assert.equal(state.unlockedWildlife.pointerLocked, false);
  await page.locator('canvas').first().click({ position: { x: 400, y: 650 } });
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForFunction(() => window.app.worldTwo.fauna.animals[0].distanceTravelled > 3, null, { timeout: 60000 });
  await page.waitForTimeout(8000);
  state.render = await page.evaluate(async () => {
    const app = window.app, info = app.renderer.info;
    await new Promise(resolve => requestAnimationFrame(resolve));
    info.autoReset = false; info.reset();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const counters = { ...info.render };
    info.autoReset = true;
    return { ...counters, scope: 'One full animation frame, all renderer passes',
      treeCount: app.worldTwo.conifers.spots.length,
      deer: app.worldTwo.fauna.animals.map(a => ({ position: a.root.position.toArray(), mode: a.mode, distanceTravelled: a.distanceTravelled, clearance: a.clearance })) };
  });
  await page.screenshot({ path: new URL('forest.png', folder).pathname.replace(/^\/([A-Z]:)/, '$1') });
  // Close material inspection is explicitly separate from the normal arrival.
  await page.evaluate(() => {
    const app = window.app, forest = app.worldTwo, spot = forest.conifers.spots[0];
    const eye = app.camera.position.clone().set(spot.x + 1.9, forest.groundHeight(spot.x + 1.9, spot.z + 2.2) + 1.6, spot.z + 2.2);
    const target = eye.clone().set(spot.x, forest.groundHeight(spot.x, spot.z) + .7, spot.z);
    forest.root.localToWorld(eye); forest.root.localToWorld(target);
    app.camera.position.copy(eye); app.camera.lookAt(target); app.camera.rotation.order = 'YXZ';
    app.controls.yaw = app.camera.rotation.y; app.controls.pitch = app.camera.rotation.x;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: new URL('forest-trunk-close.png', folder).pathname.replace(/^\/([A-Z]:)/, '$1') });
  assert.deepEqual(errors, []);
  state.errors = errors;
  await writeFile(new URL('results.json', folder), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state, null, 2));
} finally { await browser.close(); }
