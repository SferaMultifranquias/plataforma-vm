const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

async function run() {
  var moduleCode = read(path.join('public', 'js', 'pages', 'account', 'account-module.js'));
  var indexHtml = read(path.join('public', 'index.html'));

  // ── Module structure ───────────────────────────────────────────────
  assert.match(moduleCode, /global\.AccountModule\s*=\s*\{/);
  assert.match(moduleCode, /openMinhaConta/);
  assert.match(moduleCode, /closeMinhaConta/);
  console.log('PASS: AccountModule exports openMinhaConta and closeMinhaConta');

  assert.match(moduleCode, /function handleSaveEmail/);
  assert.match(moduleCode, /function handleSavePassword/);
  assert.match(moduleCode, /function handleClose/);
  console.log('PASS: handleSaveEmail, handleSavePassword, handleClose defined');

  // ── Uses globals (no deps object) ──────────────────────────────────
  assert.match(moduleCode, /global\.getCurrentUser/);
  assert.match(moduleCode, /global\.sb/);
  assert.match(moduleCode, /global\.showToast/);
  console.log('PASS: module reads globals directly, no deps object');

  // ── Auth safety: always re-authenticate before sensitive changes ───
  assert.match(moduleCode, /signInWithPassword/);
  var reauthCount = moduleCode.match(/signInWithPassword/g);
  assert.equal(reauthCount && reauthCount.length, 2, 'signInWithPassword called in both email and password handlers');
  console.log('PASS: email and password handlers both re-authenticate');

  // ── Password validation ────────────────────────────────────────────
  assert.match(moduleCode, /newPass\.length < 8/);
  assert.match(moduleCode, /A nova senha deve ter ao menos 8 caracteres/);
  assert.match(moduleCode, /não corresponde/);
  assert.match(moduleCode, /Senha atual incorreta/);
  console.log('PASS: password validation checks present');

  // ── Email validation ────────────────────────────────────────────────
  assert.match(moduleCode, /E-mail inválido/);
  assert.match(moduleCode, /Informe sua senha atual/);
  assert.match(moduleCode, /Confirme o novo e-mail/);
  console.log('PASS: email validation checks present');

  // ── Close behavior ──────────────────────────────────────────────────
  assert.match(moduleCode, /bindOnce.*account-close-btn/);
  assert.match(moduleCode, /bindOnceOverlay.*account-overlay/);
  assert.match(moduleCode, /addEventListener\('keydown'/);
  assert.match(moduleCode, /e\.key === 'Escape'/);
  assert.match(moduleCode, /dataset\.boundClose/);
  assert.match(moduleCode, /accountEscapeBound/);
  console.log('PASS: header close, overlay click, Escape key handlers');

  // ── Open trigger auto-bound on DOMContentLoaded ────────────────────
  assert.match(moduleCode, /document\.addEventListener\('DOMContentLoaded'/);
  assert.match(moduleCode, /getElementById\('account-open-btn'\)/);
  assert.match(moduleCode, /addEventListener\('click', openMinhaConta\)/);
  console.log('PASS: open trigger auto-bound on DOMContentLoaded');

  // ── Modal structure (users-modal base + account custom classes) ─────
  assert.match(indexHtml, /id="account-modal"[^>]*class="users-modal hidden"/);
  assert.match(indexHtml, /id="account-overlay"[^>]*class="users-modal-backdrop"/);
  assert.match(indexHtml, /class="users-modal-panel account-panel"/);
  assert.match(indexHtml, /role="dialog"/);
  assert.match(indexHtml, /aria-modal="true"/);
  assert.match(indexHtml, /aria-labelledby="account-modal-title"/);
  assert.match(indexHtml, /id="account-close-btn"[^>]*class="users-modal-close"/);
  assert.match(indexHtml, /aria-label="Fechar Minha Conta"/);
  assert.match(indexHtml, /class="users-modal-header"/);
  assert.match(indexHtml, /class="users-modal-body account-body"/);
  assert.match(indexHtml, /class="account-section"/);
  assert.match(indexHtml, /class="account-section-header"/);
  assert.match(indexHtml, /class="account-section-icon"/);
  assert.match(indexHtml, /class="account-section-divider"/);
  assert.match(indexHtml, /class="account-field"/);
  console.log('PASS: modal uses users-modal base + account custom sections, divider');

  // ── Sidebar button in Administracao with same pattern as Pedidos/Novo Pedido ─
  assert.match(indexHtml, /id="account-open-btn"/);
  assert.ok(!indexHtml.includes('href="/minha-conta"'), 'sidebar must not have href to /minha-conta');
  assert.match(indexHtml, /<button id="account-open-btn"[^>]*class="nav-item/);
  assert.match(indexHtml, /w-5 h-5 shrink-0/);
  assert.match(indexHtml, /data-lucide="user-circle"/);
  assert.match(indexHtml, /sidebar-text text-sm whitespace-nowrap/);
  assert.match(indexHtml, /Minha Conta/);
  // Button must be positioned after Administracao header, before usuarios
  var afterAdmin = indexHtml.split(/id="nav-admin"/)[1] || '';
  assert.ok(afterAdmin.indexOf('account-open-btn') < afterAdmin.indexOf('nav-usuarios') || !afterAdmin.includes('nav-usuarios'), 'account-open-btn after nav-admin, before nav-usuarios');
  console.log('PASS: account button in Administracao section with nav-item pattern, no /minha-conta route link');

  // ── Save buttons equal sizing (account-save-btn class) ──────────────
  var modalSection = indexHtml.match(/account-modal[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(modalSection, 'modal markup found in index.html');
  var modalHtml = modalSection[0];
  var saveEmailCount = (modalHtml.match(/id="account-save-email-btn"[^>]*class="account-save-btn"/g) || []).length;
  var savePassCount = (modalHtml.match(/id="account-save-password-btn"[^>]*class="account-save-btn"/g) || []).length;
  assert.equal(saveEmailCount, 1, 'save-email button uses account-save-btn class');
  assert.equal(savePassCount, 1, 'save-password button uses account-save-btn class');
  console.log('PASS: save buttons both use account-save-btn class');

  // ── No route references in module ──────────────────────────────────
  assert.ok(!moduleCode.includes('afterRenderMinhaConta'), 'module must not have afterRenderMinhaConta');
  assert.ok(!moduleCode.includes('navigateTo'), 'module must not have navigateTo');
  console.log('PASS: module has no route-based API or navigation');

  // ── No inline event handlers ───────────────────────────────────────
  assert.doesNotMatch(indexHtml, /\bonclick\s*=\s*['"]/);
  assert.doesNotMatch(moduleCode, /\bonclick\s*=\s*['"]/);
  assert.doesNotMatch(moduleCode, /\bonchange\s*=\s*['"]/);
  assert.doesNotMatch(moduleCode, /\bonsubmit\s*=\s*['"]/);
  assert.doesNotMatch(moduleCode, /\.onclick\s*=\s*function/);
  assert.doesNotMatch(moduleCode, /\.onclick\s*=\s*[a-zA-Z]/);
  assert.doesNotMatch(moduleCode, /new Function\(/);
  assert.doesNotMatch(moduleCode, /eval\(/);
  console.log('PASS: no inline event handlers or eval');

  // ── Module uses dataset.bound for listener dedup ───────────────────
  assert.match(moduleCode, /dataset\.bound/);
  assert.match(moduleCode, /addEventListener/);
  assert.ok(!moduleCode.includes('.onclick'));
  console.log('PASS: module uses dataset.bound and addEventListener');

  // ── Script reference in index.html ─────────────────────────────────
  assert.match(indexHtml, /account\/account-module\.js/);
  assert.match(indexHtml, /account-module\.js\?v=20261116-1/);
  console.log('PASS: account-module.js script referenced in index.html');

  // ── Original field IDs preserved in modal ──────────────────────────
  assert.match(modalHtml, /id="account-current-email"/);
  assert.match(modalHtml, /id="account-new-email"/);
  assert.match(modalHtml, /id="account-email-password"/);
  assert.match(modalHtml, /id="account-password-current"/);
  assert.match(modalHtml, /id="account-password-new"/);
  assert.match(modalHtml, /id="account-password-confirm"/);
  assert.match(modalHtml, /id="account-save-email-btn"/);
  assert.match(modalHtml, /id="account-save-password-btn"/);
  console.log('PASS: all original field IDs preserved');

  console.log('\nAccount module checks ok.');
}

run().catch(function(error) {
  console.error('Account test failed:', error.message);
  process.exitCode = 1;
});
