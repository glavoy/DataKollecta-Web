-- `user_search` (public.profiles projected to id/email/full_name) predates
-- search_profiles_for_invite() and was never cleaned up after that RPC took
-- over the "find a user to invite" feature. Confirmed by repo-wide grep:
-- nothing in src/ references it. It is `security_invoker`, so profiles' own
-- RLS currently blocks an anonymous caller from reading through it -- but it
-- is granted ALL to anon at the table-privilege level regardless, which is
-- unused attack surface with no legitimate caller. Drop it rather than leave
-- it as a trap for a future RLS change on profiles to accidentally expose.

drop view if exists public.user_search;
