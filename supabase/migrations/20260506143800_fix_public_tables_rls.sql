-- supabase/migrations/20260506143800_fix_public_tables_rls.sql

-- ============================================================================
-- FIX: Enable Row Level Security (RLS) on tables missing it
-- ============================================================================
-- The Supabase security scanner detected that tables in the public schema
-- were publicly accessible because RLS was never explicitly enabled. 
-- Even if policies are created for a table, they are ignored until RLS is enabled.

-- 1. system_settings
-- This table contains sensitive keys (like cron_secret and anon_key).
-- Policies were added in 20260423010000, but RLS was never enabled.
ALTER TABLE IF EXISTS public.system_settings ENABLE ROW LEVEL SECURITY;

-- 2. rls_debug
-- This table was created for debugging but lacked RLS.
ALTER TABLE IF EXISTS public.rls_debug ENABLE ROW LEVEL SECURITY;
