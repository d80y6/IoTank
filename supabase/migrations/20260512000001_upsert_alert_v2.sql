-- supabase/migrations/20260512000001_upsert_alert_v2.sql

/**
 * upsert_alert_v2 — Forensic-Safe Alert Deduplication
 * 
 * Logic:
 *  - Deduplicate on (station_id, tank_id, alert_type)
 *  - ONLY deduplicate if the existing alert is NOT resolved (is_resolved = false)
 *  - If resolved, allow a new alert to be created (persistence of historical events)
 */

CREATE OR REPLACE FUNCTION upsert_alert_v2(
  p_station_id UUID,
  p_tank_id UUID,
  p_alert_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_severity TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert_id UUID;
  v_existing_id UUID;
BEGIN
  -- 1. Check for an active (unresolved) alert of the same type for this tank
  SELECT id INTO v_existing_id
  FROM alerts
  WHERE station_id = p_station_id
    AND tank_id = p_tank_id
    AND alert_type = p_alert_type
    AND is_resolved = false
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- 2. Update existing active alert (Pulse Update)
    UPDATE alerts
    SET 
      title = p_title,
      message = p_message,
      severity = p_severity,
      metadata = p_metadata,
      updated_at = NOW()
    WHERE id = v_existing_id
    RETURNING id INTO v_alert_id;
    
    RETURN jsonb_build_object('id', v_alert_id, 'action', 'updated');
  ELSE
    -- 3. Insert new alert
    INSERT INTO alerts (
      station_id,
      tank_id,
      alert_type,
      title,
      message,
      severity,
      metadata,
      is_resolved,
      created_at
    )
    VALUES (
      p_station_id,
      p_tank_id,
      p_alert_type,
      p_title,
      p_message,
      p_severity,
      p_metadata,
      false,
      NOW()
    )
    RETURNING id INTO v_alert_id;
    
    RETURN jsonb_build_object('id', v_alert_id, 'action', 'created');
  END IF;
END;
$$;
