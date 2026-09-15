-- supabase/migrations/20260515180000_restore_rpc_security.sql
-- ============================================================================
-- FIX: Restore critical RPCs to SECURITY DEFINER.
-- These were inadvertently set to SECURITY INVOKER, causing 403/400 errors
-- when attempting to bypass strict RLS or perform immutable updates.
-- ============================================================================

-- 1. Restore Event Resolution RPCs
-- These MUST be SECURITY DEFINER to bypass the "No updates to unified_events" policy.
ALTER FUNCTION public.resolve_all_station_events(uuid) SECURITY DEFINER;
ALTER FUNCTION public.resolve_unified_event(uuid) SECURITY DEFINER;

-- 2. Restore Analytics RPC
-- Set to SECURITY DEFINER to ensure consistent access to daily_stats 
-- across all station members via internal authorization logic.
ALTER FUNCTION public.get_tank_analytics_30d(uuid) SECURITY DEFINER;

-- 3. Ensure grants are correct
GRANT EXECUTE ON FUNCTION public.resolve_all_station_events(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_unified_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tank_analytics_30d(uuid) TO authenticated;

-- 4. Reload Schema
NOTIFY pgrst, 'reload schema';
