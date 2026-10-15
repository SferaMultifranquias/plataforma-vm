'use strict';

const assert = require('node:assert/strict');

const RUNTIME_PATH = require('path').join(__dirname, '..', 'e2e', 'helpers', 'runtime.js');

function rememberEnv(keys) {
  const snapshot = {};
  keys.forEach((key) => {
    snapshot[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
  });
  return snapshot;
}

function restoreEnv(snapshot) {
  Object.keys(snapshot).forEach((key) => {
    const value = snapshot[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  });
}

function clearModule(path) {
  delete require.cache[require.resolve(path)];
}

async function run() {
  const ENV_KEYS = ['E2E_TARGET_ENV', 'E2E_ALLOW_LIVE_READS', 'E2E_ALLOW_LIVE_WRITES', 'E2E_ALLOW_LIVE_CRUD'];
  const snapshot = rememberEnv(ENV_KEYS);

  try {
    // Helper to reload runtime module with current env
    function reloadRuntime() {
      clearModule(RUNTIME_PATH);
      return require(RUNTIME_PATH);
    }

    // ── Allowed read-only ────────────────────────────────────────
    {
      delete process.env.E2E_TARGET_ENV;
      process.env.E2E_ALLOW_LIVE_READS = 'true';
      delete process.env.E2E_ALLOW_LIVE_WRITES;
      delete process.env.E2E_ALLOW_LIVE_CRUD;

      const rt = reloadRuntime();
      rt.assertLiveReadsEnabled(); // no target required for reads
    }
    console.log('PASS: read-only does not require E2E_TARGET_ENV');

    // live-read permission independent from mutation permission
    {
      delete process.env.E2E_TARGET_ENV;
      process.env.E2E_ALLOW_LIVE_READS = 'true';
      process.env.E2E_ALLOW_LIVE_WRITES = 'false';

      const rt = reloadRuntime();
      rt.assertLiveReadsEnabled();
      assert.throws(() => rt.assertLiveWritesEnabled(), /E2E_ALLOW_LIVE_WRITES must be exactly true/);
    }
    console.log('PASS: live-read independent from mutation permission');

    // ── Rejected mutation cases ──────────────────────────────────
    const rejectCases = [
      { label: 'write enabled with missing target', env: { E2E_ALLOW_LIVE_WRITES: 'true', E2E_TARGET_ENV: '' } },
      { label: 'CRUD enabled with missing target', env: { E2E_ALLOW_LIVE_CRUD: 'true', E2E_TARGET_ENV: '' } },
      { label: 'target production', env: { E2E_ALLOW_LIVE_WRITES: 'true', E2E_TARGET_ENV: 'production' } },
      { label: 'target prod', env: { E2E_ALLOW_LIVE_WRITES: 'true', E2E_TARGET_ENV: 'prod' } },
      { label: 'target live', env: { E2E_ALLOW_LIVE_CRUD: 'true', E2E_TARGET_ENV: 'live' } },
      { label: 'unknown target value', env: { E2E_ALLOW_LIVE_WRITES: 'true', E2E_TARGET_ENV: 'unknown' } },
      { label: 'whitespace-only target', env: { E2E_ALLOW_LIVE_CRUD: 'true', E2E_TARGET_ENV: '   ' } },
      { label: 'uppercase production-like', env: { E2E_ALLOW_LIVE_WRITES: 'true', E2E_TARGET_ENV: 'PRODUCTION' } },
    ];

    for (const { label, env } of rejectCases) {
      restoreEnv(rememberEnv(ENV_KEYS));
      Object.entries(env).forEach(([k, v]) => {
        if (v) process.env[k] = v;
        else delete process.env[k];
      });
      if (!('E2E_ALLOW_LIVE_READS' in env)) process.env.E2E_ALLOW_LIVE_READS = 'true';

      const rt = reloadRuntime();
      assert.throws(() => rt.assertMutationTarget(), Error, label);
      console.log(`PASS: reject mutation - ${label}`);
    }

    // write permission still required (not just target)
    {
      delete process.env.E2E_TARGET_ENV;
      process.env.E2E_ALLOW_LIVE_READS = 'true';
      delete process.env.E2E_ALLOW_LIVE_WRITES;
      delete process.env.E2E_ALLOW_LIVE_CRUD;

      const rt = reloadRuntime();
      assert.throws(() => rt.assertLiveWritesEnabled(), /E2E_ALLOW_LIVE_WRITES must be exactly true/);
    }
    console.log('PASS: write permission still required');

    // CRUD with reads+writes+target passes (runtime assertLiveCrudEnabled checks reads then writes)
    {
      process.env.E2E_TARGET_ENV = 'test';
      process.env.E2E_ALLOW_LIVE_READS = 'true';
      process.env.E2E_ALLOW_LIVE_WRITES = 'true';
      process.env.E2E_ALLOW_LIVE_CRUD = 'true';

      const rt = reloadRuntime();
      rt.assertLiveCrudEnabled();
    }
    console.log('PASS: CRUD with all flags and target passes');

    // ── Allowed mutation-target cases ────────────────────────────
    const allowCases = ['local', 'test', 'testing', 'staging', 'preview'];
    for (const target of allowCases) {
      restoreEnv(rememberEnv(ENV_KEYS));
      process.env.E2E_ALLOW_LIVE_WRITES = 'true';
      process.env.E2E_TARGET_ENV = target;

      const rt = reloadRuntime();
      rt.assertMutationTarget();
      rt.assertLiveWritesEnabled();
      console.log(`PASS: allow mutation target - ${target}`);
    }

    // ── Error message does not contain environment values ────────
    {
      delete process.env.E2E_TARGET_ENV;
      process.env.E2E_ALLOW_LIVE_WRITES = 'true';

      const rt = reloadRuntime();
      try {
        rt.assertLiveWritesEnabled();
        throw new Error('Should have thrown');
      } catch (e) {
        const msg = e.message;
        assert.equal(msg.includes('https://'), false, 'Should not contain URL protocol');
        assert.equal(msg.includes('Bearer'), false, 'Should not contain Bearer');
        assert.match(msg, /E2E_TARGET_ENV/);
      }
    }
    console.log('PASS: error message does not contain credentials or URLs');

    // ── Guard does not mutate process.env ────────────────────────
    {
      restoreEnv(rememberEnv(ENV_KEYS));
      process.env.E2E_TARGET_ENV = 'test';
      process.env.E2E_ALLOW_LIVE_WRITES = 'true';
      process.env.E2E_FEATURE = 'original';

      const before = JSON.stringify(process.env.E2E_FEATURE);
      const rt = reloadRuntime();
      rt.assertMutationTarget();
      const after = JSON.stringify(process.env.E2E_FEATURE);
      assert.equal(before, after);
    }
    console.log('PASS: guard does not mutate process.env');

    // ── Deterministic result ─────────────────────────────────────
    {
      process.env.E2E_TARGET_ENV = 'staging';
      process.env.E2E_ALLOW_LIVE_WRITES = 'true';

      const rt1 = reloadRuntime();
      const rt2 = reloadRuntime();
      rt1.assertMutationTarget();
      rt2.assertMutationTarget();
    }
    console.log('PASS: deterministic results');

    console.log('\nAll e2e-runtime-safety tests passed.');
  } finally {
    restoreEnv(snapshot);
    clearModule(RUNTIME_PATH);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
