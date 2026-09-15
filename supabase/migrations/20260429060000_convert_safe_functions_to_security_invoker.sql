-- Migration: Convert selected safe functions to SECURITY INVOKER
-- Date: 2026-04-29
-- Purpose: Convert functions that only use the caller's identity or perform
-- scoped checks to SECURITY INVOKER to avoid requiring SECURITY DEFINER.

BEGIN;

-- These functions were inspected and appear to operate only on the
-- caller's identity or perform checks that are safe to run with the
-- caller's privileges. Convert them to SECURITY INVOKER so they do not
-- run with definer privileges.

ALTER FUNCTION public.current_auth_uid_text() SECURITY INVOKER;
ALTER FUNCTION public.get_auth_level() SECURITY INVOKER;
ALTER FUNCTION public.get_tank_analytics_30d(uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_user_bundle_v2() SECURITY INVOKER;
ALTER FUNCTION public.get_user_station_id() SECURITY INVOKER;

COMMIT;

-- Notes:
-- - Reviewed function bodies for these symbols; they mainly call `auth.uid()`
--   and read records scoped to the calling user. If any of these rely on
--   elevated privileges (e.g. cross-tenant admin queries), revert and keep
--   SECURITY DEFINER or move privileged logic to an internal schema.
-- - Do NOT convert trigger functions (e.g. validate_sensor_reading) here.
