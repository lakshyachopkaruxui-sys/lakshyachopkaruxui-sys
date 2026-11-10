// Real Chromium + IWER synthetic headset/joints. No physical passthrough or
// optical tracking is exercised. Only IWER's public device-control API is used.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.argv[2] || 'playwright');
const output = new URL('../validation/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20000);
const result = { scope: 'Chromium + IWER emulated Meta Quest 3; not physical passthrough or optical tracking',
  checks: [], errors: [], requestFailures: [], capability: null, state: null, status: 'running' };
page.on('pageerror', error => result.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) result.errors.push(message.text()); });
page.on('requestfailed', request => result.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
const capture = name => page.screenshot({ path: fileURLToPath(new URL('xr-emulated-' + name + '.png', output)) });
const state = () => page.evaluate(() => ({
  note: document.querySelector('#xr-note')?.textContent,
  mode: window.app?.mode,
  presenting: window.app?.renderer.xr.isPresenting,
  session: window.app?.xrSessionState,
  xrMode: window.app?.xrMode,
  blend: window.app?.renderer.xr.getSession()?.environmentBlendMode,
  notes: window.app?.guide.notesVisible,
  helpProgress: window.app?.helpGesture.progress,
  targets: window.app ? [window.app.notesTarget, window.app.narrationTarget, window.app.replayTarget].map(target => ({
    position: target.position.toArray(), visible: target.root.visible, labelOpacity: target.label.opacity
  })) : [],
  hand: window.app?.xrHands.sample('left').tracked,
  introVisible: !document.querySelector('#intro')?.classList.contains('hidden')
}));
async function pointAt(name) {
  await page.evaluate(targetName => {
    const app = window.app, device = window.xrDevice;
    const hand = device.hands.left;
    const current = app.xrHands.sample('left').indexTip;
    const target = app[targetName].position;
    hand.position.x += target.x - current.x;
    hand.position.y += target.y - current.y;
    hand.position.z += target.z - current.z;
  }, name);
}
async function withdraw() {
  await page.evaluate(() => { window.xrDevice.hands.left.position.x -= .25; });
  await page.waitForTimeout(500);
}
try {
  await page.goto(process.env.TEAR_XR_TEST_URL || 'http://127.0.0.1:5174/?emulate&debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.xrDevice);
  result.capability = await page.evaluate(async () => ({
    name: window.xrDevice.name, version: window.xrDevice.version,
    modes: window.xrDevice.supportedSessionModes,
    features: window.xrDevice.supportedFeatures,
    supportsAR: await navigator.xr.isSessionSupported('immersive-ar')
  }));
  if (!result.capability.supportsAR) {
    result.status = 'blocked: IWER configuration does not support immersive-ar';
    result.state = await state();
    await capture('unsupported');
  } else {
    await page.evaluate(() => { window.xrDevice.controlMode = 'programmatic'; });
    await page.locator('#enter-headset').click();
    await page.waitForFunction(() => window.app?.mode === 'xr' && window.app.renderer.xr.isPresenting && !window.app.pendingXRPose);
    assert.equal(await page.evaluate(() => window.app.renderer.xr.getSession().environmentBlendMode), 'alpha-blend');
    assert.equal(await page.evaluate(() => window.app.worldOne.root.visible), false);
    result.checks.push('Public headset button starts emulated alpha-blend session through setup helper');
    await page.evaluate(() => {
      window.xrDevice.hands.left.connected = true;
      window.xrDevice.hands.right.connected = false;
      window.xrDevice.hands.left.poseId = 'point';
      window.xrDevice.hands.left.updatePinchValue(0);
    });
    await page.waitForFunction(() => window.app.xrHands.sample('left').tracked && window.app.notesTarget.root.visible);
    result.checks.push('Live emulated single hand and visible notes target');
    const wasOpen = await page.evaluate(() => window.app.guide.notesVisible);
    await pointAt('notesTarget');
    await page.waitForFunction(previous => window.app.guide.notesVisible !== previous, wasOpen);
    result.checks.push('Emulated fingertip dwell toggles field notes');
    await withdraw();
    if (!await page.evaluate(() => window.app.guide.notesVisible)) {
      await pointAt('notesTarget');
      await page.waitForFunction(() => window.app.guide.notesVisible);
      await withdraw();
    }
    await page.waitForFunction(() => window.app.narrationTarget.root.visible && window.app.replayTarget.root.visible);
    const labelBounds = await page.evaluate(() => {
      const camera = window.app.renderer.xr.getCamera().cameras[0];
      return [window.app.notesTarget, window.app.narrationTarget, window.app.replayTarget].map(target => {
        const mesh = target.label.mesh;
        mesh.updateWorldMatrix(true, false);
        const positions = mesh.geometry.attributes.position;
        const points = [];
        for (let i = 0; i < positions.count; i++) {
          const point = target.position.clone().set(positions.getX(i), positions.getY(i), positions.getZ(i));
          mesh.localToWorld(point).project(camera);
          points.push(point.toArray());
        }
        return { text: target.text, points };
      });
    });
    for (const label of labelBounds) {
      assert.ok(label.points.every(point => Math.abs(point[0]) <= 1 && Math.abs(point[1]) <= 1), label.text + ' fits neutral emulated eye viewport');
    }
    result.labelBounds = labelBounds;
    const notesSpacing = await page.evaluate(() => {
      const app = window.app;
      const camera = app.renderer.xr.getCamera().cameras[0];
      const verticalBounds = mesh => {
        mesh.updateWorldMatrix(true, false);
        const positions = mesh.geometry.attributes.position;
        const ys = [];
        for (let i = 0; i < positions.count; i++) {
          const point = app.replayTarget.position.clone().set(positions.getX(i), positions.getY(i), positions.getZ(i));
          ys.push(mesh.localToWorld(point).project(camera).y);
        }
        return { min: Math.min(...ys), max: Math.max(...ys) };
      };
      return { notes: verticalBounds(app.guide.notes.mesh), replay: verticalBounds(app.replayTarget.disk) };
    });
    assert.ok(notesSpacing.replay.max < notesSpacing.notes.min, 'Replay circle stays below the notes card');
    result.notesSpacing = notesSpacing;
    result.checks.push('Voice and replay targets visible with field notes');
    await capture('notes');
    const voice = await page.evaluate(() => window.app.narration.enabled);
    await pointAt('narrationTarget');
    await page.waitForFunction(previous => window.app.narration.enabled !== previous, voice);
    result.checks.push('Emulated fingertip dwell toggles narration');
    await withdraw();
    await pointAt('replayTarget');
    await page.waitForFunction(() => document.querySelector('#narration-caption')?.textContent.includes('familiar'));
    result.checks.push('Emulated fingertip dwell replays opening caption');
    await withdraw();
    await capture('replay');
    await page.evaluate(() => window.app.renderer.xr.getSession().end());
    await page.waitForFunction(() => window.app.mode === 'intro' && !window.app.renderer.xr.isPresenting && !document.querySelector('#intro').classList.contains('hidden'));
    const exit = await page.evaluate(() => ({ controls: window.app.controls.enabled, hands: window.app.desktopHands.enabled,
      targets: [window.app.notesTarget, window.app.narrationTarget, window.app.replayTarget].map(target => target.root.visible),
      master: window.app.audio.listener.getMasterVolume() }));
    assert.equal(exit.controls, false); assert.equal(exit.hands, false);
    assert.deepEqual(exit.targets, [false, false, false]);
    assert.equal(exit.master, 0);
    assert.equal(await page.locator('#narration-enabled').isChecked(), !voice, 'intro voice choice follows the headset toggle');
    result.checks.push('Emulated session end returns to quiet intro with controls and targets disabled');
    await capture('exit');
    result.state = await state();
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.requestFailures, []);
    result.status = 'passed';
  }
} catch (error) {
  result.status = 'failed';
  result.failure = String(error);
  result.state = await state().catch(() => null);
  await capture('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(new URL('xr-emulated-results.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
