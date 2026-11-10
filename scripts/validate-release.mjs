import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('validation/release', { recursive: true });
const run = (args, log, env = {}) => {
  const result = spawnSync(process.execPath, args, { env:{ ...process.env, ...env }, encoding:'utf8', maxBuffer:20*1024*1024, windowsHide:true });
  writeFileSync(log, (result.stdout || '') + (result.stderr || ''));
  console.log(`${log}: exit ${result.status}`);
  if (result.status !== 0) { console.log((result.stdout || '').slice(-4000), result.stderr); process.exit(result.status || 1); }
};
run(['node_modules/typescript/bin/tsc', '--noEmit'], 'validation/release/typecheck.txt');
run(['--test', 'scripts/test-*.mjs'], 'validation/release/unit-tests.txt');
run(['node_modules/vite/bin/vite.js', 'build'], 'validation/release/build.txt');
run(['node_modules/vite/bin/vite.js', 'build', '--outDir', 'validation/pages-build'], 'validation/release/pages-build.txt', { TEAR_BASE_PATH:'/tear-preview/' });
