const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const { supabaseRest } = require('./helpers/disposable-user-fixtures');
const { assertMutationTarget } = require('./helpers/runtime');

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

loadEnvFile('.env');
loadEnvFile('.env.e2e');

function assertLiveCrudEnabled() {
  if (process.env.E2E_ALLOW_LIVE_CRUD !== 'true') {
    throw new Error('E2E_ALLOW_LIVE_CRUD must be exactly true before live CRUD can run.');
  }
  assertMutationTarget();
}

function getAdminCredentials() {
  return {
    email: String(process.env.E2E_ADMIN_EMAIL || '').trim(),
    password: String(process.env.E2E_ADMIN_PASSWORD || ''),
  };
}

function uniqueCodigo() {
  return crypto.randomBytes(4).toString('hex').slice(0, 8);
}

function storeName(codigo, label) {
  return 'E2ESTORE_' + codigo + '_' + label;
}

async function loginAsAdmin(page) {
  var creds = getAdminCredentials();
  await page.goto('/login');
  await page.locator('#login-form').waitFor({ state: 'visible' });
  await page.locator('#login-email').fill(creds.email);
  await page.locator('#login-senha').fill(creds.password);
  await page.locator('#login-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.locator('#sidebar-username').waitFor({ state: 'visible' });
}

async function openLojasPage(page) {
  await page.goto('/lojas');
  await page.locator('#loja-nova').waitFor({ state: 'visible' });
}

async function openCreateModal(page) {
  await page.locator('#loja-nova').click();
  await page.locator('#modal-loja').waitFor({ state: 'visible' });
}

async function fillStoreForm(page, data) {
  if (data.codigo !== undefined) await page.locator('#fl-codigo').fill(data.codigo);
  if (data.nome !== undefined) await page.locator('#fl-nome').fill(data.nome);
  if (data.marca !== undefined) await page.locator('#fl-marca').selectOption(data.marca);
  if (data.cidade !== undefined) await page.locator('#fl-cidade').fill(data.cidade);
  if (data.estado !== undefined) await page.locator('#fl-estado').fill(data.estado);
  if (data.ativo !== undefined) await page.locator('#fl-ativo').selectOption(String(data.ativo));
}

async function saveAndWait(page) {
  await page.locator('#modal-loja-btn-save').click();
  // success: modal closes, toast shows briefly
  await page.locator('#modal-loja').waitFor({ state: 'hidden', timeout: 15000 });
  // give table refresh time to settle
  await page.waitForTimeout(1500);
}

async function getStoreRow(page, codigo) {
  return page.locator('#tbody-lojas tr').filter({ hasText: codigo });
}

async function clickEditStore(page, codigo) {
  var row = await getStoreRow(page, codigo);
  var editBtn = row.locator('[data-store-action="edit"]');
  await editBtn.waitFor({ state: 'visible', timeout: 10000 });
  await editBtn.click();
  await page.locator('#modal-loja').waitFor({ state: 'visible' });
}

async function clickToggleStore(page, codigo) {
  var row = await getStoreRow(page, codigo);
  var toggleBtn = row.locator('[data-store-action="toggle"]');
  await toggleBtn.waitFor({ state: 'visible', timeout: 10000 });
  await toggleBtn.click();
  await page.waitForTimeout(2000);
}

test.describe('Store CRUD E2E', function () {
  // Track every store codigo created by this spec for DB-level cleanup.
  // Pushed as early as safely possible — right after codigo generation,
  // before the first Supabase mutation. If the test fails partway,
  // afterAll still deletes the store (DELETE is idempotent).
  var disposableStoreCodigos = [];
  var runId = Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex');

  // Cleanup runs after ALL tests complete, even if some failed.
  // Does NOT depend on page fixture — uses service_role REST API directly.
  test.afterAll(async function () {
    if (disposableStoreCodigos.length === 0) return;

    var failures = [];

    // 1. Delete every tracked store via Supabase REST (bypasses RLS via service_role)
    for (var codigo of disposableStoreCodigos) {
      try {
        await supabaseRest(`/rest/v1/lojas?codigo=eq.${encodeURIComponent(codigo)}`, { method: 'DELETE' });
      } catch (err) {
        failures.push('DELETE failed for codigo ' + codigo + ': ' + err.message);
      }
    }

    // 2. Verify directly against the database that none remain
    for (var codigo of disposableStoreCodigos) {
      try {
        var check = await supabaseRest(`/rest/v1/lojas?select=id&codigo=eq.${encodeURIComponent(codigo)}`, { method: 'GET' });
        if (Array.isArray(check) && check.length > 0) {
          failures.push('Store still exists after delete: codigo=' + codigo);
        }
      } catch (err) {
        failures.push('VERIFY failed for codigo ' + codigo + ': ' + err.message);
      }
    }

    // 3. Report every failure clearly; Playwright surfaces this in the run summary
    if (failures.length > 0) {
      throw new Error('Cleanup integrity failure [' + runId + ']:\n' + failures.join('\n'));
    }
  });

  test('has no horizontal overflow in modal', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);
    await openCreateModal(page);

    var panel = page.locator('#modal-loja > div');
    var box = await panel.boundingBox();

    expect(box.width).toBeLessThanOrEqual(540);

    var hasOverflow = await panel.evaluate(function (el) {
      return el.scrollWidth > el.clientWidth;
    });
    expect(hasOverflow).toBe(false);

    await page.locator('[onclick="fecharModalLoja()"]').first().click();
  });

  test('creates disposable store without cidade/estado', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();
    disposableStoreCodigos.push(codigo);
    var nome = storeName(codigo, 'sem-cidade');

    await openCreateModal(page);
    await fillStoreForm(page, { codigo: codigo, nome: nome, marca: 'QDB' });
    await saveAndWait(page);

    var row = await getStoreRow(page, codigo);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('-');
  });

  test('creates a disposable store with cidade and estado', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();
    disposableStoreCodigos.push(codigo);
    var nome = storeName(codigo, 'com-cidade');

    await openCreateModal(page);
    await fillStoreForm(page, { codigo: codigo, nome: nome, marca: 'O Boticario', cidade: 'São Paulo', estado: 'SP' });
    await saveAndWait(page);

    var row = await getStoreRow(page, codigo);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText(codigo);
    await expect(row).toContainText(nome);
    await expect(row).toContainText('O Boticario');
    await expect(row).toContainText('São Paulo/SP');
  });

  test('persists valid uppercase UF', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();
    disposableStoreCodigos.push(codigo);
    var nome = storeName(codigo, 'upper-uf');

    await openCreateModal(page);
    // submit lowercase 'rj' — frontend uppercases it
    await fillStoreForm(page, { codigo: codigo, nome: nome, marca: 'O Boticario', cidade: 'Rio', estado: 'rj' });
    await saveAndWait(page);

    var row = await getStoreRow(page, codigo);
    await expect(row).toContainText('Rio/RJ', { timeout: 10000 });
  });

  test('rejects invalid UF', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();

    await openCreateModal(page);
    await fillStoreForm(page, { codigo: codigo, nome: storeName(codigo, 'bad-uf'), marca: 'O Boticario', estado: 'XX' });
    await page.locator('#modal-loja-btn-save').click();

    // Toast appears with UF error, modal stays open
    await expect(page.locator('#toast:not(.hidden)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#modal-loja')).toBeVisible();

    // Close without saving
    await page.locator('[onclick="fecharModalLoja()"]').first().click();
    await page.locator('#modal-loja').waitFor({ state: 'hidden' });
  });

  test('edits name, brand, city, state, and active status', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();
    disposableStoreCodigos.push(codigo);
    var nome = storeName(codigo, 'para-editar');

    await openCreateModal(page);
    await fillStoreForm(page, { codigo: codigo, nome: nome, marca: 'QDB', cidade: 'Rio de Janeiro', estado: 'RJ' });
    await saveAndWait(page);

    var row = await getStoreRow(page, codigo);
    await expect(row).toBeVisible({ timeout: 10000 });

    // edit
    await clickEditStore(page, codigo);
    await fillStoreForm(page, { nome: storeName(codigo, 'editado'), marca: 'O Boticario', cidade: 'Niterói', estado: 'RJ' });
    await saveAndWait(page);

    var updatedRow = await getStoreRow(page, codigo);
    await expect(updatedRow).toContainText(storeName(codigo, 'editado'), { timeout: 10000 });
    await expect(updatedRow).toContainText('O Boticario');
    await expect(updatedRow).toContainText('Niterói/RJ');

    // deactivate — store remains visible with Inativa badge
    await clickToggleStore(page, codigo);
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.locator('#confirm-modal-confirm').click();
    await expect(page.locator('#toast:not(.hidden)')).toContainText('Loja desativada com sucesso', { timeout: 10000 });
    var deactivatedRow = await getStoreRow(page, codigo);
    await expect(deactivatedRow).toBeVisible({ timeout: 10000 });
    await expect(deactivatedRow.locator('.stores-status-badge')).toContainText('Inativa');
  });

  test('reactivates a deactivated store', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();
    disposableStoreCodigos.push(codigo);
    var nome = storeName(codigo, 'reativar');

    await openCreateModal(page);
    await fillStoreForm(page, { codigo: codigo, nome: nome, marca: 'O Boticario', cidade: 'Recife', estado: 'PE' });
    await saveAndWait(page);

    var row = await getStoreRow(page, codigo);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('.stores-status-badge')).toContainText('Ativa');

    // deactivate
    await clickToggleStore(page, codigo);
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
    await page.locator('#confirm-modal-confirm').click();
    await expect(page.locator('#toast:not(.hidden)')).toContainText('Loja desativada com sucesso', { timeout: 10000 });

    var inactiveRow = await getStoreRow(page, codigo);
    await expect(inactiveRow).toBeVisible({ timeout: 10000 });
    await expect(inactiveRow.locator('.stores-status-badge')).toContainText('Inativa');

    // edit + reactivate
    await clickEditStore(page, codigo);
    await page.locator('#fl-ativo').selectOption('true');
    await saveAndWait(page);

    var reactivatedRow = await getStoreRow(page, codigo);
    await expect(reactivatedRow).toBeVisible({ timeout: 10000 });
    await expect(reactivatedRow.locator('.stores-status-badge')).toContainText('Ativa');
  });

  test('modal hydration on edit shows correct values', async function ({ page }) {
    assertLiveCrudEnabled();
    await loginAsAdmin(page);
    await openLojasPage(page);

    var codigo = uniqueCodigo();
    disposableStoreCodigos.push(codigo);
    var nome = storeName(codigo, 'hydrat');

    await openCreateModal(page);
    await fillStoreForm(page, { codigo: codigo, nome: nome, marca: 'QDB', cidade: 'Belo Horizonte', estado: 'MG' });
    await saveAndWait(page);

    await clickEditStore(page, codigo);

    await expect(page.locator('#modal-loja-titulo')).toHaveText('Editar Loja');
    await expect(page.locator('#fl-codigo')).toHaveValue(codigo);
    await expect(page.locator('#fl-nome')).toHaveValue(nome);
    await expect(page.locator('#fl-marca')).toHaveValue('QDB');
    await expect(page.locator('#fl-cidade')).toHaveValue('Belo Horizonte');
    await expect(page.locator('#fl-estado')).toHaveValue('MG');
    await expect(page.locator('#fl-ativo')).toHaveValue('true');
    await expect(page.locator('#fl-ativo-wrapper')).toBeVisible();
    await expect(page.locator('#modal-loja-btn-save')).toContainText('Salvar alterações');

    await page.locator('[onclick="fecharModalLoja()"]').first().click();
  });
});
