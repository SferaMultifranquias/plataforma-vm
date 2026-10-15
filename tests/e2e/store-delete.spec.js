const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

const {
  loginAsAdmin,
} = require('./helpers/auth');
const {
  assertLiveCrudEnabled,
  getAdminCredentials,
  warnAboutTarget,
} = require('./helpers/runtime');
const {
  fetchActiveStores,
  supabaseRest,
} = require('./helpers/disposable-user-fixtures');
const {
  readAdminAccessToken,
} = require('./helpers/users-admin');

function buildMarker() {
  return `stdel-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function uniqueCodigo() {
  return crypto.randomBytes(4).toString('hex').slice(0, 8);
}

function storeName(codigo, label) {
  return 'E2ESTORE_' + codigo + '_' + label;
}

async function openLojasPage(page) {
  await page.goto('/lojas');
  await page.locator('#loja-nova').waitFor({ state: 'visible' });
}

async function findStoreInTable(page, name) {
  return page.locator('#tbody-lojas tr', { hasText: name }).first();
}

async function createTestStore(marker) {
  const codigo = uniqueCodigo();
  const name = storeName(codigo, marker);
  const body = {
    codigo,
    nome: name,
    marca: 'O Boticario',
    ativo: true,
    cidade: 'TestCity',
    estado: 'SP',
  };
  const result = await supabaseRest('/rest/v1/lojas', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Prefer: 'return=representation' },
  });
  const id = result && (result.id || (Array.isArray(result) && result.length && result[0].id));
  if (!id) throw new Error('Failed to create test store: no id returned');
  return { id: String(id), name, codigo };
}

if (process.env.E2E_ALLOW_LIVE_READS === 'true'
  && process.env.E2E_ALLOW_LIVE_WRITES === 'true'
  && process.env.E2E_ALLOW_LIVE_CRUD === 'true') {

  test.describe.serial('store admin delete', () => {
    const state = {
      marker: buildMarker(),
      admin: null,
      emptyStore: null,
      linkedStore: null,
      deleteTarget: null,
    };

    test.beforeAll(async () => {
      assertLiveCrudEnabled();

      const admin = getAdminCredentials();
      state.admin = admin;

      try {
        state.emptyStore = await createTestStore(state.marker);
        state.linkedStore = await createTestStore(state.marker);
      } catch (error) {
        console.error('beforeAll setup failed:', error);
        throw error;
      }
    });

    test.afterAll(async () => {
      for (const store of [state.emptyStore, state.linkedStore, state.deleteTarget].filter(Boolean)) {
        const existing = await supabaseRest(
          `/rest/v1/lojas?select=id&id=eq.${store.id}`,
          { method: 'GET' }
        ).catch(() => []);
        if (Array.isArray(existing) && existing.length) {
          await supabaseRest(
            `/rest/v1/user_stores?store_id=eq.${encodeURIComponent(store.id)}`,
            { method: 'DELETE' }
          ).catch(() => {});
          await supabaseRest(
            `/rest/v1/lojas?id=eq.${encodeURIComponent(store.id)}`,
            { method: 'DELETE' }
          ).catch(() => {});
        }
      }
    });

    test('ADMIN deletes store without orders', async ({ page }) => {
      try {
        await test.step('Navigate to lojas and find test store', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          await openLojasPage(page);
          const row = await findStoreInTable(page, state.emptyStore.name);
          await expect(row).toBeVisible({ timeout: 10000 });
        });

        await test.step('Deactivate store first', async () => {
          await page.locator(`[data-store-action="toggle"][data-store-id="${state.emptyStore.id}"]`).click();
          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-confirm').click();
          await expect(page.locator('#toast-msg')).toContainText('Loja desativada com sucesso', { timeout: 10000 });
        });

        await test.step('Delete the store through UI', async () => {
          await page.locator(`[data-store-action="delete"][data-store-id="${state.emptyStore.id}"]`).click();

          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-confirm').click();

          await expect(page.locator('#toast-msg')).toHaveText('Loja excluida com sucesso.', { timeout: 10000 });
        });

        await test.step('Verify store is gone from DB', async () => {
          const check = await supabaseRest(
            `/rest/v1/lojas?select=id&id=eq.${state.emptyStore.id}`,
            { method: 'GET' }
          );
          expect(Array.isArray(check) && check.length).toBe(0);
        });

        state.emptyStore = null;
      } catch (error) {
        throw error;
      }
    });

    test('ADMIN cannot delete store with orders', async ({ page }) => {
      let orderId = null;

      try {
        await test.step('Create order linked to the store', async () => {
          await loginAsAdmin(page, state.admin, { timeout: 20000 });
          const orderResult = await page.evaluate(async ({ store, marker }) => {
            const r = await sb.rpc('create_order', {
              p_brand: 'O Boticario',
              p_store: store.name,
              p_cost_center: '',
              p_purpose: `${marker}-linked`,
              p_justification: '',
              p_priority: 'NORMAL',
              p_notes: marker,
              p_store_id: Number(store.id),
            });
            if (r.error) throw new Error(r.error.message);
            if (!r.data || !r.data.id) throw new Error('create_order returned no id');
            return String(r.data.id);
          }, { store: state.linkedStore, marker: state.marker });
          orderId = orderResult;

          const verify = await supabaseRest(
            `/rest/v1/orders?select=id&id=eq.${orderId}`,
            { method: 'GET' }
          );
          expect(Array.isArray(verify) && verify.length).toBe(1);
        });

        await test.step('Deactivate store first', async () => {
          await openLojasPage(page);
          const row = await findStoreInTable(page, state.linkedStore.name);
          await expect(row).toBeVisible({ timeout: 10000 });

          await page.locator(`[data-store-action="toggle"][data-store-id="${state.linkedStore.id}"]`).click();
          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-confirm').click();
          await expect(page.locator('#toast-msg')).toContainText('Loja desativada com sucesso', { timeout: 10000 });
        });

        await test.step('Try to delete store with orders — blocked', async () => {
          await page.locator(`[data-store-action="delete"][data-store-id="${state.linkedStore.id}"]`).click();

          await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
          await page.locator('#confirm-modal-confirm').click();

          await expect(page.locator('#toast-msg')).toContainText('Store has orders', { timeout: 10000 });
        });

        await test.step('Store still exists after blocked delete', async () => {
          const check = await supabaseRest(
            `/rest/v1/lojas?select=id&id=eq.${state.linkedStore.id}`,
            { method: 'GET' }
          );
          expect(Array.isArray(check) && check.length).toBe(1);
        });
      } finally {
        if (orderId) {
          await supabaseRest(
            `/rest/v1/audit_logs?entity=eq.orders&entity_id=eq.${orderId}`,
            { method: 'DELETE' }
          ).catch(() => {});
          const [items, images] = await Promise.all([
            supabaseRest(`/rest/v1/order_items?order_id=eq.${orderId}&select=id`, { method: 'GET' }).catch(() => []),
            supabaseRest(`/rest/v1/order_images?order_id=eq.${orderId}&select=id`, { method: 'GET' }).catch(() => []),
          ]);
          await Promise.all([
            supabaseRest(`/rest/v1/status_history?order_id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {}),
            supabaseRest(`/rest/v1/order_images?order_id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {}),
            supabaseRest(`/rest/v1/order_items?order_id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {}),
          ]);
          await supabaseRest(`/rest/v1/orders?id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {});
        }
      }
    });
  });
}
