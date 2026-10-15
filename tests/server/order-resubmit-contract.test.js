const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function run() {
  const migration = read('supabase/migrations/20260623110000_add_order_resubmit_workflow.sql');
  const verification = read('supabase/verification/20260623110000_verify_order_resubmit_workflow.sql');

  assert.match(migration, /create or replace function public\.resubmit_changed_order/);
  assert.match(migration, /security definer/);
  assert.match(migration, /p_order_id uuid,\s*p_items jsonb,\s*p_image jsonb default null/);
  assert.match(migration, /User is not active/);
  assert.match(migration, /Only requester can resubmit the order/);
  assert.match(migration, /Only orders with requested changes can be resubmitted/);
  assert.match(migration, /Invalid priority/);
  assert.match(migration, /o\.status in \('DRAFT', 'CHANGES_REQUESTED'\)/);
  assert.match(migration, /delete from public\.order_items/);
  assert.match(migration, /delete from storage\.objects/);
  assert.match(migration, /status = 'PENDING_APPROVAL'/);
  assert.match(migration, /Resubmitted after requested changes/);
  assert.match(migration, /grant execute on function public\.resubmit_changed_order/);

  assert.match(verification, /resubmit_changed_order/);
  assert.match(verification, /order_images_storage_insert/);
  assert.match(verification, /orphan_storage_objects/);

  console.log('Order resubmit contract checks ok.');
}

run();
