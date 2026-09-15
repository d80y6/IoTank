-- supabase/migrations/20260506290000_restore_fuel_stations_access.sql
-- ============================================================================
-- EMERGENCY RESTORATION: fuel_stations Access & Schema Alignment
-- ============================================================================
-- 1. Restores the ability for users to see their own station's billing info.
-- 2. Aligns RLS with the new 'station_id' column naming.
-- 3. Repairs critical RPCs that were broken by the ID rename.
-- ============================================================================

-- 1. FIX RLS POLICIES FOR fuel_stations
-- ============================================================================
DROP POLICY IF EXISTS "Users can see own station info" ON public.fuel_stations;
CREATE POLICY "Users can see own station info"
    ON public.fuel_stations
    FOR SELECT
    TO authenticated
    USING (station_id = (SELECT get_station_id_from_auth()) OR (SELECT public.get_auth_level()) <= 4);

DROP POLICY IF EXISTS "Authorized admins can update organization billing" ON public.fuel_stations;
CREATE POLICY "Authorized admins can update organization billing"
    ON public.fuel_stations
    FOR UPDATE
    TO authenticated
    USING (station_id = (SELECT get_station_id_from_auth()) AND (SELECT public.get_auth_level()) <= 5)
    WITH CHECK (station_id = (SELECT get_station_id_from_auth()) AND (SELECT public.get_auth_level()) <= 5);


-- 2. REPAIR BROKEN RPCs (fuel_stations.id -> fuel_stations.station_id)
-- ============================================================================

-- REPAIR: get_station_dashboard_summary
CREATE OR REPLACE FUNCTION get_station_dashboard_summary(p_station_id UUID)
RETURNS JSON AS $$
DECLARE v_summary JSON;
BEGIN
  SELECT json_build_object(
    'station', (
      SELECT json_build_object(
        'current_debt', fs.current_debt,
        'total_paid', fs.total_paid,
        'account_status', fs.account_status,
        'next_billing_date', fs.next_billing_date
      ) FROM public.fuel_stations fs WHERE fs.station_id = p_station_id -- FIXED
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- REPAIR: admin_adjust_station_debt
CREATE OR REPLACE FUNCTION admin_adjust_station_debt(
  p_station_id UUID,
  p_adjustment_amount DECIMAL,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin_uid UUID;
  v_system_user_id UUID;
  v_old_debt DECIMAL;
  v_new_debt DECIMAL;
  v_transaction_id UUID;
BEGIN
  v_admin_uid := auth.uid();
  
  SELECT id INTO v_system_user_id
  FROM system_users
  WHERE auth_user_id = v_admin_uid -- Standardized
    AND is_active = TRUE
    AND role IN ('super_admin', 'admin_helper');

  IF v_system_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Only active Super Admins and Admin Helpers can adjust debt.';
  END IF;

  SELECT current_debt INTO v_old_debt
  FROM fuel_stations
  WHERE station_id = p_station_id; -- FIXED

  IF v_old_debt IS NULL THEN
    RAISE EXCEPTION 'Station not found.';
  END IF;

  v_new_debt := v_old_debt + p_adjustment_amount;
  IF v_new_debt < 0 THEN v_new_debt := 0; END IF;

  UPDATE fuel_stations
  SET current_debt = v_new_debt,
      updated_at = NOW()
  WHERE station_id = p_station_id; -- FIXED

  INSERT INTO transactions (
    station_id, 
    transaction_type, 
    amount, 
    description, 
    payment_status,
    created_by
  ) VALUES (
    p_station_id, 
    'adjustment', 
    ABS(p_adjustment_amount), 
    p_reason, 
    'completed',
    v_admin_uid::text
  ) RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_debt', v_old_debt,
    'new_debt', v_new_debt
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
