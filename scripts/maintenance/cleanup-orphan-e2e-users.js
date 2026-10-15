// cleanup-orphan-e2e-users.js
// One-time script: delete two pre-existing E2E orphan auth users.
// Safety: dry-run by default, --confirm required for deletion.
// Loads env files directly (no E2E spec dependency).

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key) || !String(process.env[key] || '').trim()) {
      process.env[key] = value;
    }
  }
}

// Load env files from project root
var rootDir = path.resolve(__dirname, '..', '..');
loadEnvFile(path.join(rootDir, '.env'));
loadEnvFile(path.join(rootDir, '.env.e2e'));

// ---- Config ----
var SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
var SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
var TEST_DOMAIN = (process.env.E2E_TEST_EMAIL_DOMAIN || '').replace(/^@+/, '').trim();
var CONFIRM = process.argv.includes('--confirm');

// ---- Target orphans ----
// Identified by live DB verification: auth users with no profiles.
var TARGETS = [
  {
    id: '6ea04e26-d9f2-473a-9a3c-09918416bbec',
    email: 'e2e-user-eor-1782230547415-26951d-req@dominio-valido.com',
  },
  {
    id: 'f0215205-d2d5-4aa5-912f-272dc2677475',
    email: 'e2e-user-eor-1782230443357-bd3a38-req@dominio-valido.com',
  },
];

// ---- Helpers ----
function authHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };
}

