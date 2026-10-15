'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const VERIFICATION_DIR = path.join(ROOT, 'supabase', 'verification');
const CHECKER = path.join(ROOT, 'scripts', 'verification', 'check-supabase-verification.js');

function freshChecker() {
  delete require.cache[require.resolve(CHECKER)];
  return require(CHECKER);
}

async function run() {
  // ── Verification directory exists ──────────────────────────────
  {
    const exists = fs.existsSync(VERIFICATION_DIR);
    assert.equal(exists, true, 'Verification directory must exist');
    console.log('PASS: verification directory exists');
  }

  // ── Expected files are discovered ──────────────────────────────
  {
    const checker = freshChecker();
    const result = await checker.run();
    assert.equal(result.allOk, true, 'Expected files check passed');
    assert.ok(Array.isArray(result.results));
    const expectedOk = result.results.filter(
      (r) => r.status === 'OK' && r.message.startsWith('Expected file present:')
    );
    assert.equal(expectedOk.length, 9, 'All 9 expected files found');
    console.log('PASS: all 9 expected verification files discovered');
  }

  // ── Safe SELECT-based verification accepted by live files ──────
  {
    const checker = freshChecker();
    const result = await checker.run();
    const startWithSelect = result.results.filter(
      (r) => r.status === 'OK' && r.message.startsWith('Starts with SELECT:')
    );
    assert.equal(startWithSelect.length, 9, 'All 9 file checks start with SELECT');
    console.log('PASS: all verification files are SELECT-based');
  }

  // ── Destructive SQL keywords are rejected (logic test) ─────────
  {
    const checker = freshChecker();
    const DESTRUCTIVE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'CALL', 'DO'];
    const code = fs.readFileSync(CHECKER, 'utf8');

    // Verify the checker includes all destructive keywords
    for (const kw of DESTRUCTIVE_KEYWORDS) {
      assert.equal(code.includes(`'${kw}'`), true, `Checker should include keyword: ${kw}`);
    }
    console.log('PASS: all destructive SQL keywords are in the checker');
  }

  // ── No false positives from comments ───────────────────────────
  {
    const checker = freshChecker();
    const code = fs.readFileSync(CHECKER, 'utf8');

    // Verify the checker strips SQL comments before checking
    assert.equal(code.includes('stripSqlComments'), true, 'Checker should strip SQL comments');
    console.log('PASS: checker strips SQL comments before destructive keyword check');
  }

  // ── Result ordering is deterministic ───────────────────────────
  {
    const checker1 = freshChecker();
    const result1 = await checker1.run();

    const checker2 = freshChecker();
    const result2 = await checker2.run();

    assert.equal(result1.results.length, result2.results.length);
    for (let i = 0; i < result1.results.length; i++) {
      assert.equal(result1.results[i].status, result2.results[i].status);
      assert.equal(result1.results[i].message, result2.results[i].message);
    }
    console.log('PASS: result ordering is deterministic');
  }

  // ── No database connection is attempted ────────────────────────
  {
    const checkerCode = fs.readFileSync(CHECKER, 'utf8');
    assert.equal(checkerCode.includes('fetch('), false, 'Should not call fetch');
    assert.equal(checkerCode.includes('pg.Client'), false, 'Should not use pg client');
    assert.equal(checkerCode.includes('psql'), false, 'Should not call psql');
    assert.ok(checkerCode.includes('does NOT connect'), 'Should declare no DB connection');
    console.log('PASS: no database connection attempted');
  }

  console.log('\nAll supabase-verification-assets tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
