-- supabase/migrations/20260601000007_final_integrity_remediation.sql
-- ============================================================================
-- FINAL PRODUCTION REMEDIATION & HARMONIZATION (2026-06-01)
-- ============================================================================
-- 1. Fix 'process_payment' signature and return type conflict.
-- 2. Update 'check_my_identity' to call 'get_user_bundle_v2'.
-- 3. Repair 'get_tankiq_station_summary' GROUP BY and column naming.
-- 4. Redirect 'log_registration_event' to 'unified_events'.
-- 5. Add missing indices for forensic auditing and performance.
-- 6. Universal column rename cleanup (Defensive).
-- ============================================================================

-- ============================================================================
-- SECTION 1: Fix broken RPCs
-- ============================================================================

-- A. Fix process_payment
-- Drop all possible versions to avoid overloading and return type conflicts
DROP FUNCTION IF EXISTS public.process_payment(UUID, DECIMAL, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_payment(
    p_station_id UUID,
    p_amount DECIMAL,
    p_payment_method TEXT,
    p_payment_reference TEXT,
    p_description TEXT DEFAULT 'Payment received'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_old_debt DECIMAL;
    v_new_debt DECIMAL;
    v_caller_uid UUID := auth.uid();
BEGIN
    -- 1. Authorization check: Caller must own the station OR be an admin
    IF NOT (
        EXISTS (SELECT 1 FROM public.fuel_stations WHERE station_id = p_station_id AND owner_id = v_caller_uid)
        OR public.is_admin()
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Access denied to fuel_stations record';
    END IF;

    -- 2. Fetch current debt
    SELECT current_debt INTO v_old_debt
    FROM public.fuel_stations
    WHERE station_id = p_station_id;

    IF v_old_debt IS NULL THEN
        RAISE EXCEPTION 'Station with ID % not found', p_station_id;
    END IF;

    -- 3. Calculate new debt (Floor at 0)
    v_new_debt := GREATEST(0, v_old_debt - p_amount);

    -- 4. Update Station Ledger
    UPDATE public.fuel_stations
    SET current_debt = v_new_debt,
        total_paid = total_paid + p_amount,
        updated_at = NOW()
    WHERE station_id = p_station_id;

    -- 5. Record Transaction
    INSERT INTO public.transactions (
        station_id,
        transaction_type,
        amount,
        description,
        payment_method,
        payment_reference,
        payment_status,
        created_at,
        completed_at
    ) VALUES (
        p_station_id,
        'payment',
        p_amount,
        p_description,
        p_payment_method,
        p_payment_reference,
        'completed',
        NOW(),
        NOW()
    );

    -- 6. Record in unified_events
    INSERT INTO public.unified_events (
        station_id,
        event_category,
        event_type,
        description,
        actor_id,
        metadata
    ) VALUES (
        p_station_id,
        'FINANCE',
        'PAYMENT_RECEIVED',
        'Payment of KSh ' || p_amount || ' received via ' || p_payment_method,
        v_caller_uid,
        jsonb_build_object(
            'amount', p_amount,
            'method', p_payment_method,
            'reference', p_payment_reference,
            'new_debt', v_new_debt
        )
    );
END;
$$;

-- B. Fix check_my_identity
CREATE OR REPLACE FUNCTION public.check_my_identity()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  v_auth_user JSONB;
  v_profile JSONB;
  v_system_user JSONB;
BEGIN
  v_uid := auth.uid();
  
  SELECT jsonb_build_object('id', id, 'email', email) INTO v_auth_user FROM auth.users WHERE id = v_uid;
  SELECT to_jsonb(p) INTO v_profile FROM public.profiles p WHERE auth_user_id = v_uid;
  SELECT to_jsonb(su) INTO v_system_user FROM public.system_users su WHERE auth_user_id = v_uid AND is_active = TRUE;

  RETURN jsonb_build_object(
    'timestamp', now(),
    'auth_uid', v_uid,
    'auth_user', v_auth_user,
    'profile', v_profile,
    'system_user', v_system_user,
    'bundle', (SELECT public.get_user_bundle_v2())
  );
END;
$$;

-- C. Fix get_tankiq_station_summary
CREATE OR REPLACE FUNCTION public.get_tankiq_station_summary(p_station_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'station_id', p_station_id,
        'timestamp', now(),
        'tanks', (
            SELECT jsonb_agg(jsonb_build_object(
                'label', tank_name,
                'fuel_type', fuel_type,
                'capacity', tank_capacity,
                'current_volume', current_volume,
                'fill_percent', ROUND((current_volume / NULLIF(tank_capacity, 0) * 100)::NUMERIC, 1)
            ))
            FROM tanks
            WHERE station_id = p_station_id AND status = 'active'
        ),
        'recent_alerts', (
            SELECT jsonb_agg(jsonb_build_object(
                'type', alert_type,
                'severity', severity,
                'message', message,
                'time', created_at
            ))
            FROM (
                SELECT alert_type, severity, message, created_at
                FROM alerts
                WHERE station_id = p_station_id AND is_resolved = false
                ORDER BY created_at DESC
                LIMIT 5
            ) sub
        )
    ) INTO result;
    
    RETURN result;
END;
$$;

-- C.1 Fix get_station_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_station_dashboard_summary(p_station_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_summary JSON;
BEGIN
  SELECT json_build_object(
    'station', (
      SELECT json_build_object(
        'current_debt', fs.current_debt,
        'total_paid', fs.total_paid,
        'account_status', fs.account_status,
        'next_billing_date', fs.next_billing_date
      ) FROM public.fuel_stations fs WHERE fs.station_id = p_station_id
    ),
    'tanks', (
      SELECT json_agg(
        json_build_object(
          'id', t.id, 'name', t.tank_name, 'fuel_type', t.fuel_type,
          'current_volume', t.current_volume, 'capacity', t.tank_capacity,
          'fill_percentage', ROUND((t.current_volume / NULLIF(t.tank_capacity, 0) * 100)::NUMERIC, 2),
          'temperature', t.current_temperature, 'status', t.status
        )
      ) FROM public.tanks t WHERE t.station_id = p_station_id AND t.status = 'active'
    ),
    'unread_alerts', (
      SELECT COUNT(*) FROM public.alerts a
      WHERE a.station_id = p_station_id AND a.is_read = FALSE
    ),
    'critical_alerts', (
      SELECT COUNT(*) FROM public.alerts a
      WHERE a.station_id = p_station_id AND a.is_read = FALSE AND a.severity = 'critical'
    )
  ) INTO v_summary;
  RETURN v_summary;
END;
$$;

-- D. Fix log_registration_event
CREATE OR REPLACE FUNCTION public.log_registration_event(
    p_registration_id UUID,
    p_event_type TEXT,
    p_actor_email TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_detail_json JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.unified_events (
        event_category,
        event_type,
        description,
        actor_id,
        actor_email,
        metadata
    ) VALUES (
        'SYSTEM',
        'REGISTRATION_' || UPPER(p_event_type),
        COALESCE(p_notes, 'Registration event: ' || p_event_type),
        auth.uid(),
        p_actor_email,
        jsonb_build_object(
            'registration_id', p_registration_id,
            'details', p_detail_json
        )
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to log registration event: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ============================================================================
-- SECTION 2: Universal Identifier Enforcement (Defensive)
-- ============================================================================

DO $$ 
DECLARE
    t RECORD;
BEGIN
    -- Ensure every table that SHOULD have station_id has it, and it's renamed correctly.
    FOR t IN (
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'client_id' 
        AND table_schema = 'public'
    ) LOOP
        -- Check if target 'station_id' already exists in the same table
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = t.table_name 
            AND column_name = 'station_id' 
            AND table_schema = 'public'
        ) THEN
            EXECUTE format('ALTER TABLE public.%I DROP COLUMN client_id', t.table_name);
        ELSE
            EXECUTE format('ALTER TABLE public.%I RENAME COLUMN client_id TO station_id', t.table_name);
        END IF;
    END LOOP;

    -- Ensure profiles and system_users use auth_user_id (with collision protection)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'supabase_uid') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'auth_user_id') THEN
            ALTER TABLE public.profiles DROP COLUMN supabase_uid;
        ELSE
            ALTER TABLE public.profiles RENAME COLUMN supabase_uid TO auth_user_id;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_users' AND column_name = 'supabase_uid') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_users' AND column_name = 'auth_user_id') THEN
            ALTER TABLE public.system_users DROP COLUMN supabase_uid;
        ELSE
            ALTER TABLE public.system_users RENAME COLUMN supabase_uid TO auth_user_id;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- SECTION 3: Missing Indices & Optimization
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id ON public.profiles (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_unified_events_station_category ON public.unified_events (station_id, event_category);
CREATE INDEX IF NOT EXISTS idx_fuel_stations_owner_id ON public.fuel_stations (owner_id);
CREATE INDEX IF NOT EXISTS idx_tanks_station_id ON public.tanks (station_id);
CREATE INDEX IF NOT EXISTS idx_tanks_site_id ON public.tanks (site_id);

-- ============================================================================
-- SECTION 4: Permissions & RLS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.process_payment(UUID, DECIMAL, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_my_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tankiq_station_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_station_dashboard_summary(UUID) TO authenticated;

-- Reload PostgREST
NOTIFY pgrst, 'reload schema';
