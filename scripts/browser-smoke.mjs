// Real Chromium/WebGL + keyboard journey. This is not a Quest hardware test.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.argv[2] || 'playwright');
const base = process.env.TEAR_TEST_URL || 'http://127.0.0.1:5174';
const output = new URL(process.env.TEAR_TEST_OUTPUT || '../validation/browser/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const errors = [], failedRequests = [], checks = [];
await page.addInitScript(() => {
  window.__captions = [];
  document.addEventListener('DOMContentLoaded', () => {
    const node = document.getElementById('narration-caption');
    if (node) new MutationObserver(() => window.__captions.push({ text: node.textContent, at: performance.now() })).observe(node, { childList: true, subtree: true, characterData: true });
  });
});
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(msg.text()); });
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText, type: request.resourceType(), timing: request.timing() }));
page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: new URL('entry.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: 'Desktop preview', exact: true }).click();
  await page.waitForFunction(() => window.app?.mode === 'desktop' && window.app.audio.state !== 'locked');
  assert.equal(await page.evaluate(() => window.app.outerIndex), 0);
  checks.push('Desktop entry');
  await page.waitForFunction(() => window.__captions.some(c => c.text.includes('familiar')));
  checks.push('Opening narration caption');
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => document.getElementById('narration-caption')?.textContent.includes('familiar'));
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => window.app.guide.notesVisible);
  assert.equal(await page.evaluate(() => window.app.guide.notesVisible), true);
  assert.ok(await page.evaluate(() => window.app.guide.caption.targetOpacity > 0));
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => !window.app.guide.notesVisible);
  checks.push('Field notes open/close without hiding narration captions');
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => !window.app.narration.enabled);
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(250);
  assert.ok((await page.locator('#narration-caption').textContent()).includes('familiar'));
  checks.push('Voice toggle and caption-only replay');
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => window.app?.worldUnderwater.marineLife.ready && window.app?.worldTwo.fauna.status === 'ready');
  await page.evaluate(async () => { await Promise.all([window.app.worldTwo.ready, window.app.worldThree.ready, window.app.worldUnderwater.ready]); });
  assert.equal(await page.evaluate(() => window.app.worldThree.landscape.status), 'ready', 'CC0 rock scan loaded');
  assert.equal(await page.evaluate(() => window.app.worldThree.skyStatus), 'ready', 'photographic shadow sky loaded');
  assert.equal(await page.evaluate(() => window.app.worldThree.fauna.status), 'ready', 'shadow animals loaded');
  assert.equal(await page.evaluate(() => window.app.worldThree.fauna.animals.length), 2);
  assert.deepEqual(await page.evaluate(() => window.app.worldTwo.scannedDetails.assetStatus), { ferns: 'ready', stumps: 'ready' });
  assert.equal(await page.evaluate(() => window.app.worldTwo.fauna.status), 'ready', 'forest deer loaded');
  assert.equal(await page.evaluate(() => window.app.worldTwo.fauna.animals.length), 3, 'three independent forest animals');
  assert.equal(await page.evaluate(() => window.app.worldTwo.conifers.status), 'ready', 'textured conifers loaded');
  assert.equal(await page.evaluate(() => window.app.worldTwo.photographicSkyReady), true, 'photographic forest sky loaded');
  assert.equal(await page.evaluate(() => window.app.worldTwo.forestFloorReady), true);
  await page.waitForFunction(() => window.app.narration.buffers.size === 5, null, { timeout: 15000 });
  const narrationBuffers = await page.evaluate(() => [...window.app.narration.buffers.values()].map(buffer => ({ channels: buffer.numberOfChannels, duration: buffer.duration })));
  assert.equal(narrationBuffers.length, 5, 'all five story cues decoded');
  assert.ok(narrationBuffers.every(buffer => buffer.channels === 2 && buffer.duration > 3 && buffer.duration < 16), 'natural-pitch stereo files are active');
  checks.push('Asset readiness');
  for (const [index, name] of [[2, 'ocean'], [3, 'shadow'], [1, 'forest'], [0, 'return-room']]) {
    await page.keyboard.press('KeyF');
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => window.app.canStepThrough(), null, { timeout: 90000 });
    await page.keyboard.press('Space');
    await page.keyboard.up('KeyD');
    await page.waitForFunction(target => window.app.outerIndex === target && window.app.swallow < 0, index, { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.app.anchor.scale.x), 1);
    await page.waitForTimeout(900);
    await page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, '$1') });
    if (name === 'shadow' || name === 'forest') {
      // Also inspect the settled environment after the chapter title fades.
      const distanceBefore = await page.evaluate(world => world === 'forest'
        ? window.app.worldTwo.fauna.animals.reduce((sum, animal) => sum + animal.distanceTravelled, 0)
        : window.app.worldThree.fauna.animals.reduce((sum, animal) => sum + animal.distance, 0), name);
      await page.waitForTimeout(6500);
      const distanceAfter = await page.evaluate(world => world === 'forest'
        ? window.app.worldTwo.fauna.animals.reduce((sum, animal) => sum + animal.distanceTravelled, 0)
        : window.app.worldThree.fauna.animals.reduce((sum, animal) => sum + animal.distance, 0), name);
      assert.ok(distanceAfter > distanceBefore + .1, `${name} animals move during ordinary viewing`);
      await page.screenshot({ path: new URL(`${name}-settled.png`, output).pathname.replace(/^\/([A-Z]:)/, '$1') });
    }
    checks.push(`Real keyboard grip/pull/cross -> ${name}`);
  }
  await page.waitForFunction(() => document.getElementById('narration-caption')?.textContent.includes('unchanged'));
  checks.push('Return narration caption');
  const sceneInfo = await page.evaluate(() => ({
    renderer: window.app.renderer.info.render,
    assets: { forest: !!window.app.worldTwo.scene.environment, creature: window.app.worldTwo.fauna.status === 'ready',
      shadowScan: window.app.worldThree.landscape.status, shadowFauna: window.app.worldThree.fauna.status,
      forestScans: window.app.worldTwo.scannedDetails.assetStatus, forestDeer: window.app.worldTwo.fauna.status,
      forestFloor: window.app.worldTwo.forestFloorReady, forestConifers: window.app.worldTwo.conifers.status,
      forestPhotographicSky: window.app.worldTwo.photographicSkyReady, shadowPhotographicSky: window.app.worldThree.skyStatus },
    world: window.app.currentWorld,
    alpha: window.app.renderer.getContext().getContextAttributes().alpha,
    stencil: window.app.renderer.getContext().getContextAttributes().stencil,
    graphicsRenderer: (() => { const gl=window.app.renderer.getContext(); const ext=gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable'; })()
  }));
  assert.equal(sceneInfo.assets.forest, true, 'verified HDR loaded');
  assert.equal(sceneInfo.alpha, true); assert.equal(sceneInfo.stencil, true);
  // Mobile setup remains readable and does not offer unusable touch-only 3D input.
  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.getByRole('button', { name: 'Desktop preview', exact: true }).click();
  assert.ok((await mobile.locator('#xr-note').textContent()).includes('mouse and keyboard'));
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: new URL('mobile-setup.png', output).pathname.replace(/^\/([A-Z]:)/, '$1'), fullPage: true });
  await mobile.setViewportSize({ width: 812, height: 375 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  checks.push('375px mobile setup and landscape, no horizontal overflow');
  await mobile.close();
  assert.deepEqual(errors, [], 'No browser or shader errors');
  assert.deepEqual(failedRequests, [], 'No failed resource requests');
  await writeFile(new URL('results.json', output), JSON.stringify({ scope: 'Desktop Chromium/WebGL; no physical XR or performance claim', checks, errors, failedRequests, sceneInfo }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors, failedRequests, sceneInfo }, null, 2));
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', output).pathname.replace(/^\/([A-Z]:)/, '$1') }).catch(() => {});
  const state = await page.evaluate(() => ({ captions: window.__captions, mode: window.app?.mode, time: window.app?.time, opening: window.app?.openingNarrated, audio: window.app?.audio.state, world: window.app?.outerIndex, gap: window.app?.sim.gap, frames: window.app?.presentedFrames })).catch(() => null);
  await writeFile(new URL('failure.json', output), JSON.stringify({ message: String(error), errors, failedRequests, checks, state }, null, 2));
  throw error;
} finally { await browser.close(); }
