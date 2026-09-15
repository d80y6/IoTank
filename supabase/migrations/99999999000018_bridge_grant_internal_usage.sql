-- Bridge: public-facing RPCs call into the internal schema, but the
-- 20260428+ hardening revoked USAGE on internal from authenticated.
-- Grant USAGE + function EXECUTE so SECURITY INVOKER wrappers work.

GRANT USAGE ON SCHEMA internal TO authenticated;
GRANT USAGE ON SCHEMA internal TO anon;
GRANT USAGE ON SCHEMA internal TO service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA internal TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA internal TO service_role;
