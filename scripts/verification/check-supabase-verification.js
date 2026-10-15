'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const VERIFICATION_DIR = path.join(ROOT, 'supabase', 'verification');

const EXPECTED_FILES = [
  '20260618_validate_order_review_workflow.sql',
  '20260618_verify_remote_order_workflow.sql',
  '20260622_verify_user_store_visibility.sql',
  '20260623110000_verify_order_resubmit_workflow.sql',
  '20260630000000_verify_user_deactivation.sql',
  '20260630210000_verify_function_execution_grants.sql',
  '20260706_verify_correct_stock_lifecycle.sql',
  '20260707_verify_admin_stock_receipt_corrections.sql',
  '20260708_verify_stock_user_visibility.sql',
];

const DESTRUCTIVE_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
  'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE',
  'CALL', 'DO',
];

const results = [];
let allOk = true;

function ok(message) {
  results.push({ status: 'OK', message });
  console.log(`  OK  ${message}`);
}

function fail(message) {
  results.push({ status: 'FAIL', message });
  console.log(`  FAIL ${message}`);
  allOk = false;
}

function stripSqlComments(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function checkDestructive(sql, file) {
  const cleaned = stripSqlComments(sql);
  const upper = cleaned.toUpperCase();

  for (const kw of DESTRUCTIVE_KEYWORDS) {
    const re = new RegExp('\\b' + kw + '\\b');
    if (re.test(upper)) {
      fail(`Destructive keyword "${kw}" found in ${file}`);
    }
  }
}

async function run() {
  console.log('Static verification SQL asset check');
  console.log(`Directory: ${VERIFICATION_DIR}\n`);

  // Directory exists
  if (!fs.existsSync(VERIFICATION_DIR)) {
    fail(`Verification directory does not exist: ${VERIFICATION_DIR}`);
    return { allOk, results };
  }
  ok('Verification directory exists');

  // Expected files discovered
  const actualFiles = fs.readdirSync(VERIFICATION_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const expected of EXPECTED_FILES) {
    if (!actualFiles.includes(expected)) {
      fail(`Expected file not found: ${expected}`);
    } else {
      ok(`Expected file present: ${expected}`);
    }
  }

  // Check for unexpected .sql files
  for (const f of actualFiles) {
    if (!EXPECTED_FILES.includes(f)) {
      fail(`Unexpected .sql file in verification directory: ${f}`);
    }
  }

  // File content checks
  for (const file of EXPECTED_FILES) {
    const filePath = path.join(VERIFICATION_DIR, file);

    if (!fs.existsSync(filePath)) continue;

    // Readable
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      fail(`Cannot read ${file}: ${e.message}`);
      continue;
    }
    ok(`Readable: ${file} (${content.length} bytes)`);

    // Non-empty
    if (content.trim().length === 0) {
      fail(`Empty file: ${file}`);
      continue;
    }
    ok(`Non-empty: ${file}`);

    // Destructive keyword check
    checkDestructive(content, file);

    // Must be read-only (SELECT-based)
    const cleaned = stripSqlComments(content).toUpperCase().trim();
    if (!cleaned.startsWith('SELECT')) {
      fail(`File does not start with SELECT: ${file}`);
    } else {
      ok(`Starts with SELECT: ${file}`);
    }
  }

  // Summary
  const okCount = results.filter((r) => r.status === 'OK').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log(`\n${okCount} passed, ${failCount} failed.`);
  console.log(`This check validates verification SQL assets locally.`);
  console.log(`It does NOT connect to a database or execute SQL remotely.`);
  console.log(`Live verification against a Supabase project requires`);
  console.log(`a confirmed non-production target, explicit approval,`);
  console.log(`and a read-only execution mechanism.`);

  if (!allOk) {
    process.exitCode = 1;
  }

  return { allOk, results };
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Fatal error:', error);
    process.exitCode = 2;
  });
}

module.exports = { run };
