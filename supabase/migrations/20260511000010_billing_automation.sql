-- supabase/migrations/20260511000010_billing_automation.sql

BEGIN;

-- 1. Enhance Subscription Status Enum
-- Note: We use DO block because ALTER TYPE ADD VALUE cannot run in a transaction block with other commands in some PG versions
-- but in Supabase/Postgres 15+, it's generally fine if we handle it carefully.
-- 1. Enum updates applied separately.


-- 2. Ensure Billing Columns are properly initialized
-- These columns already exist based on our inspection, but let's ensure defaults
ALTER TABLE fuel_stations 
    ALTER COLUMN current_debt SET DEFAULT 0,
    ALTER COLUMN total_paid SET DEFAULT 0,
    ALTER COLUMN sub_status SET DEFAULT 'TRIAL';

-- 3. Trigger for New Station Trial Setup
CREATE OR REPLACE FUNCTION public.handle_new_station_setup()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sub_status := 'TRIAL';
    NEW.trial_ends_at := NOW() + INTERVAL '14 days';
    NEW.current_debt := 0;
    NEW.total_paid := 0;
    NEW.next_billing_date := NOW() + INTERVAL '14 days'; -- First bill generated 30 days AFTER trial ends, but billing cycle starts here
    
    -- Record Audit Event
    INSERT INTO unified_events (
        station_id,
        event_category,
        event_type,
        description,
        metadata
    ) VALUES (
        NEW.station_id,
        'SYSTEM',
        'ACCOUNT_CREATED',
        'Station ' || NEW.station_name || ' initialized on 14-day free trial.',
        jsonb_build_object(
            'trial_ends_at', NEW.trial_ends_at,
            'sub_status', 'TRIAL'
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_station_created_setup ON fuel_stations;
CREATE TRIGGER on_station_created_setup
    BEFORE INSERT ON fuel_stations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_station_setup();

-- 4. RPC for Monthly Billing Application (Post-paid)
-- This will be called by an Edge Function cron job
CREATE OR REPLACE FUNCTION public.apply_monthly_billing()
RETURNS TABLE (station_id UUID, station_name TEXT, debt_added DECIMAL) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE fuel_stations
        SET 
            current_debt = current_debt + 5000,
            last_billing_date = NOW(),
            next_billing_date = next_billing_date + INTERVAL '30 days',
            sub_status = CASE 
                WHEN sub_status = 'TRIAL' THEN 'ACTIVE'::subscription_status 
                ELSE sub_status 
            END,
            updated_at = NOW()
        WHERE 
            sub_status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
            AND (
                (sub_status = 'TRIAL' AND NOW() >= trial_ends_at)
                OR (sub_status != 'TRIAL' AND NOW() >= next_billing_date)
            )
        RETURNING fuel_stations.station_id, fuel_stations.station_name
    )
    SELECT u.station_id, u.station_name, 5000::DECIMAL FROM updated u;
END;
$$;

-- 5. RPC to Enforce Suspensions (5-day rule)
CREATE OR REPLACE FUNCTION public.enforce_billing_suspensions()
RETURNS TABLE (station_id UUID, station_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH suspended AS (
        UPDATE fuel_stations
        SET 
            sub_status = 'SUSPENDED'::subscription_status,
            account_status = 'SUSPENDED',
            suspension_reason = 'Unpaid debt exceeding 5-day grace period.',
            updated_at = NOW()
        WHERE 
            sub_status = 'ACTIVE'
            AND current_debt > 0
            -- If bill was generated > 5 days ago and still unpaid
            AND NOW() >= (last_billing_date + INTERVAL '5 days')
        RETURNING fuel_stations.station_id, fuel_stations.station_name
    )
    SELECT s.station_id, s.station_name FROM suspended s;
END;
$$;

-- 6. Harden RLS for Suspension
-- We need to block access to core tables if the station is suspended
-- We'll wrap the existing get_station_id_from_auth logic or add a check

CREATE OR REPLACE FUNCTION public.check_station_active(p_station_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM fuel_stations 
        WHERE station_id = p_station_id 
        AND sub_status != 'SUSPENDED'
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Example: Update tanks policy (This is a pattern, we'll apply to others)
DROP POLICY IF EXISTS "Consolidated tanks access" ON public.tanks;
CREATE POLICY "Consolidated tanks access"
  ON public.tanks
  FOR ALL
  TO authenticated
  USING (
    (station_id = public.get_my_station_id() AND public.check_station_active(station_id))
    OR (SELECT public.check_is_staff())
  )
  WITH CHECK (
    (station_id = public.get_my_station_id() AND public.check_station_active(station_id))
    OR (SELECT public.check_is_super_admin())
  );

DROP POLICY IF EXISTS "Consolidated alerts access" ON public.alerts;
CREATE POLICY "Consolidated alerts access"
  ON public.alerts
  FOR ALL
  TO authenticated
  USING (
    (station_id = public.get_my_station_id() AND public.check_station_active(station_id))
    OR (SELECT public.check_is_staff())
  )
  WITH CHECK (
    (station_id = public.get_my_station_id() AND public.check_station_active(station_id))
    OR (SELECT public.check_is_super_admin())
  );

COMMIT;
