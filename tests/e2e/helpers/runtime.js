const crypto = require('node:crypto');

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const REJECTED_TARGET_VALUES = new Set([
  'production', 'prod', 'live',
]);

const ALLOWED_TARGET_VALUES = new Set([
  'local', 'test', 'testing', 'staging', 'preview',
]);

function getBaseUrl() {
  return process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
}

function getHostname(baseUrl) {
  return new URL(baseUrl).hostname;
}

function assertMutationTarget() {
  const raw = String(process.env.E2E_TARGET_ENV || '').trim().toLowerCase();
  if (!raw) {
    throw new Error(
      'E2E_TARGET_ENV is required for mutation tests. '
      + 'Set to one of: local, test, testing, staging, preview. '
      + 'See .env.e2e.example for details.'
    );
  }
  if (REJECTED_TARGET_VALUES.has(raw)) {
    throw new Error(
      'E2E_TARGET_ENV rejects production-like target: "' + raw + '". '
      + 'Mutation tests require a non-production environment.'
    );
  }
  if (!ALLOWED_TARGET_VALUES.has(raw) && !REJECTED_TARGET_VALUES.has(raw)) {
    throw new Error(
      'E2E_TARGET_ENV has unknown value: "' + raw + '". '
      + 'Allowed: local, test, testing, staging, preview.'
    );
  }
}

function assertLiveCrudEnabled() {
  assertLiveReadsEnabled();
  assertLiveWritesEnabled();
}

function assertLiveReadsEnabled() {
  if (process.env.E2E_ALLOW_LIVE_READS !== 'true') {
    throw new Error('E2E_ALLOW_LIVE_READS must be exactly true before live reads can run.');
  }
}

function assertLiveWritesEnabled() {
  if (process.env.E2E_ALLOW_LIVE_WRITES !== 'true') {
    throw new Error('E2E_ALLOW_LIVE_WRITES must be exactly true before live writes can run.');
  }
  assertMutationTarget();
}

function warnAboutTarget(baseUrl) {
  const hostname = getHostname(baseUrl);
  console.log(`E2E target host: ${hostname}`);
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    console.warn(`Warning: target host is not localhost: ${hostname}`);
  }
  return hostname;
}

function getAdminCredentials() {
  return {
    email: String(process.env.E2E_ADMIN_EMAIL || '').trim(),
    password: String(process.env.E2E_ADMIN_PASSWORD || ''),
  };
}

function getDisposablePassword() {
  const password = String(process.env.E2E_TEST_USER_PASSWORD || '');
  if (!password) {
    throw new Error('E2E_TEST_USER_PASSWORD is required.');
  }
  return password;
}

function getDisposableEmailDomain() {
  const domain = String(process.env.E2E_TEST_EMAIL_DOMAIN || '').trim().replace(/^@+/, '');
  if (!domain) {
    throw new Error('E2E_TEST_EMAIL_DOMAIN is required.');
  }
  return domain;
}

function buildDisposableEmail() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(3).toString('hex');
  return `e2e-user-${timestamp}-${random}@${getDisposableEmailDomain()}`;
}

module.exports = {
  assertLiveReadsEnabled,
  assertLiveWritesEnabled,
  assertLiveCrudEnabled,
  assertMutationTarget,
  buildDisposableEmail,
  getAdminCredentials,
  getBaseUrl,
  getDisposablePassword,
  getHostname,
  warnAboutTarget,
};
