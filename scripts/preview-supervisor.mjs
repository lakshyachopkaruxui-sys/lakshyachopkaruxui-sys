// Project-local preview recovery. No renderer or environment code is changed.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] || 'run';
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 5174 : Number(process.argv[portIndex + 1]);
if (process.platform !== 'win32') throw new Error('This local preview launcher requires Windows.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port.');
if (!['run', 'status', 'stop'].includes(command)) throw new Error('Use run, status or stop.');
const identity = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
const pipe = `\\\\.\\pipe\\tear-preview-${identity}-${port}`;

function control(request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe), chunks = [];
    socket.setTimeout(4000, () => socket.destroy(new Error('Preview control timed out.')));
    socket.once('connect', () => socket.write(request + '\n'));
    socket.on('data', chunk => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
    });
  });
}

function reachable() {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = result => { if (!done) { done = true; socket.destroy(); resolve(result); } };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function healthy() {
  return new Promise(resolve => {
    let settled = false, body = '';
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    const request = http.get({ host: '127.0.0.1', port, path: '/', agent: false }, response => {
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 128 * 1024) { response.destroy(); finish(false); }
      });
      response.once('end', () => finish(response.statusCode === 200 && /<title>[^<]*tear/i.test(body)));
      response.once('error', () => finish(false));
    });
    request.setTimeout(4000, () => { request.destroy(); finish(false); });
    request.once('error', () => finish(false));
  });
}

async function run() {
  try { console.log(JSON.stringify(await control('status'))); return; } catch { /* No active supervisor. */ }
  if (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name !== 'tear-reality-webxr')
    throw new Error('The preview launcher is not inside the Tear project.');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('Tear dependencies are missing.');
  const folder = path.join(root, 'validation', 'preview-service');
  mkdirSync(folder, { recursive: true });
  const logPath = path.join(folder, `preview-${port}.log`);
  const log = message => {
    // Keep at most two 2 MB logs, confined to this project.
    if (existsSync(logPath) && statSync(logPath).size > 2 * 1024 * 1024) {
      rmSync(logPath + '.previous', { force: true }); renameSync(logPath, logPath + '.previous');
    }
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  };
  let child = null, stopping = false, busy = false, timer;
  let nextCheck = 0, startTime = 0, retryAt = 0, failures = 0, crashes = 0, startCount = 0;
  let state = 'starting', isHealthy = false;
  const status = () => ({ pid: process.pid, childPid: child?.pid ?? null, port, state,
    healthy: isHealthy, startCount, project: root });
  const setState = value => { if (state !== value) { state = value; log(value); } };
  const server = net.createServer(socket => {
    let input = '';
    socket.setTimeout(4000, () => socket.destroy());
    socket.on('data', chunk => {
      input += chunk.toString();
      if (input.length > 128) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      const action = input.trim();
      if (action === 'stop') {
        socket.end(JSON.stringify({ ...status(), stopping: true }));
        stop();
      } else socket.end(JSON.stringify(status()));
    });
  });
  function stop() {
    if (stopping) return;
    stopping = true; clearInterval(timer); setState('stopped');
    // Kill only the child created by this supervisor, never another port owner.
    if (child) child.kill();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }
  function launch() {
    setState('starting'); isHealthy = false; startTime = Date.now(); startCount++;
    nextCheck = Date.now() + 3000;
    child = spawn(process.execPath, [vite, '--mode', 'http', '--host', '127.0.0.1',
      '--port', String(port), '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const owned = child;
    owned.stdout.on('data', data => log(data.toString().trimEnd()));
    owned.stderr.on('data', data => log(data.toString().trimEnd()));
    owned.once('error', error => log(`Launch failed: ${error.message}`));
    owned.once('close', code => {
      if (child !== owned) return;
      child = null; isHealthy = false;
      if (stopping) return;
      crashes++; retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(crashes - 1, 5));
      nextCheck = 0; setState('recovering'); log(`Preview exited (${code}); restart pending.`);
    });
    log(`Started preview PID ${owned.pid} on http://127.0.0.1:${port}/`);
  }
  async function tick() {
    if (busy || stopping || Date.now() < nextCheck || Date.now() < retryAt) return;
    busy = true;
    try {
      if (!child && !(await reachable())) {
        if (!stopping) launch();
        return;
      }
      const ok = await healthy();
      if (stopping) return;
      isHealthy = ok; nextCheck = Date.now() + 15000;
      if (ok) {
        failures = 0;
        if (Date.now() - startTime > 60000) crashes = 0;
        setState(child ? 'running' : 'watching-existing-preview');
      } else if (child) {
        // Allow cold startup, then require three failures before recovering.
        if (Date.now() - startTime > 60000 && ++failures >= 3) {
          failures = 0; setState('recovering-unresponsive-preview'); child.kill();
        }
      } else setState('port-in-use');
    } catch (error) { log(`Recovery check: ${error.message}`); nextCheck = Date.now() + 15000; }
    finally { busy = false; }
  }
  // The named pipe is an OS-owned singleton lock. It disappears if this
  // process exits, so restarts cannot leave a stale file lock behind.
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(pipe, resolve);
  });
  log(`Supervisor PID ${process.pid} ready.`);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  timer = setInterval(tick, 1000);
  await tick();
}

if (command === 'run') await run();
else {
  try { console.log(JSON.stringify(await control(command))); }
  catch { console.error('Tear preview supervisor is not running.'); process.exitCode = 1; }
}
