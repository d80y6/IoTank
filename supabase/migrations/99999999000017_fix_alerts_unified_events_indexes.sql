-- Migration: 99999999000017_fix_alerts_unified_events_indexes.sql
-- Purpose: Remediate 57014 statement timeouts by enforcing direct B-Tree indexes on high-throughput query columns.

-- 1. High-throughput indexing for alerts
CREATE INDEX IF NOT EXISTS idx_alerts_station_id ON public.alerts (station_id);
CREATE INDEX IF NOT EXISTS idx_alerts_id ON public.alerts (id);
CREATE INDEX IF NOT EXISTS idx_alerts_is_resolved ON public.alerts (is_resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_tank_id ON public.alerts (tank_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts (created_at DESC);

-- 2. High-throughput indexing for unified_events
CREATE INDEX IF NOT EXISTS idx_unified_events_station_id ON public.unified_events (station_id);
CREATE INDEX IF NOT EXISTS idx_unified_events_id ON public.unified_events (id);
CREATE INDEX IF NOT EXISTS idx_unified_events_is_resolved ON public.unified_events (is_resolved);
CREATE INDEX IF NOT EXISTS idx_unified_events_created_at ON public.unified_events (created_at DESC);

-- 3. High-throughput indexing for market_action_queue
CREATE INDEX IF NOT EXISTS idx_market_action_queue_station_id ON public.market_action_queue (station_id);
CREATE INDEX IF NOT EXISTS idx_market_action_queue_status ON public.market_action_queue (status);

-- Ensure profiles station_id index exists (critical for cross-table RLS)
CREATE INDEX IF NOT EXISTS idx_profiles_station_id ON public.profiles (station_id);
