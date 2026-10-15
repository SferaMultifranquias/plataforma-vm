# User Store Visibility — Design

## Architecture

### Layer 1: Helper function — `current_user_is_active()`
- Security definer (bypasses RLS to read `public.profiles`)
- Reads `is_active` from profiles table for `auth.uid()`
- Returns `false` on any error/missing row
- Used in RLS policies AND RPCs

```sql
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_active from public.profiles where id = auth.uid()),
    false
  );
$$;
```

### Layer 2: RLS policy updates

#### `lojas_select_authenticated`
- Admin bypass (sees all stores for management)
- Non-admin sees only `ativo = true`

#### `orders_insert_own`
- Keep `requester_id = auth.uid()` check
- Add `public.current_user_is_active()` check
- Store-level authorization handled by `create_order` RPC
- Direct insert still possible but requires active user

### Layer 3: RPC updates — `create_order`
- Add active-user guard at entry
- Add active-store guard after store lookup
- Existing store-access check unchanged

### Layer 4: RPC updates — `user_can_access_store`
- Add active-user guard
- Add active-store guard via JOIN

## Data Flow

```
[Store Selector Load]
  -> carregarLojas()                          [RLS: lojas_select_authenticated]
    -> ADMIN: active stores returned
    -> USER: active stores returned
  -> loadAllowedStoreIds()                    [RLS: user_stores_select_self_or_admin]
    -> ADMIN: null (no filter)
    -> USER: Set<store_id> from user_stores
  -> filter stores by allowedStoreIds         [frontend defense-in-depth]
  -> drop inactive stores before render
  -> if empty or lookup fails: disabled select + clear error
  -> selected store must exist in cached authorized set or it is cleared

[Order Create]
  -> enviarPedidoAPI()
    -> create_order RPC                       [security definer]
      -> current_user_is_active()             [fail if false]
      -> lookup store from lojas
      -> store.ativo = true                   [fail if false]
      -> is_admin() OR user_stores entry      [fail if false]
      -> insert order, history, audit
  -> fallback: insert direct                  [RLS: orders_insert_own]
      -> current_user_is_active()             [fail if false]
```

## Security Guarantees

| Layer | What it prevents | Bypass risk |
|-------|-----------------|-------------|
| RLS: `lojas_select_authenticated` | Inactive stores visible to USER | Browser tamper? No, RLS is server |
| RLS: `orders_insert_own` | Inactive user creates order | Browser tamper? No, RLS is server |
| RPC: `create_order` | Inactive user, inactive store, unauthorized store | Only called via RPC |
| Frontend: `allowedStoreIds` | Stores not linked to USER shown | Defense-in-depth only |
| Frontend: cached store lookup | Tampered `loja_id` accepted | Defense-in-depth only |

## Test Strategy
- Unit tests: `current_user_is_active()` via mock profiles
- RLS tests: direct inserts via Supabase client under different profiles (requires test DB)
- Frontend tests: mock RLS responses, verify store filtering
