-- supabase/migrations/20260317000001_security_layer.sql

-- First, ensure admin_logs table exists (was missing from initial schema in prompt)
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_firebase_uid TEXT NOT NULL,
  action_type TEXT NOT NULL,
  affected_client_id UUID,
  affected_resource_type TEXT,
  affected_resource_id UUID,
  description TEXT NOT NULL,
  changes_made JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- STEP 1: Enable RLS on All Tables
ALTER TABLE client_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tanks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

-- STEP 2: Create Helper Functions for RLS
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
SET search_path = public
AS $$
BEGIN
  RETURN public.firebase_uid() IN (
    'YOUR_FIREBASE_ADMIN_UID_HERE',
    'SECOND_ADMIN_UID_IF_NEEDED'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_owns_client(client_firebase_uid TEXT)
RETURNS BOOLEAN
SET search_path = public
AS $$
BEGIN
  RETURN public.firebase_uid() = client_firebase_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_client_id_from_auth()
RETURNS UUID
SET search_path = public
AS $$
DECLARE
  client_uuid UUID;
BEGIN
  SELECT id INTO client_uuid
  FROM client_billing
  WHERE firebase_uid = public.firebase_uid();
  RETURN client_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 3: CLIENT_BILLING TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own billing record" ON client_billing;
CREATE POLICY "Users can view own billing record"
ON client_billing FOR SELECT
USING (public.firebase_uid() = firebase_uid OR is_admin());

DROP POLICY IF EXISTS "Users can update own contact info" ON client_billing;
CREATE POLICY "Users can update own contact info"
ON client_billing FOR UPDATE
USING (public.firebase_uid() = firebase_uid)
WITH CHECK (
  public.firebase_uid() = firebase_uid
  AND current_debt = (SELECT current_debt FROM client_billing WHERE id = client_billing.id)
  AND total_paid = (SELECT total_paid FROM client_billing WHERE id = client_billing.id)
  AND subscription_tier = (SELECT subscription_tier FROM client_billing WHERE id = client_billing.id)
);

DROP POLICY IF EXISTS "Admins can create billing records" ON client_billing;
CREATE POLICY "Admins can create billing records"
ON client_billing FOR INSERT
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins have full access to billing" ON client_billing;
CREATE POLICY "Admins have full access to billing"
ON client_billing FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Service role full access to billing" ON client_billing;
CREATE POLICY "Service role full access to billing"
ON client_billing FOR ALL
USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- SITES TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own sites" ON sites;
CREATE POLICY "Users can view own sites"
ON sites FOR SELECT
USING (client_id = get_client_id_from_auth() OR is_admin());

DROP POLICY IF EXISTS "Users can create own sites" ON sites;
CREATE POLICY "Users can create own sites"
ON sites FOR INSERT
WITH CHECK (client_id = get_client_id_from_auth());

DROP POLICY IF EXISTS "Users can update own sites" ON sites;
CREATE POLICY "Users can update own sites"
ON sites FOR UPDATE
USING (client_id = get_client_id_from_auth())
WITH CHECK (client_id = get_client_id_from_auth());

DROP POLICY IF EXISTS "Users can delete own sites" ON sites;
CREATE POLICY "Users can delete own sites"
ON sites FOR DELETE
USING (client_id = get_client_id_from_auth());

DROP POLICY IF EXISTS "Admins have full access to sites" ON sites;
CREATE POLICY "Admins have full access to sites"
ON sites FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 4: TRANSACTIONS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own transactions" ON transactions;
CREATE POLICY "Users can view own transactions"
ON transactions FOR SELECT
USING (public.firebase_uid() = firebase_uid OR is_admin());

DROP POLICY IF EXISTS "Admins have full access to transactions" ON transactions;
CREATE POLICY "Admins have full access to transactions"
ON transactions FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Service role full access to transactions" ON transactions;
CREATE POLICY "Service role full access to transactions"
ON transactions FOR ALL
USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- STEP 5: USAGE_LOGS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own usage logs" ON usage_logs;
CREATE POLICY "Users can view own usage logs"
ON usage_logs FOR SELECT
USING (public.firebase_uid() = firebase_uid OR is_admin());

DROP POLICY IF EXISTS "System can insert usage logs" ON usage_logs;
CREATE POLICY "System can insert usage logs"
ON usage_logs FOR INSERT
WITH CHECK (
  public.firebase_uid() = firebase_uid
  OR is_admin()
  OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

DROP POLICY IF EXISTS "Admins have full access to usage logs" ON usage_logs;
CREATE POLICY "Admins have full access to usage logs"
ON usage_logs FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 6: TANKS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own tanks" ON tanks;
CREATE POLICY "Users can view own tanks"
ON tanks FOR SELECT
USING (public.firebase_uid() = firebase_uid OR is_admin());

DROP POLICY IF EXISTS "Users can create own tanks" ON tanks;
CREATE POLICY "Users can create own tanks"
ON tanks FOR INSERT
WITH CHECK (public.firebase_uid() = firebase_uid);

DROP POLICY IF EXISTS "Users can update own tanks" ON tanks;
CREATE POLICY "Users can update own tanks"
ON tanks FOR UPDATE
USING (public.firebase_uid() = firebase_uid)
WITH CHECK (
  public.firebase_uid() = firebase_uid
);

DROP POLICY IF EXISTS "Users can delete own tanks" ON tanks;
CREATE POLICY "Users can delete own tanks"
ON tanks FOR DELETE
USING (public.firebase_uid() = firebase_uid);

DROP POLICY IF EXISTS "Admins have full access to tanks" ON tanks;
CREATE POLICY "Admins have full access to tanks"
ON tanks FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 7: SENSOR_READINGS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own sensor readings" ON sensor_readings;
CREATE POLICY "Users can view own sensor readings"
ON sensor_readings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tanks
    WHERE tanks.id = sensor_readings.tank_id AND tanks.firebase_uid = public.firebase_uid()
  ) OR is_admin()
);

