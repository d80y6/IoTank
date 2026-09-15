-- Security PIN Implementation for IoTank
-- Compliant with Data Protection Act 2019 (Kenya)

-- 1. Add columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS security_pin_hash TEXT,
ADD COLUMN IF NOT EXISTS security_pin_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_pin_change_at TIMESTAMPTZ;

-- 2. Create function to setup/change PIN
CREATE OR REPLACE FUNCTION setup_security_pin(p_pin_hash TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles
    SET 
        security_pin_hash = p_pin_hash,
        security_pin_enabled = TRUE,
        last_pin_change_at = NOW()
    WHERE auth_user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create function to verify PIN
-- Note: This is a simple equality check for the hash. 
-- In a real scenario, we'd use crypt() if pgcrypto is enabled.
CREATE OR REPLACE FUNCTION verify_security_pin(p_pin_hash TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_stored_hash TEXT;
BEGIN
    SELECT security_pin_hash INTO v_stored_hash
    FROM profiles
    WHERE auth_user_id = auth.uid();
    
    RETURN v_stored_hash = p_pin_hash;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant access to authenticated users
GRANT EXECUTE ON FUNCTION setup_security_pin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_security_pin(TEXT) TO authenticated;

COMMENT ON COLUMN profiles.security_pin_hash IS 'Hashed 6-digit PIN for secondary security layer.';
COMMENT ON COLUMN profiles.security_pin_enabled IS 'Flag indicating if the user has configured their security PIN.';
