'use strict';
// Purge stale E2E users from prior failed runs.
// Run: node scripts/maintenance/purge-stale-e2e-users.js --confirm
//
// Requires .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const fs = require('fs');
const https = require('https');
const path = require('path');

const envPath = path.resolve(__dirname, '../../.env');
const env = fs.readFileSync(envPath, 'utf8');
const getEnv = (k) => {
  for (const line of env.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key.trim() === k) return rest.join('=').trim();
  }
  return '';
};

const SUPABASE_URL = getEnv('SUPABASE_URL');
const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

async function svcFetch(path, opts = {}) {
  const u = new URL(path, SUPABASE_URL);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: opts.method || 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          Accept: 'application/json',
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  const isConfirmed = process.argv.includes('--confirm');
  if (!isConfirmed) {
    console.log('DRY RUN. Pass --confirm to execute.');
  }

  // Find removed users with E2E marker
  const profilesResp = await svcFetch(
    `/rest/v1/profiles?select=id,email,name,role,removed_at&removed_at=not.is.null&email=like.*e2e-user-usv*@dominio-valido.com&limit=1000`
  );
  if (!profilesResp.ok) {
    console.error('Failed to fetch profiles:', profilesResp.status, JSON.stringify(profilesResp.body).slice(0, 200));
    process.exit(1);
  }
  const profiles = Array.isArray(profilesResp.body) ? profilesResp.body : [];
  console.log(`Found ${profiles.length} stale E2E removed users.`);
  for (const p of profiles) {
    console.log(`  ${p.id} ${p.email}`);
  }

  if (!profiles.length) {
    console.log('Nothing to purge.');
    return;
  }

  for (const p of profiles) {
    console.log(`\nPurging ${p.email} (${p.id})...`);

    // 1. Find and delete all orders + artifacts
    const ordersResp = await svcFetch(
      `/rest/v1/orders?select=id,status&requester_id=eq.${encodeURIComponent(p.id)}&limit=100`
    );
    const orders = Array.isArray(ordersResp.body) ? ordersResp.body : [];
    console.log(`  Orders: ${orders.length}`);

    for (const order of orders) {
      // Find storage paths for this order
      const imgResp = await svcFetch(
        `/rest/v1/order_images?select=storage_path,bucket_name&order_id=eq.${encodeURIComponent(order.id)}&limit=100`
      );
      const imgs = Array.isArray(imgResp.body) ? imgResp.body : [];

      // Delete Storage objects
      for (const img of imgs) {
        const bucket = img.bucket_name || 'order-images';
        const storagePath = img.storage_path;
        if (storagePath) {
          if (isConfirmed) {
            const delResp = await svcFetch(`/storage/v1/object/${bucket}/${storagePath}`, { method: 'DELETE' });
            console.log(`  Storage DELETE ${bucket}/${storagePath}: ${delResp.status}`);
          } else {
            console.log(`  [DRY] Storage DELETE ${bucket}/${storagePath}`);
          }
        }
      }

      // Delete status_history
      if (isConfirmed) {
        await svcFetch(`/rest/v1/status_history?order_id=eq.${encodeURIComponent(order.id)}`, { method: 'DELETE' });
      }
      // Delete order_images
      if (isConfirmed) {
        await svcFetch(`/rest/v1/order_images?order_id=eq.${encodeURIComponent(order.id)}`, { method: 'DELETE' });
      }
      // Delete order_items
      if (isConfirmed) {
        await svcFetch(`/rest/v1/order_items?order_id=eq.${encodeURIComponent(order.id)}`, { method: 'DELETE' });
      }
      // Delete order
      if (isConfirmed) {
        await svcFetch(`/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, { method: 'DELETE' });
      }
      console.log(`  Order ${order.id} cleaned.`);
    }

    // 2. Delete user_stores
    if (isConfirmed) {
      await svcFetch(`/rest/v1/user_stores?user_id=eq.${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    }

    // 3. Delete audit_logs
    if (isConfirmed) {
      await svcFetch(`/rest/v1/audit_logs?user_id=eq.${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    }

    // 4. Delete profile
    if (isConfirmed) {
      await svcFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    }

    // 5. Delete Auth user
    if (isConfirmed) {
      const authDelResp = await svcFetch(`/auth/v1/admin/users/${encodeURIComponent(p.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      console.log(`  Auth DELETE: ${authDelResp.status}`);
    } else {
      console.log(`  [DRY] Auth DELETE ${p.id}`);
    }

    console.log(`  Done.`);
  }

  // Verify
  console.log('\nVerifying cleanup...');
  const verifyResp = await svcFetch(
    `/rest/v1/profiles?select=id,email&removed_at=not.is.null&email=like.*e2e-user-usv*@dominio-valido.com&limit=1000`
  );
  const remaining = Array.isArray(verifyResp.body) ? verifyResp.body : [];
  console.log(`Remaining stale profiles: ${remaining.length}`);
  for (const r of remaining) {
    console.log(`  STILL EXISTS: ${r.email} (${r.id})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
