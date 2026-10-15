-- Drop the orphan 7-parameter overload of create_order left by the initial
-- migration. Migration 20260618100000 replaced it with an 8-parameter version
-- (adding p_store_id) via create or replace, but since the parameter count
-- differs PostgreSQL creates a new overload instead of replacing.
-- This orphan overload causes PostgREST PGRST203 when the function is
-- resolved with 7 named parameters (no p_store_id), which can happen on
-- edge cases where loja_id is missing or undefined.
-- Only the 8-parameter version should remain.

drop function if exists public.create_order(p_brand text, p_store text, p_cost_center text, p_purpose text, p_justification text, p_priority text, p_notes text);

-- The GRANT for the 8-parameter version (already applied by
-- 20260618100000_add_order_review_workflow.sql) remains intact.
