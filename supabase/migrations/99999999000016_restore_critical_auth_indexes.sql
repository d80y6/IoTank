-- supabase/migrations/99999999000016_restore_critical_auth_indexes.sql
-- ============================================================================
-- HOTFIX: Restore Critical RLS Authentication Indexes
-- ============================================================================
-- The previous linter hardening script aggressively dropped "unused" indexes.
-- However, Postgres relies on these indexes to execute RLS subqueries efficiently.
-- Without them, policies like `auth_user_id = auth.uid()` trigger N+1 full 
-- table scans, resulting in 57014 statement timeouts.
-- ============================================================================

BEGIN;

-- Restore critical identity lookup indexes
CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id ON public.profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_system_users_auth_user_id ON public.system_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_tanks_auth_user_id ON public.tanks(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_shift_closures_auth_user_id ON public.shift_closures(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_auth_user_id ON public.transactions(auth_user_id);

-- Restore critical foreign key indexes used heavily in RLS
CREATE INDEX IF NOT EXISTS idx_tanks_station_id ON public.tanks(station_id);
CREATE INDEX IF NOT EXISTS idx_alerts_auth_user_id ON public.alerts(auth_user_id);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
