# Supabase Realtime Function Fix - Troubleshooting Guide

## Problem Summary

You're unable to modify `realtime.subscription_check_filters` because:

1. **Function Ownership**: The function is owned by `supabase_admin` (Supabase's managed role)
2. **Web Editor Limitation**: Even the `postgres` superuser in Supabase's web SQL editor cannot modify functions owned by `supabase_admin`
3. **This is a Supabase service limitation**, not a PostgreSQL limitation

---

## Root Cause

The error `ERROR: 42501: must be owner of function subscription_check_filters` occurs because:

```sql
-- Current (broken) function signature:
declare
    col_names text[] = coalesce(
            array_agg(c.column_name order by c.ordinal_position),
            '{}'::text[]
        )
        from information_schema.columns c
    where ...
```

This is **invalid PostgreSQL syntax** - you cannot use an aggregate function (`array_agg`) in a variable declaration with a `FROM` clause. It should be:

```sql
-- Corrected version:
SELECT COALESCE(array_agg(c.column_name ORDER BY c.ordinal_position), '{}'::text[])
INTO col_names
FROM information_schema.columns c
WHERE ...
```

---

## Solutions (in order of preference)

### Option 1: Contact Supabase Support ⭐ RECOMMENDED

**Steps:**
1. Go to **Supabase Dashboard** → **Help** (bottom left) → **Send Feedback** or **Contact Support**
2. Describe the issue:
   - Function: `realtime.subscription_check_filters` (OID: 17157)
   - Problem: Invalid PostgreSQL syntax in function definition
   - Request: Either:
     - Fix the function ownership so it can be modified
     - Apply the corrected version below
3. Provide them with the corrected SQL (see below)

**Time:** Usually 24-48 hours

---

### Option 2: Direct Database Connection (Paid Plans Only)

⚠️ **NOT available on free tier** - Only Pro and higher plans have direct connections.

If you upgrade to Pro, you can:
1. In Dashboard → **Project Settings** → **Database**, check for "Direct Connections"
2. Use that connection string with a direct `psql` client (not the web editor)
3. Run the fix script with actual database credentials

**For now (on free tier)**: Skip this option.

---

### Option 3: Workaround - Disable Realtime Temporarily

If this function is blocking your application:

1. **Disable realtime for affected tables**:
```sql
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS <table_name>;
```

2. Once Supabase fixes the function, re-enable:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE <table_name>;
```

---

## Corrected Function Definition

**Send this to Supabase support:**

```sql
-- Corrected realtime.subscription_check_filters function
-- Fix: Changed from aggregate-in-declaration to SELECT...INTO

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
  -- Collect column names the role can SELECT
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

    SELECT atttypid::regtype
    INTO col_type
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

  SELECT COALESCE(array_agg(f ORDER BY f.column_name, f.op, f.value), ARRAY[]::realtime.user_defined_filter[])
  INTO NEW.filters
  FROM unnest(NEW.filters) AS f;

  RETURN NEW;
END;
$$;
```

---

## Current Function Status

**Backup captured:**
```
schema_name: realtime
function_name: subscription_check_filters
oid: 17157
captured_at: 2026-05-11 17:26:32.101469+00
```

The broken definition is safely backed up in `supabase_backups.function_backups_v2`.

---

## Why This Matters

This function validates realtime subscription filters. If it has invalid syntax:
- **Realtime subscriptions may fail** when certain filters are used
- **Query validation** won't work properly
- **Data access patterns** might be broken for subscriptions

---

## What NOT to Do

❌ Don't try to grant `supabase_admin` permissions directly  
❌ Don't try to change role ownership of system functions  
❌ Don't disable Realtime entirely without contacting support

---

## Next Steps

1. **Immediate**: Contact Supabase support with the corrected function SQL (provided above)
2. **Meanwhile**: Monitor if realtime subscriptions are working properly in your app
3. **If critical**: Use Option 3 (disable realtime temporarily) for affected tables

---

**Need help?** Reference this issue when contacting Supabase:
- **Function OID**: 17157
- **Schema**: realtime
- **Problem**: Invalid PostgreSQL syntax in function declaration
- **Fix**: Use SELECT...INTO instead of aggregate-in-declaration
