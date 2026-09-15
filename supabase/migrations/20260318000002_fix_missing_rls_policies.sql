-- supabase/migrations/20260318000002_fix_missing_rls_policies.sql
-- ============================================================================
-- FIX: Add RLS policies for tables flagged by Supabase Security Advisor
-- Tables: analysis_history, audit_logs, file_uploads, market_signals,
--         raw_market_data, regulatory_notices
-- ============================================================================

-- ============================================================================
-- 1. AUDIT_LOGS
-- Clients see their own audit logs. Admins see all.
-- ============================================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own audit logs" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );

CREATE POLICY "Clients can insert their own audit logs" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );

CREATE POLICY "System admins can view all audit logs" ON audit_logs
  FOR SELECT TO authenticated
  USING (is_system_admin('analyst'));


-- ============================================================================
-- 2. FILE_UPLOADS
-- Clients can manage files belonging to their organization.
-- ============================================================================
ALTER TABLE file_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own file uploads" ON file_uploads
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );

CREATE POLICY "Clients can insert file uploads" ON file_uploads
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );

CREATE POLICY "Clients can update own file uploads" ON file_uploads
  FOR UPDATE TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );


-- ============================================================================
-- 3. ANALYSIS_HISTORY
-- Clients can view analysis history for their files only.
-- ============================================================================
ALTER TABLE analysis_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own analysis history" ON analysis_history
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );

CREATE POLICY "Clients can insert own analysis history" ON analysis_history
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
  );


-- ============================================================================
-- 4. MARKET_SIGNALS
-- Market signals are client-scoped. All authenticated users can read
-- signals related to their client account. Admins can see all.
-- ============================================================================
ALTER TABLE market_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own market signals" ON market_signals
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = public.firebase_uid())
    OR client_id IS NULL  -- Global signals not tied to a specific client
  );

CREATE POLICY "Clients can insert market signals" ON market_signals
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = public.firebase_uid())
    OR client_id IS NULL
  );

CREATE POLICY "System admins can read all market signals" ON market_signals
  FOR SELECT TO authenticated
  USING (is_system_admin('analyst'));


-- ============================================================================
-- 5. REGULATORY_NOTICES
-- Regulatory notices are public information but scoped per client.
-- All authenticated users can view regulatory notices.
-- ============================================================================
ALTER TABLE regulatory_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own regulatory notices" ON regulatory_notices
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
    OR client_id IS NULL  -- Global notices
  );

CREATE POLICY "Clients can insert regulatory notices" ON regulatory_notices
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
    OR client_id IS NULL
  );


-- ============================================================================
-- 6. RAW_MARKET_DATA
-- Raw market data is used for analytics by clients.
-- ============================================================================
ALTER TABLE raw_market_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own raw market data" ON raw_market_data
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
    OR client_id IS NULL  -- Global market data
  );

CREATE POLICY "Clients can insert raw market data" ON raw_market_data
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM client_billing WHERE firebase_uid = auth.uid()::text)
    OR client_id IS NULL
  );

CREATE POLICY "System admins can read all raw market data" ON raw_market_data
  FOR SELECT TO authenticated
  USING (is_system_admin('analyst'));
