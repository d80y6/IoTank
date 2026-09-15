# URGENT FOLLOW-UP: realtime.subscription_check_filters Fix NOT Applied

## Previous Ticket Reference
- **Original Issue**: Invalid PostgreSQL syntax in realtime.subscription_check_filters (OID: 17157)
- **Your Response**: "Applied fix... deployment/execution step succeeded"
- **Verification**: Function definition is IDENTICAL to backup - no changes applied

## Problem Still Exists

**Verification Results:**
- ✅ Function exists: `true`
- ❌ Function definition: **UNCHANGED** - still contains invalid syntax
- ✅ Backup preserved: Shows same broken definition

**Current Function Definition** (from `pg_get_functiondef`):
```sql
-- STILL BROKEN - Same as backup from May 11, 2026
declare
    col_names text[] = coalesce(
            array_agg(c.column_name order by c.ordinal_position),
            '{}'::text[]
        )
        from information_schema.columns c
    where ...
```

**Expected Fixed Definition:**
```sql
-- SHOULD BE:
DECLARE
  col_names TEXT[];
BEGIN
  SELECT COALESCE(array_agg(c.column_name ORDER BY c.ordinal_position), '{}'::text[])
  INTO col_names
  FROM information_schema.columns c
  WHERE ...
```

## Evidence

**Backup Query Results:**
```sql
SELECT * FROM supabase_backups.function_backups_v2
WHERE function_name = 'subscription_check_filters'
ORDER BY captured_at DESC LIMIT 1;
```
Returns the EXACT same broken definition as current function.

**Live Function Query:**
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'subscription_check_filters'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'realtime');
```
Returns IDENTICAL broken syntax.

## Impact on Production

- **Realtime subscriptions with filters FAIL**
- **IoTank application live updates BROKEN**
- **Users cannot monitor fuel tank data in real-time**
- **Critical business functionality affected**

## Requested Action

**Please actually apply the corrected function SQL from the original ticket.** The deployment step may have "succeeded" but the function definition was not changed.

**Corrected SQL to Apply:**
```sql
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

## Verification After Fix

**Please confirm the fix by running:**
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'subscription_check_filters'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'realtime');
```

**Look for:** `SELECT ... INTO col_names` instead of the broken declaration.

---

**This is a critical production issue affecting realtime functionality. Please apply the actual fix and confirm with verification queries.**

**Project ID**: [Your project ID]
**Urgency**: CRITICAL - Production realtime features broken