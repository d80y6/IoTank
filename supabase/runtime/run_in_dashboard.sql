-- ============================================================
-- SQL to Fix realtime.subscription_check_filters
-- Copy & paste this into Supabase Dashboard SQL Editor
-- Run as: postgres user
-- ============================================================

-- Step 1: Create backup infrastructure
CREATE SCHEMA IF NOT EXISTS supabase_backups;

CREATE TABLE IF NOT EXISTS supabase_backups.function_backups_v2 (
  id BIGSERIAL PRIMARY KEY,
  schema_name TEXT,
  function_name TEXT,
  oid OID,
  definition TEXT,
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- Step 2: Backup the current (broken) function definition
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
  ) THEN
    INSERT INTO supabase_backups.function_backups_v2(schema_name, function_name, oid, definition)
    SELECT n.nspname, p.proname, p.oid, pg_get_functiondef(p.oid)
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters';
    
    RAISE NOTICE 'BACKUP SAVED: Check supabase_backups.function_backups_v2';
  END IF;
END$$;

-- Step 3: Drop the existing function
-- NOTE: If this fails with "must be owner of function", you'll need to:
--   - Contact Supabase support
--   - Or manually run: ALTER FUNCTION realtime.subscription_check_filters() OWNER TO postgres;
--   Then rerun this DROP statement

DROP FUNCTION IF EXISTS realtime.subscription_check_filters() CASCADE;

-- Step 4: Recreate with corrected syntax
-- CHANGE: Uses SELECT ... INTO instead of aggregate in variable declaration
CREATE FUNCTION realtime.subscription_check_filters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col_names TEXT[];
  filter realtime.user_defined_filter;
  col_type REGTYPE;
  in_val JSONB;
BEGIN
  -- Collect column names the role can SELECT using SELECT ... INTO
  SELECT COALESCE(array_agg(c.column_name ORDER BY c.ordinal_position), '{}'::text[])
  INTO col_names
  FROM information_schema.columns c
  WHERE format('%I.%I', c.table_schema, c.table_name)::regclass = NEW.entity
    AND pg_catalog.has_column_privilege(
      (NEW.claims ->> 'role'),
      format('%I.%I', c.table_schema, c.table_name)::regclass,
      c.column_name,
      'SELECT'
    );

  -- Validate each filter
  FOR filter IN SELECT * FROM unnest(NEW.filters) LOOP
    -- Check if filtered column is valid
    IF NOT filter.column_name = ANY(col_names) THEN
      RAISE EXCEPTION 'invalid column for filter %', filter.column_name;
    END IF;

    -- Get the column type using SELECT ... INTO
    SELECT atttypid::regtype
    INTO col_type
    FROM pg_catalog.pg_attribute
    WHERE attrelid = NEW.entity
      AND attname = filter.column_name;

    IF col_type IS NULL THEN
      RAISE EXCEPTION 'failed to lookup type for column %', filter.column_name;
    END IF;

    -- Validate filter value
    IF filter.op = 'in'::realtime.equality_op THEN
      in_val := realtime.cast(filter.value, (col_type::text || '[]')::regtype);
      IF COALESCE(jsonb_array_length(in_val), 0) > 100 THEN
        RAISE EXCEPTION 'too many values for `in` filter. Maximum 100';
      END IF;
    ELSE
      PERFORM realtime.cast(filter.value, col_type);
    END IF;
  END LOOP;

  -- Apply consistent order to filters for unique constraint on (subscription_id, entity, filters)
  SELECT COALESCE(array_agg(f ORDER BY f.column_name, f.op, f.value), ARRAY[]::realtime.user_defined_filter[])
  INTO NEW.filters
  FROM unnest(NEW.filters) AS f;

  RETURN NEW;
END;
$$;

-- Step 5: Verify the fix worked
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
  ) THEN
    RAISE NOTICE 'SUCCESS: Function recreated with corrected syntax';
  ELSE
    RAISE EXCEPTION 'FAILED: Function not found after recreation';
  END IF;
END$$;

-- ============================================================
-- VERIFICATION (run these after the script completes)
-- ============================================================

-- Check the backup was captured:
-- SELECT * FROM supabase_backups.function_backups_v2 
-- WHERE function_name = 'subscription_check_filters' 
-- ORDER BY captured_at DESC LIMIT 1;

-- Check the new function definition (should use SELECT ... INTO):
-- SELECT pg_get_functiondef(oid) 
-- FROM pg_proc 
-- WHERE proname = 'subscription_check_filters' 
--   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'realtime');
