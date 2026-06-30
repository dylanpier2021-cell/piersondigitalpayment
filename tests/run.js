'use strict';
// Self-contained test runner: seeds an isolated DB, starts the server on a test
// port, runs every test module, then tears down. Usage: `npm test`.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmpdata');
const PORT = Number(process.env.TF_TEST_PORT) || 4393;
const BASE = `http://localhost:${PORT}`;

process.env.TF_DATA_DIR = TMP;
process.env.TF_TEST_BASE = BASE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch {}
    await sleep(250);
  }
  return false;
}

(async () => {
  // Fresh isolated database.
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  console.log('Seeding test database…');
  const seed = spawnSync('node', ['server/seed.js', '--force'], { cwd: ROOT, env: { ...process.env }, stdio: 'ignore' });
  if (seed.status !== 0) { console.error('Seed failed'); process.exit(1); }

  console.log(`Starting server on ${PORT}…`);
  const srv = spawn('node', ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), TF_RATELIMIT: 'off' }, stdio: 'ignore' });

  const ok = await waitHealth();
  if (!ok) { console.error('Server did not become healthy'); srv.kill(); process.exit(1); }

  const modules = ['./api.test', './coupon.test', './owner.test', './signup.test', './render.test'];
  let totalPass = 0, totalFail = 0; const summaries = [];
  for (const mod of modules) {
    try {
      const { run } = require(mod);
      const r = await run();
      totalPass += r.pass; totalFail += r.fail; summaries.push(r);
      console.log(`\n${r.fail === 0 ? '✓' : '✗'} ${r.name}: ${r.pass} passed, ${r.fail} failed`);
      r.failures.forEach((f) => console.log('   ✗ ' + f));
    } catch (err) {
      totalFail++; console.log(`\n✗ ${mod} CRASHED: ${err.message}`);
    }
  }

  console.log(`\n══════════════════════════════════════`);
  console.log(`  TOTAL: ${totalPass} passed, ${totalFail} failed`);
  console.log(`══════════════════════════════════════`);

  srv.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(totalFail === 0 ? 0 : 1);
})();
