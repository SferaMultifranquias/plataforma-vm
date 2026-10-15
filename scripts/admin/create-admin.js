require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.argv[2];
const password = process.argv[3];
const fullName = process.argv[4] || 'Administrador';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!SUPABASE_URL || SUPABASE_URL.includes('your-project-ref')) {
  fail('Defina SUPABASE_URL real no arquivo .env antes de executar este script.');
}

if (!SERVICE_ROLE_KEY || SERVICE_ROLE_KEY === 'do-not-expose-this-in-frontend') {
  fail('Defina SUPABASE_SERVICE_ROLE_KEY real no arquivo .env antes de executar este script.');
}

if (!email || !password) {
  fail('Uso: node scripts/create-admin.js <email> <senha> [nome]');
}

async function createAuthUser() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        role: 'ADMIN',
        is_active: true,
      },
      user_metadata: {
        full_name: fullName,
        role: 'ADMIN',
        is_active: true,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const duplicateMessage = String(body.msg || body.message || body.error_description || '').toLowerCase();
    if (
      duplicateMessage.includes('already registered') ||
      duplicateMessage.includes('already been registered') ||
      duplicateMessage.includes('already exists') ||
      response.status === 422
    ) {
      return null;
    }
    throw new Error(body.msg || body.message || `Falha ao criar usuario auth (HTTP ${response.status}).`);
  }

  return body.user;
}

async function findUserByEmail() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.msg || body.message || `Falha ao listar usuarios auth (HTTP ${response.status}).`);
  }

  const users = Array.isArray(body.users) ? body.users : [];
  return users.find((user) => String(user.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function updateAuthUser(userId) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password,
      email_confirm: true,
      app_metadata: {
        role: 'ADMIN',
        is_active: true,
      },
      user_metadata: {
        full_name: fullName,
        role: 'ADMIN',
        is_active: true,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.msg || body.message || `Falha ao atualizar usuario auth (HTTP ${response.status}).`);
  }
}

async function upsertProfile(userId) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: userId,
      email,
      name: fullName,
      role: 'ADMIN',
      is_active: true,
    }),
  });

  if (response.ok) return;

  const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([
      {
        id: userId,
        email,
        name: fullName,
        role: 'ADMIN',
        is_active: true,
      },
    ]),
  });

  const body = await insertResponse.json().catch(() => ({}));
  if (!insertResponse.ok) {
    throw new Error(body.message || `Falha ao criar/atualizar profile (HTTP ${insertResponse.status}).`);
  }
}

async function main() {
  let user = await createAuthUser();
  if (!user) {
    user = await findUserByEmail();
  }

  if (!user || !user.id) {
    fail('Nao foi possivel localizar o usuario no Auth apos a criacao.');
  }

  await updateAuthUser(user.id);

  try {
    await upsertProfile(user.id);
  } catch (error) {
    if (!String(error.message || '').includes("Could not find the table 'public.profiles'")) {
      throw error;
    }
    console.warn('Aviso: tabela profiles ausente. Seguindo com fallback por Auth.');
  }

  console.log('Admin pronto.');
  console.log(`Email: ${email}`);
  console.log(`User ID: ${user.id}`);
}

main().catch((error) => fail(`Erro: ${error.message}`));
