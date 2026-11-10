// Integrated real scene + keyboard collision checks. XR uses IWER, not a physical headset.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.argv[2] || 'playwright');
const base = process.env.TEAR_TEST_URL || 'http://127.0.0.1:5174';
const output = new URL('../validation/collisions/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl'] });
const result = { scope: 'Chromium keyboard locomotion and IWER synthetic XR poses; no physical Quest claim', checks: [], contacts: [], errors: [], requestFailures: [] };
const observe = page => {
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) result.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) result.requestFailures.push({ url: response.url(), status: response.status() }); });
};
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); observe(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Desktop preview', exact: true }).click();
  await page.waitForFunction(() => window.app?.mode === 'desktop');
  await page.evaluate(async () => { await Promise.all([window.app.worldTwo.ready, window.app.worldThree.ready]); });
  for (const [index, name] of [[1, 'forest'], [3, 'shadow']]) {
    for (const rotated of [false, true]) {
      const setup = await page.evaluate(({ index, rotated }) => {
        const app = window.app, world = app.worlds[index];
        if (!world.collisions?.size) throw new Error('World has no registered collision footprints');
        app.outerIndex = index; app.currentWorld = index === 1 ? 'Forest' : 'Shadow';
        app.swallow = -1; app.swapped = false; world.stencilLayer = 0; world.refreshStencil();
        if (rotated) world.root.rotation.y += .91;
        world.root.updateWorldMatrix(true, false); app.applyWalkBounds();
        const body = { radius: .28, height: 1.7 };
        // Select an actual standing-tree collider with a clear approach to its surface.
        let selected;
        for (const obstacle of world.collisions.obstacles.values()) {
          if (obstacle.points.length !== 1 || !/tree|pine|fir|trunk/i.test(obstacle.id) || obstacle.radius < .08) continue;
          const point = obstacle.points[0];
          for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const dx = Math.sin(angle), dz = Math.cos(angle), distance = obstacle.radius + .28 + 1.1;
            const start = app.camera.position.clone().set(point.x + dx * distance, 0, point.z + dz * distance);
            const end = app.camera.position.clone().set(point.x - dx * distance, 0, point.z - dz * distance);
            if (world.collisions.queryLocal(start.x, start.z, .28)) continue;
            const contact = world.collisions.moveLocal(start, end, body);
            if (Math.abs(Math.hypot(contact.x - point.x, contact.z - point.z) - obstacle.radius - .28) > .01) continue;
            selected = { id: obstacle.id, point, radius: obstacle.radius, start, end, dx, dz }; break;
          }
          if (selected) break;
        }
        if (!selected) throw new Error('No unobstructed approach to a real tree collider');
        const startWorld = world.root.localToWorld(selected.start.clone());
        const endWorld = world.root.localToWorld(selected.end.clone());
        app.controls.yaw = Math.atan2(-(endWorld.x - startWorld.x), -(endWorld.z - startWorld.z));
        app.controls.pitch = -.04; app.controls.moveEnabled = true; app.controls.airborne = false;
        app.camera.position.copy(startWorld); app.camera.position.y = world.groundAt(startWorld.x, startWorld.z) + 1.55;
        window.__collisionTarget = { index, ...selected };
        return { id: selected.id, radius: selected.radius, obstacles: world.collisions.size, rotated };
      }, { index, rotated });
      await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
      await page.waitForFunction(() => {
        const app = window.app, target = window.__collisionTarget, world = app.worlds[target.index];
        const local = world.root.worldToLocal(app.camera.position.clone());
        return Math.hypot(local.x - target.point.x, local.z - target.point.z) <= target.radius + .30;
      }, null, { timeout: 15000 });
      await page.waitForTimeout(350);
      await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
      const contact = await page.evaluate(() => {
        const app = window.app, target = window.__collisionTarget, world = app.worlds[target.index];
        const local = world.root.worldToLocal(app.camera.position.clone());
        return { distance: Math.hypot(local.x - target.point.x, local.z - target.point.z), radius: target.radius,
          approachSide: (local.x - target.point.x) * target.dx + (local.z - target.point.z) * target.dz,
          floorError: app.camera.position.y - world.groundAt(app.camera.position.x, app.camera.position.z) - 1.55,
          camera: app.camera.position.toArray(), local: local.toArray() };
      });
      assert.ok(contact.distance >= contact.radius + .279, name + ' remains outside the real trunk');
      assert.ok(contact.distance <= contact.radius + .30, name + ' reached the real trunk contact');
      assert.ok(contact.approachSide > 0, name + ' did not tunnel through the tree');
      assert.ok(Math.abs(contact.floorError) < .02, name + ' remains grounded');
      await page.screenshot({ path: fileURLToPath(new URL(`${name}-${rotated ? 'rotated' : 'contact'}.png`, output)) });
      result.contacts.push({ name, ...setup, ...contact });
      result.checks.push(`${name}: actual keyboard sprint stopped at tree${rotated ? ' after root rotation' : ''}, floor contact preserved`);
    }
    const actors = await page.evaluate(index => {
      const app = window.app, world = app.worlds[index], fauna = world.fauna;
      const animals = index === 1 ? fauna.animals : fauna.creatures;
      const ids = new Set(animals.map((actor, i) => actor.id || `forest-doe-${i}`));
      const viewer = world.root.localToWorld(app.camera.position.clone().set(0, 1.55, 1));
      const violations = [], mutualViolations = [], modes = new Set();
      const startDistance = animals.map(actor => actor.distanceTravelled ?? actor.distance);
      const pointSegment = (p, a, b) => {
        const dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
      };
      const segmentDistance = (a, b, c, d) => {
        const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
        const boxesOverlap = Math.max(a.x,b.x) >= Math.min(c.x,d.x) && Math.max(c.x,d.x) >= Math.min(a.x,b.x) &&
          Math.max(a.z,b.z) >= Math.min(c.z,d.z) && Math.max(c.z,d.z) >= Math.min(a.z,b.z);
        if (boxesOverlap && cross(a,b,c) * cross(a,b,d) <= 0 && cross(c,d,a) * cross(c,d,b) <= 0) return 0;
        return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
      };
      // Exercise actual routes and shared proxies for 45 simulated seconds.
      for (let frame = 0; frame < 900; frame++) {
        if (index === 1) { fauna.updateView(viewer, true, .05); fauna.update(.05); }
        else fauna.update(viewer, true, .05);
        for (let i = 0; i < animals.length; i++) {
          const actor = animals[i], p = actor.root.position;
          modes.add(actor.mode || (actor.moving ? 'walk' : 'idle'));
          const radius = actor.clearance ?? actor.radius ?? world.collisions.obstacles.get(actor.id)?.radius ?? .60;
          if (world.collisions.queryLocal(p.x, p.z, radius, actor.height ?? 1.5, p.y, ids) && violations.length < 8)
            violations.push({ frame, i, position: p.toArray(), radius });
        }
        const bodies = [...ids].map(id => world.collisions.obstacles.get(id));
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          const distance = segmentDistance(a.points[0], a.points[1] ?? a.points[0], b.points[0], b.points[1] ?? b.points[0]);
          if (distance < a.radius + b.radius - .001 && mutualViolations.length < 8)
            mutualViolations.push({ frame, ids: [a.id,b.id], penetration: a.radius + b.radius - distance });
        }
      }
      return { count: animals.length, modes: [...modes], violations, mutualViolations,
        distances: animals.map((actor, i) => (actor.distanceTravelled ?? actor.distance) - startDistance[i]) };
    }, index);
    assert.deepEqual(actors.violations, [], name + ' moving actors stay outside static tree/rock/pond footprints');
    assert.deepEqual(actors.mutualViolations, [], name + ' dynamic actor bodies remain mutually separated');
    assert.ok(actors.distances.every(distance => distance > .4), name + ' actors actually traverse their routes');
    result.contacts.push({ name, actorPaths: actors });
    result.checks.push(`${name}: actual actor paths advance for 45 simulated seconds without static or mutual body overlap`);
    const animalSetup = await page.evaluate(index => {
      const app = window.app, world = app.worlds[index], fauna = world.fauna;
      const actor = (index === 1 ? fauna.animals : fauna.creatures)[0];
      // Exercise the normal stationary source-animation state; registrations still update every frame.
      if (index === 1) { actor.phase = 25 - fauna.elapsed; actor.speed = 0; }
      else actor.pause = 8;
      const id = actor.id || 'forest-doe-0', obstacle = world.collisions.obstacles.get(id);
      const center = actor.root.position, reach = Math.max(...obstacle.points.map(p => Math.hypot(p.x-center.x,p.z-center.z))) + obstacle.radius;
      let selected;
      for (const angle of [0, Math.PI/2, Math.PI, -Math.PI/2]) {
        const start = center.clone(); start.x += Math.sin(angle) * (reach + .28 + .6); start.z += Math.cos(angle) * (reach + .28 + .6);
        if (world.collisions.queryLocal(start.x,start.z,.28,1.7,start.y)) continue;
        const contact = world.collisions.moveLocal(start,center,{radius:.28,height:1.7});
        if (Math.abs(world.collisions.distance(obstacle,contact.x,contact.z) - .28) > .01) continue;
        selected = start; break;
      }
      if (!selected) throw new Error('No clear approach to an actual animal body');
      const startWorld = world.root.localToWorld(selected.clone()), targetWorld = world.root.localToWorld(center.clone());
      app.controls.yaw = Math.atan2(-(targetWorld.x-startWorld.x),-(targetWorld.z-startWorld.z));
      app.camera.position.copy(startWorld); app.camera.position.y = world.groundAt(startWorld.x,startWorld.z)+1.55;
      window.__animalCollision = {index,id};
      return {id,shape:obstacle.points.length === 2 ? 'capsule' : 'circle'};
    }, index);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => {
      const app=window.app,target=window.__animalCollision,world=app.worlds[target.index];
      const local=world.root.worldToLocal(app.camera.position.clone()),body=world.collisions.obstacles.get(target.id);
      return world.collisions.distance(body,local.x,local.z) <= .30;
    }, null, {timeout:15000});
    await page.waitForTimeout(350); await page.keyboard.up('KeyW');
    const bodyContact = await page.evaluate(() => {
      const app=window.app,target=window.__animalCollision,world=app.worlds[target.index];
      const local=world.root.worldToLocal(app.camera.position.clone()),body=world.collisions.obstacles.get(target.id);
      return {clearance:world.collisions.distance(body,local.x,local.z),camera:app.camera.position.toArray()};
    });
    assert.ok(bodyContact.clearance >= .279 && bodyContact.clearance <= .301, name + ' player stops outside actual dynamic animal body');
    await page.screenshot({path:fileURLToPath(new URL(name+'-animal-contact.png',output))});
    result.contacts.push({name,animalContact:{...animalSetup,...bodyContact}});
    result.checks.push(`${name}: keyboard walking stops outside an actual dynamically registered animal body`);
  }
  await page.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); observe(page);
  await page.goto(base + '/?emulate&debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.xrDevice);
  await page.evaluate(() => { window.xrDevice.controlMode = 'programmatic'; });
  await page.locator('#enter-headset').click();
  await page.waitForFunction(() => window.app?.mode === 'xr' && window.app.renderer.xr.isPresenting && !window.app.pendingXRPose);
  await page.evaluate(async () => { await window.app.worldTwo.ready; });
  const pose = await page.evaluate(() => {
    const app = window.app, world = app.worldTwo;
    app.outerIndex = 1; app.swallow = -1; app.swapped = false; world.stencilLayer = 0; world.refreshStencil();
    const obstacle = [...world.collisions.obstacles.values()].find(o => o.points.length === 1 && /tree|pine|fir|trunk/i.test(o.id) && o.maxY > 2);
    if (!obstacle) throw new Error('No real tree available for XR head overlap');
    const point = world.root.localToWorld(app.camera.position.clone().set(obstacle.points[0].x, 0, obstacle.points[0].z));
    point.y = world.groundAt(point.x, point.z) + 1.55;
    window.xrDevice.position.set(point.x, point.y, point.z);
    return { position: point.toArray(), id: obstacle.id };
  });
  await page.waitForFunction(() => window.app.collisionComfortMaterial.uniforms.opacity.value > .75, null, { timeout: 12000 });
  const penetration = await page.evaluate(() => ({
    tracked: window.app.renderer.xr.getCamera().position.toArray(),
    device: [window.xrDevice.position.x, window.xrDevice.position.y, window.xrDevice.position.z],
    opacity: window.app.collisionComfortMaterial.uniforms.opacity.value,
    visible: window.app.collisionComfort.visible,
  }));
  assert.ok(penetration.device.every((value, index) => Math.abs(value - pose.position[index]) < .0001));
  assert.ok(penetration.tracked.every((value, index) => Math.abs(value - pose.position[index]) < .001), 'tracked head stays at the synthetic input pose');
  assert.equal(penetration.visible, true);
  await page.screenshot({ path: fileURLToPath(new URL('xr-head-overlap.png', output)) });
  result.checks.push('IWER tracked head overlaps real tree: fade activates while tracked/device poses remain unchanged');
  await page.evaluate(() => {
    const app = window.app, world = app.worldTwo;
    let point;
    for (let z = 0; z < 5 && !point; z++) for (let x = -3; x <= 3; x++) {
      const candidate = world.root.localToWorld(app.camera.position.clone().set(x, 0, z));
      candidate.y = world.groundAt(candidate.x, candidate.z) + 1.55;
      const base = candidate.clone(); base.y -= .12;
      if (!world.collisions.queryWorld(base, .13, .24)) { point = candidate; break; }
    }
    if (!point) throw new Error('No nearby unoccupied XR pose');
    window.xrDevice.position.set(point.x, point.y, point.z);
  });
  await page.waitForFunction(() => !window.app.collisionComfort.visible, null, { timeout: 12000 });
  await page.screenshot({ path: fileURLToPath(new URL('xr-head-clear.png', output)) });
  result.checks.push('IWER head leaves obstacle: comfort fade clears');
  result.xr = { pose, penetration };
  assert.deepEqual(result.errors, []); assert.deepEqual(result.requestFailures, []);
  await writeFile(new URL('results.json', output), JSON.stringify(result, null, 2));
  for (const name of ['failure.json', 'failure.png']) await rm(new URL(name, output), { force: true });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.failure = String(error);
  await page?.screenshot({ path: fileURLToPath(new URL('failure.png', output)) }).catch(() => {});
  await writeFile(new URL('failure.json', output), JSON.stringify(result, null, 2));
  throw error;
} finally { await browser.close(); }