async function supabaseGet(path) {
  var url = SUPABASE_URL + path;
  var resp = await fetch(url, { method: 'GET', headers: authHeaders() });
  var text = await resp.text();
  var data = text ? JSON.parse(text) : null;
  if (!resp.ok) {
    var err = new Error((data && (data.message || data.error || data.msg)) || 'HTTP ' + resp.status);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function supabaseDelete(path) {
  var url = SUPABASE_URL + path;
  var resp = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  var text = await resp.text();
  var data = text ? JSON.parse(text) : null;
  if (!resp.ok) {
    var err = new Error((data && (data.message || data.error || data.msg)) || 'HTTP ' + resp.status);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ---- Safety checks per target ----
async function inspectCandidate(target) {
  var result = {
    target: target,
    checks: {},
    allPass: false,
  };

  // C1: Resolve actual auth user
  try {
    var authUser = await supabaseGet('/auth/v1/admin/users/' + target.id);
    result.authUser = authUser;
    result.checks['auth_user_resolved'] = { pass: true, detail: 'Auth user exists: ' + authUser.email };
  } catch (err) {
    if (err.status === 404) {
      result.checks['auth_user_resolved'] = { pass: false, detail: 'Auth user not found (404). Already deleted or never existed.' };
      return result;
    }
    result.checks['auth_user_resolved'] = { pass: false, detail: 'Auth GET failed: ' + err.message };
    return result;
  }

  // C2: Email matches target
  var email = (result.authUser.email || '').toLowerCase();
  var expectedEmail = target.email.toLowerCase();
  result.checks['email_matches'] = {
    pass: email === expectedEmail,
    detail: email === expectedEmail ? 'Email matches: ' + email : 'Email mismatch: got "' + email + '", expected "' + expectedEmail + '"',
  };
  if (!result.checks['email_matches'].pass) return result;

  // C3: Email ends with E2E domain
  result.checks['e2e_domain'] = {
    pass: TEST_DOMAIN && email.endsWith('@' + TEST_DOMAIN),
    detail: TEST_DOMAIN ? 'Domain: ' + email.split('@')[1] + (email.endsWith('@' + TEST_DOMAIN) ? ' (matched)' : ' (expected ' + TEST_DOMAIN + ')') : 'E2E_TEST_EMAIL_DOMAIN not configured',
  };
  if (!result.checks['e2e_domain'].pass) return result;

  // C4: Email starts with e2e-user-
  result.checks['e2e_user_prefix'] = {
    pass: email.startsWith('e2e-user-'),
    detail: email.startsWith('e2e-user-') ? 'Prefix matched' : 'Email does not start with e2e-user-',
  };
  if (!result.checks['e2e_user_prefix'].pass) return result;

  // C5: Role is not ADMIN
  var role = ((result.authUser.app_metadata && result.authUser.app_metadata.role) || '').toLowerCase();
  result.checks['not_admin'] = {
    pass: role !== 'admin',
    detail: role !== 'admin' ? 'Role: ' + (role || '(none)') : 'REFUSING ADMIN user',
  };
  if (!result.checks['not_admin'].pass) return result;

  // C6: Profile absence check
  try {
    var profiles = await supabaseGet('/rest/v1/profiles?select=id,email,role,name&id=eq.' + encodeURIComponent(target.id));
    var profile = Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;
    if (profile) {
      // Profile exists — check E2E marker
      var profileEmail = (profile.email || '').toLowerCase();
      var hasE2EMarker = profileEmail.startsWith('e2e-user-') && profileEmail.endsWith('@' + TEST_DOMAIN);
      var profileName = (profile.name || '');
      result.checks['profile_check'] = {
        pass: true,
        detail: 'Profile EXISTS: email=' + profileEmail + ' role=' + (profile.role || '') + ' name=' + profileName + ' (e2e=' + hasE2EMarker + ')',
        hasProfile: true,
        hasE2EMarker: hasE2EMarker,
      };
    } else {
      result.checks['profile_check'] = {
        pass: true,
        detail: 'Profile absent (confirmed orphan)',
        hasProfile: false,
      };
    }
  } catch (err) {
    result.checks['profile_check'] = { pass: false, detail: 'Profile query failed: ' + err.message };
    return result;
  }

  result.allPass = true;
  return result;
}

async function deleteTarget(inspection) {
  var target = inspection.target;
  var failures = [];

  // 1. Delete audit_logs if profile exists
  if (inspection.checks['profile_check'] && inspection.checks['profile_check'].hasProfile) {
    try {
      await supabaseDelete('/rest/v1/audit_logs?user_id=eq.' + encodeURIComponent(target.id));
      console.log('  [OK] audit_logs deleted for ' + target.id);
    } catch (err) {
      failures.push('audit_logs DELETE: ' + err.message);
    }
  }

  // 2. Delete Auth user (GoTrue Admin API)
  try {
    await supabaseDelete('/auth/v1/admin/users/' + encodeURIComponent(target.id));
    console.log('  [OK] Auth user deleted: ' + target.id);
  } catch (err) {
    failures.push('Auth DELETE: ' + err.message);
  }

  // 3. Verify Auth user gone (404)
  try {
    await supabaseGet('/auth/v1/admin/users/' + encodeURIComponent(target.id));
    failures.push('Auth user still exists after delete: ' + target.id);
  } catch (err) {
    if (err.status === 404) {
      console.log('  [OK] Auth 404 confirmed: ' + target.id);
    } else {
      failures.push('Auth verify unexpected: ' + err.message);
    }
  }

  // 4. Verify profiles gone
  try {
    var profiles = await supabaseGet('/rest/v1/profiles?select=id&id=eq.' + encodeURIComponent(target.id));
    if (Array.isArray(profiles) && profiles.length > 0) {
      failures.push('Profile still exists: ' + target.id);
    } else {
      console.log('  [OK] No profile remains: ' + target.id);
    }
  } catch (err) {
    failures.push('Profile verify: ' + err.message);
  }

  // 5. Verify user_stores gone
  try {
    var stores = await supabaseGet('/rest/v1/user_stores?select=user_id&user_id=eq.' + encodeURIComponent(target.id));
    if (Array.isArray(stores) && stores.length > 0) {
      failures.push('user_stores still exist: ' + target.id + ' count=' + stores.length);
    } else {
      console.log('  [OK] No user_stores remain: ' + target.id);
    }
  } catch (err) {
    failures.push('user_stores verify: ' + err.message);
  }

  // 6. Verify audit_logs gone
  try {
    var logs = await supabaseGet('/rest/v1/audit_logs?select=id&user_id=eq.' + encodeURIComponent(target.id));
    if (Array.isArray(logs) && logs.length > 0) {
      failures.push('audit_logs still exist: ' + target.id + ' count=' + logs.length);
    } else {
      console.log('  [OK] No audit_logs remain: ' + target.id);
    }
  } catch (err) {
    failures.push('audit_logs verify: ' + err.message);
  }

  if (failures.length > 0) {
    console.log('  [FAIL] ' + target.id + ':');
    failures.forEach(function (f) { console.log('         ' + f); });
  } else {
    console.log('  [PASS] All verifications passed for ' + target.id);
  }

  return { id: target.id, failures: failures };
}

// ---- Main ----
async function main() {
  console.log('=== Orphan E2E Auth User Cleanup ===');
  console.log('Mode: ' + (CONFIRM ? 'LIVE (--confirm)' : 'DRY RUN (use --confirm to delete)'));
  console.log('Supabase URL: ' + SUPABASE_URL);
  console.log('E2E test domain: ' + TEST_DOMAIN);
  console.log('Targets: ' + TARGETS.length);
  console.log('');

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TEST_DOMAIN) {
    console.error('Missing env vars. Ensure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_TEST_EMAIL_DOMAIN are set.');
    process.exit(1);
  }

  var allResults = [];

  for (var i = 0; i < TARGETS.length; i++) {
    var target = TARGETS[i];
    console.log('--- Target ' + (i + 1) + ': ' + target.id + ' ---');
    console.log('  Expected email: ' + target.email);

    var inspection = await inspectCandidate(target);
    allResults.push(inspection);

    if (!inspection.checks['auth_user_resolved'] || !inspection.checks['auth_user_resolved'].pass) {
      console.log('  SKIP: ' + (inspection.checks['auth_user_resolved'] ? inspection.checks['auth_user_resolved'].detail : 'Auth user check not run'));
      console.log('');
      continue;
    }

    // Print safety check results
    var keys = Object.keys(inspection.checks);
    var allGood = true;
    for (var k = 0; k < keys.length; k++) {
      var check = inspection.checks[keys[k]];
      var icon = check.pass ? '[PASS]' : '[FAIL]';
      console.log('  ' + icon + ' ' + keys[k] + ': ' + check.detail);
      if (!check.pass) allGood = false;
    }

    if (!allGood) {
      console.log('  SKIP: Safety checks failed for ' + target.id);
      console.log('');
      continue;
    }

    console.log('  All safety checks passed.');

    if (CONFIRM) {
      console.log('  Deleting...');
      var delResult = await deleteTarget(inspection);
      console.log('');
    } else {
      console.log('  Dry-run: would delete. Use --confirm to proceed.');
      console.log('');
    }
  }

  // Summary
  console.log('=== Summary ===');
  var deleted = 0;
  var skipped = 0;
  var failed = 0;
  for (var i = 0; i < allResults.length; i++) {
    var r = allResults[i];
    var tag;
    if (!r.checks['auth_user_resolved'] || !r.checks['auth_user_resolved'].pass) {
      tag = 'NOT_FOUND';
    } else if (!r.allPass) {
      tag = 'SKIPPED';
    } else if (CONFIRM) {
      tag = 'DELETED';
    } else {
      tag = 'DRY_RUN';
    }

    switch (tag) {
      case 'DELETED': deleted++; break;
      case 'SKIPPED': case 'NOT_FOUND': skipped++; break;
    }

    console.log('  ' + r.target.id + ' (' + r.target.email + '): ' + tag);
  }
  console.log('');
  console.log('Deleted: ' + deleted + ' | Skipped/Not found: ' + skipped + ' | Total: ' + allResults.length);
  if (!CONFIRM && deleted === 0) {
    console.log('Dry-run completed. No records modified.');
  }
}

main().catch(function (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
});
