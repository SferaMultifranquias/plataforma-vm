-- Fix: revoke public/anon execute on new RPCs to match security pattern
revoke execute on function public.resubmit_changed_order_multi_image(uuid, jsonb, jsonb, uuid[], text, text, text, text) from public, anon;
revoke execute on function public.cleanup_draft_order(uuid) from public, anon;
