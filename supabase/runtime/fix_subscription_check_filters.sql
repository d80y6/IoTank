-- fix_subscription_check_filters.sql
-- Snapshot + safe CREATE OR REPLACE for realtime.subscription_check_filters
-- Run this in your Supabase *staging* SQL editor. This file:
-- 1) creates a backup table (if missing)
-- 2) snapshots the current function definition into the backup table
-- 3) replaces the function with a corrected version that uses SELECT ... INTO
-- IMPORTANT: review the row inserted into supabase_backups.function_backups_v2 before applying to production.

BEGIN;

-- 1) Ensure backup schema & table exist
CREATE SCHEMA IF NOT EXISTS supabase_backups;
CREATE TABLE IF NOT EXISTS supabase_backups.function_backups_v2 (
  id BIGSERIAL PRIMARY KEY,
  schema_name TEXT,
  function_name TEXT,
  oid OID,
  definition TEXT,
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- 2) Snapshot the function definition (only if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
  ) THEN
    INSERT INTO supabase_backups.function_backups_v2(schema_name, function_name, oid, definition)
    SELECT n.nspname, p.proname, p.oid, pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters';
    RAISE NOTICE 'Snapshot saved to supabase_backups.function_backups_v2';
  ELSE
    RAISE NOTICE 'Function realtime.subscription_check_filters not found; skipping snapshot';
  END IF;
END$$;

-- 3) Replace the function with a corrected implementation
-- This uses SELECT ... INTO for aggregates instead of embedding an aggregate with a bare FROM clause.
CREATE OR REPLACE FUNCTION realtime.subscription_check_filters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  col_names TEXT[];
  filter realtime.user_defined_filter;
  col_type REGTYPE;
  in_val JSONB;
BEGIN
  -- collect column names the role can SELECT
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

  FOR filter IN SELECT * FROM unnest(NEW.filters) LOOP
    IF NOT filter.column_name = ANY(col_names) THEN
      RAISE EXCEPTION 'invalid column for filter %', filter.column_name;
    END IF;

    SELECT atttypid::regtype INTO col_type
    FROM pg_catalog.pg_attribute
    WHERE attrelid = NEW.entity
      AND attname = filter.column_name;

    IF col_type IS NULL THEN
      RAISE EXCEPTION 'failed to lookup type for column %', filter.column_name;
    END IF;

    IF filter.op = 'in'::realtime.equality_op THEN
      in_val := realtime.cast(filter.value, (col_type::text || '[]')::regtype);
      IF COALESCE(jsonb_array_length(in_val), 0) > 100 THEN
        RAISE EXCEPTION 'too many values for `in` filter. Maximum 100';
      END IF;
    ELSE
      PERFORM realtime.cast(filter.value, col_type);
    END IF;
  END LOOP;

  -- normalize ordering of filters to make (subscription_id, entity, filters) stable
  SELECT COALESCE(array_agg(f ORDER BY f.column_name, f.op, f.value), ARRAY[]::realtime.user_defined_filter[])
  INTO NEW.filters
  FROM unnest(NEW.filters) AS f;

  RETURN NEW;
END;
$$;

COMMIT;

-- NOTES:
-- - Run this in staging first. Verify the backup row at supabase_backups.function_backups_v2.
-- - If pg_get_functiondef fails during snapshot, run a manual SELECT pg_get_functiondef(p.oid) for the specific OID and capture it.
-- - Do NOT apply to production without testing in staging.