DROP POLICY IF EXISTS "System can insert sensor readings" ON sensor_readings;
CREATE POLICY "System can insert sensor readings"
ON sensor_readings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tanks
    WHERE tanks.id = sensor_readings.tank_id AND tanks.firebase_uid = public.firebase_uid()
  )
  OR is_admin()
  OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

DROP POLICY IF EXISTS "Admins have full access to sensor readings" ON sensor_readings;
CREATE POLICY "Admins have full access to sensor readings"
ON sensor_readings FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 8: ALERTS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own alerts" ON alerts;
CREATE POLICY "Users can view own alerts"
ON alerts FOR SELECT
USING (public.firebase_uid() = firebase_uid OR is_admin());

DROP POLICY IF EXISTS "Users can update own alerts" ON alerts;
CREATE POLICY "Users can update own alerts"
ON alerts FOR UPDATE
USING (public.firebase_uid() = firebase_uid)
WITH CHECK (
  public.firebase_uid() = firebase_uid
);

DROP POLICY IF EXISTS "System can insert alerts" ON alerts;
CREATE POLICY "System can insert alerts"
ON alerts FOR INSERT
WITH CHECK (
  public.firebase_uid() = firebase_uid
  OR is_admin()
  OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

DROP POLICY IF EXISTS "Admins have full access to alerts" ON alerts;
CREATE POLICY "Admins have full access to alerts"
ON alerts FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 9: DELIVERIES TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own deliveries" ON deliveries;
CREATE POLICY "Users can view own deliveries"
ON deliveries FOR SELECT
USING (public.firebase_uid() = firebase_uid OR is_admin());

DROP POLICY IF EXISTS "Users can create own deliveries" ON deliveries;
CREATE POLICY "Users can create own deliveries"
ON deliveries FOR INSERT
WITH CHECK (public.firebase_uid() = firebase_uid);

DROP POLICY IF EXISTS "Users can update own deliveries" ON deliveries;
CREATE POLICY "Users can update own deliveries"
ON deliveries FOR UPDATE
USING (public.firebase_uid() = firebase_uid)
WITH CHECK (public.firebase_uid() = firebase_uid);

DROP POLICY IF EXISTS "Admins have full access to deliveries" ON deliveries;
CREATE POLICY "Admins have full access to deliveries"
ON deliveries FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 10: MARKET_PRICES TABLE POLICIES
DROP POLICY IF EXISTS "Anyone can view market prices" ON market_prices;
CREATE POLICY "Anyone can view market prices"
ON market_prices FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Only admins can modify market prices" ON market_prices;
CREATE POLICY "Only admins can modify market prices"
ON market_prices FOR ALL
USING (is_admin() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
WITH CHECK (is_admin() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- STEP 11: AI_RECOMMENDATIONS TABLE POLICIES
DROP POLICY IF EXISTS "Users can view own AI recommendations" ON ai_recommendations;
CREATE POLICY "Users can view own AI recommendations"
ON ai_recommendations FOR SELECT
USING (client_id = get_client_id_from_auth() OR is_admin());

DROP POLICY IF EXISTS "Users can update own recommendation actions" ON ai_recommendations;
CREATE POLICY "Users can update own recommendation actions"
ON ai_recommendations FOR UPDATE
USING (client_id = get_client_id_from_auth())
WITH CHECK (client_id = get_client_id_from_auth());

DROP POLICY IF EXISTS "System can insert AI recommendations" ON ai_recommendations;
CREATE POLICY "System can insert AI recommendations"
ON ai_recommendations FOR INSERT
WITH CHECK (
  client_id = get_client_id_from_auth()
  OR is_admin()
  OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

DROP POLICY IF EXISTS "Admins have full access to AI recommendations" ON ai_recommendations;
CREATE POLICY "Admins have full access to AI recommendations"
ON ai_recommendations FOR ALL
USING (is_admin()) WITH CHECK (is_admin());

-- STEP 12: ADMIN_LOGS TABLE POLICIES
DROP POLICY IF EXISTS "Only admins can view admin logs" ON admin_logs;
CREATE POLICY "Only admins can view admin logs"
ON admin_logs FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "Only admins can insert admin logs" ON admin_logs;
CREATE POLICY "Only admins can insert admin logs"
ON admin_logs FOR INSERT WITH CHECK (is_admin());


-- ============================================================================
-- DATABASE HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_standard_volume(
  ambient_volume DECIMAL,
  current_temp DECIMAL,
  fuel_type TEXT
) RETURNS DECIMAL AS $$
DECLARE
  thermal_expansion_coef DECIMAL;
  standard_temp DECIMAL := 15.5;
  standard_volume DECIMAL;
BEGIN
  thermal_expansion_coef := CASE fuel_type
    WHEN 'diesel' THEN 0.00085
    WHEN 'petrol' THEN 0.00120
    WHEN 'kerosene' THEN 0.00095
    ELSE 0.00100
  END;
  standard_volume := ambient_volume / (1 + thermal_expansion_coef * (current_temp - standard_temp));
  RETURN ROUND(standard_volume, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION add_debt_to_client(
  p_client_id UUID,
  p_amount DECIMAL,
  p_description TEXT,
  p_transaction_type TEXT DEFAULT 'charge'
) RETURNS UUID
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
  v_firebase_uid TEXT;
BEGIN
  SELECT firebase_uid INTO v_firebase_uid
  FROM client_billing WHERE id = p_client_id;
  
  UPDATE client_billing
  SET current_debt = current_debt + p_amount, updated_at = NOW()
  WHERE id = p_client_id;
  
  INSERT INTO transactions (
    client_id, firebase_uid, transaction_type, amount, description, payment_status
  ) VALUES (
    p_client_id, v_firebase_uid, p_transaction_type, p_amount, p_description, 'completed'
  ) RETURNING id INTO v_transaction_id;
  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION process_payment(
  p_client_id UUID, p_amount DECIMAL, p_payment_method TEXT, p_payment_reference TEXT, p_description TEXT DEFAULT 'Payment received'
) RETURNS UUID
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
  v_firebase_uid TEXT;
  v_current_debt DECIMAL;
BEGIN
  SELECT current_debt, firebase_uid INTO v_current_debt, v_firebase_uid
  FROM client_billing WHERE id = p_client_id;
  
  IF p_amount > v_current_debt THEN
    RAISE EXCEPTION 'Payment amount exceeds current debt';
  END IF;
  
  UPDATE client_billing
  SET current_debt = current_debt - p_amount, total_paid = total_paid + p_amount,
      last_payment_date = NOW(), updated_at = NOW(),
      account_status = CASE WHEN (current_debt - p_amount) <= 0 THEN 'active' ELSE account_status END
  WHERE id = p_client_id;
  
  INSERT INTO transactions (
    client_id, firebase_uid, transaction_type, amount, description, payment_method, payment_reference, payment_status, completed_at
  ) VALUES (
    p_client_id, v_firebase_uid, 'payment', p_amount, p_description, p_payment_method, p_payment_reference, 'completed', NOW()
  ) RETURNING id INTO v_transaction_id;
  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_client_dashboard_summary(p_firebase_uid TEXT)
RETURNS JSON
SET search_path = public
AS $$
DECLARE
  v_summary JSON;
BEGIN
  SELECT json_build_object(
    'billing', (
      SELECT json_build_object(
        'current_debt', current_debt, 'total_paid', total_paid, 'subscription_tier', subscription_tier,
        'account_status', account_status, 'next_billing_date', next_billing_date
      ) FROM client_billing WHERE firebase_uid = p_firebase_uid
    ),
    'tanks', (
      SELECT json_agg(
        json_build_object(
          'id', id, 'name', tank_name, 'fuel_type', fuel_type, 'current_volume', current_volume,
          'capacity', tank_capacity, 'fill_percentage', ROUND((current_volume / tank_capacity * 100)::NUMERIC, 2),
          'temperature', current_temperature, 'status', status
        )
      ) FROM tanks WHERE firebase_uid = p_firebase_uid AND status = 'active'
    ),
    'unread_alerts', (SELECT COUNT(*) FROM alerts WHERE firebase_uid = p_firebase_uid AND is_read = FALSE),
    'critical_alerts', (SELECT COUNT(*) FROM alerts WHERE firebase_uid = p_firebase_uid AND is_read = FALSE AND severity = 'critical')
  ) INTO v_summary;
  RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION calculate_monthly_usage_bill(
  p_client_id UUID, p_billing_period_start DATE, p_billing_period_end DATE
) RETURNS DECIMAL
SET search_path = public
AS $$
DECLARE v_total_cost DECIMAL;
BEGIN
  SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cost
  FROM usage_logs
  WHERE client_id = p_client_id AND timestamp >= p_billing_period_start AND timestamp <= p_billing_period_end AND is_billed = FALSE;
  RETURN v_total_cost;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION detect_theft_anomaly(
  p_tank_id UUID, p_current_volume DECIMAL, p_time_window_minutes INTEGER DEFAULT 60
) RETURNS JSON
SET search_path = public
AS $$
DECLARE
  v_baseline_mean DECIMAL;
  v_baseline_stddev DECIMAL;
  v_z_score DECIMAL;
  v_is_anomaly BOOLEAN;
  v_confidence DECIMAL;
BEGIN
  SELECT AVG(ambient_volume), STDDEV(ambient_volume) INTO v_baseline_mean, v_baseline_stddev
  FROM sensor_readings
  WHERE tank_id = p_tank_id AND timestamp >= NOW() - (p_time_window_minutes || ' minutes')::INTERVAL
    AND timestamp < NOW() - INTERVAL '5 minutes';
  
  IF v_baseline_stddev > 0 THEN
    v_z_score := (p_current_volume - v_baseline_mean) / v_baseline_stddev;
  ELSE
    v_z_score := 0;
  END IF;
  
  v_is_anomaly := v_z_score < -3.0;
  v_confidence := LEAST(100, ABS(v_z_score) * 25);
  
  RETURN json_build_object(
    'is_theft_detected', v_is_anomaly, 'confidence_score', ROUND(v_confidence, 2),
    'z_score', ROUND(v_z_score, 2), 'baseline_mean', ROUND(v_baseline_mean, 2),
    'current_volume', p_current_volume, 'volume_drop', ROUND(v_baseline_mean - p_current_volume, 2)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_supplier_reliability_score(p_supplier_name TEXT) 
RETURNS JSON 
SET search_path = public
AS $$
DECLARE v_score JSON;
BEGIN
  SELECT json_build_object(
    'supplier_name', p_supplier_name, 'total_deliveries', COUNT(*),
    'verified_ok', COUNT(*) FILTER (WHERE verification_status = 'verified_ok'),
    'disputed_shortages', COUNT(*) FILTER (WHERE verification_status = 'disputed_shortage'),
    'avg_variance_percentage', ROUND(AVG(variance_percentage)::NUMERIC, 2),
    'reliability_score', ROUND((COUNT(*) FILTER (WHERE verification_status = 'verified_ok')::DECIMAL / NULLIF(COUNT(*), 0) * 100)::NUMERIC, 2)
  ) INTO v_score
  FROM deliveries WHERE supplier_name = p_supplier_name AND created_at >= NOW() - INTERVAL '12 months';
  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- DATABASE TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_delivery_variance() RETURNS TRIGGER AS $$
BEGIN
  NEW.actual_received_volume := NEW.tank_after_volume - NEW.tank_before_volume;
  IF NEW.bol_claimed_volume > 0 THEN
    NEW.variance_percentage := ROUND(((NEW.bol_claimed_volume - NEW.actual_received_volume) / NEW.bol_claimed_volume * 100)::NUMERIC, 2);
  END IF;
  
  IF ABS(NEW.variance_percentage) <= 1.67 THEN
    NEW.verification_status := 'verified_ok'; NEW.is_accepted := TRUE;
  ELSIF NEW.variance_percentage > 1.67 THEN
    NEW.verification_status := 'disputed_shortage'; NEW.is_accepted := FALSE;
  ELSE
    NEW.verification_status := 'disputed_overage'; NEW.is_accepted := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_calculate_delivery_variance ON deliveries;
CREATE TRIGGER auto_calculate_delivery_variance BEFORE INSERT OR UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION calculate_delivery_variance();

CREATE OR REPLACE FUNCTION check_tank_thresholds() RETURNS TRIGGER AS $$
DECLARE
  v_client_id UUID;
  v_firebase_uid TEXT;
BEGIN
  SELECT client_id, firebase_uid INTO v_client_id, v_firebase_uid FROM tanks WHERE id = NEW.tank_id;
  IF NEW.ambient_volume <= (SELECT low_level_threshold FROM tanks WHERE id = NEW.tank_id) THEN
    INSERT INTO alerts (client_id, tank_id, firebase_uid, alert_type, severity, title, message, alert_data)
    VALUES (v_client_id, NEW.tank_id, v_firebase_uid, 'low_fuel', 'warning', 'Low Fuel Level Alert', 'Tank has reached low fuel threshold. Consider reordering.', json_build_object('current_volume', NEW.ambient_volume, 'threshold', (SELECT low_level_threshold FROM tanks WHERE id = NEW.tank_id)));
  END IF;
  IF NEW.temperature >= (SELECT high_temperature_threshold FROM tanks WHERE id = NEW.tank_id) THEN
    INSERT INTO alerts (client_id, tank_id, firebase_uid, alert_type, severity, title, message, alert_data)
    VALUES (v_client_id, NEW.tank_id, v_firebase_uid, 'high_temperature', 'critical', 'High Temperature Alert', 'Tank temperature has exceeded safety threshold!', json_build_object('current_temp', NEW.temperature, 'threshold', (SELECT high_temperature_threshold FROM tanks WHERE id = NEW.tank_id)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_tank_thresholds_trigger ON sensor_readings;
CREATE TRIGGER check_tank_thresholds_trigger AFTER INSERT ON sensor_readings FOR EACH ROW EXECUTE FUNCTION check_tank_thresholds();

CREATE OR REPLACE FUNCTION log_admin_action() 
RETURNS TRIGGER 
SET search_path = public
AS $$
BEGIN
  IF is_admin() THEN
    INSERT INTO admin_logs (admin_firebase_uid, action_type, affected_client_id, affected_resource_type, affected_resource_id, description, changes_made)
    VALUES (public.firebase_uid(), TG_ARGV[0], CASE WHEN TG_TABLE_NAME = 'client_billing' THEN NEW.id WHEN TG_TABLE_NAME = 'transactions' THEN NEW.client_id ELSE NULL END, TG_TABLE_NAME, NEW.id, TG_ARGV[1], json_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS log_billing_changes ON client_billing;
CREATE TRIGGER log_billing_changes AFTER UPDATE ON client_billing FOR EACH ROW EXECUTE FUNCTION log_admin_action('debt_adjusted', 'Billing record modified');

DROP TRIGGER IF EXISTS log_transaction_creation ON transactions;
CREATE TRIGGER log_transaction_creation AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION log_admin_action('payment_manually_recorded', 'Transaction created');

CREATE OR REPLACE FUNCTION link_tank_to_client() RETURNS TRIGGER AS $$
BEGIN
  SELECT id INTO NEW.client_id FROM client_billing WHERE firebase_uid = NEW.firebase_uid;
  IF NEW.client_id IS NULL THEN
    RAISE EXCEPTION 'Client billing record must exist before creating tank';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_link_tank_to_client ON tanks;
CREATE TRIGGER auto_link_tank_to_client BEFORE INSERT ON tanks FOR EACH ROW EXECUTE FUNCTION link_tank_to_client();

CREATE OR REPLACE FUNCTION prevent_negative_debt() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_debt < 0 THEN
    RAISE EXCEPTION 'Debt cannot be negative. Current attempt: %', NEW.current_debt;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_negative_debt ON client_billing;
CREATE TRIGGER check_negative_debt BEFORE INSERT OR UPDATE ON client_billing FOR EACH ROW EXECUTE FUNCTION prevent_negative_debt();

CREATE OR REPLACE FUNCTION update_tank_from_sensor() RETURNS TRIGGER AS $$
BEGIN
  UPDATE tanks SET current_volume = NEW.ambient_volume, current_temperature = NEW.temperature, standard_volume = NEW.standard_volume, last_reading_at = NEW.timestamp, updated_at = NOW() WHERE id = NEW.tank_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tank_state ON sensor_readings;
CREATE TRIGGER update_tank_state AFTER INSERT ON sensor_readings FOR EACH ROW EXECUTE FUNCTION update_tank_from_sensor();

-- MOCK DATA
INSERT INTO market_prices (fuel_type, price_per_liter, source, effective_date) VALUES
  ('diesel', 180.50, 'epra', CURRENT_DATE),
  ('petrol', 195.30, 'epra', CURRENT_DATE),
  ('kerosene', 165.80, 'epra', CURRENT_DATE)
ON CONFLICT (fuel_type, source, region, effective_date) DO NOTHING;
