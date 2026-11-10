// Live supervisor test on an isolated port; never interrupts the user's preview.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'preview-supervisor.mjs');
const port = 5184;
await new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(port, '127.0.0.1', () => socket.close(resolve));
});
const args = action => [script, action, '--port', String(port)];
const control = action => JSON.parse(execFileSync(process.execPath, args(action), { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }));
const waitFor = async predicate => {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { const value = predicate(); if (value) return value; } catch { /* Startup can be in progress. */ }
    await delay(400);
  }
  throw new Error('Timed out waiting for preview recovery.');
};
const service = spawn(process.execPath, args('run'), { cwd: root, windowsHide: true, stdio: 'ignore' });
const closed = new Promise(resolve => service.once('exit', resolve));
try {
  const first = await waitFor(() => { const value = control('status'); return value.healthy && value.childPid ? value : null; });
  assert.equal(first.pid, service.pid);
  const duplicate = control('run');
  assert.equal(duplicate.pid, first.pid, 'duplicate launch must reuse the existing supervisor');
  process.kill(first.childPid); // This child belongs to the isolated test supervisor.
  const recoveryStart = Date.now();
  const recovered = await waitFor(() => { const value = control('status'); return value.healthy && value.childPid !== first.childPid ? value : null; });
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>[^<]*tear/i);
  assert.equal(recovered.startCount, 2);
  const report = { isolatedPort: port, duplicateLaunchPrevented: true, crashedChildRestarted: true,
    recoveredInMs: Date.now() - recoveryStart, pageStatus: response.status };
  const folder = path.join(root, 'validation', 'preview-service'); mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'recovery-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  try { control('stop'); } catch { /* Reported by the checks above if startup failed. */ }
  await Promise.race([closed, delay(6000).then(() => { if (service.exitCode === null) service.kill(); })]);
}
