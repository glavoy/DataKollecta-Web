-- search_profiles_for_invite (added in 20260814_scope_profiles_visibility.sql)
-- revoked EXECUTE from `public` but the live schema snapshot
-- (supabase/datakollecta.json, refreshed 2026-08-15) shows `anon` still
-- holding an explicit EXECUTE grant -- Supabase's SQL editor grants anon +
-- authenticated + service_role by default when a function is created there,
-- and `revoke ... from public` does not remove a role's own separate grant.
-- Net effect: an unauthenticated caller could search every user's
-- email/full_name. Revoke anon explicitly; authenticated keeps access.

revoke execute on function public.search_profiles_for_invite(text) from anon;
