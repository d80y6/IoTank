# Supabase Support Ticket: Fix realtime.subscription_check_filters Function

## Subject
URGENT: Invalid PostgreSQL syntax in realtime.subscription_check_filters function (OID: 17157) - Breaking realtime subscriptions

## Issue Description

**Problem**: The `realtime.subscription_check_filters` function contains invalid PostgreSQL syntax that prevents proper realtime subscription validation.

**Error**: `ERROR: 42501: must be owner of function subscription_check_filters` when attempting to fix via SQL Editor

**Impact**: Realtime subscriptions may fail when using filters, potentially breaking live data updates in our IoTank fuel management application.

## Technical Details

### Current Function Status
- **Schema**: `realtime`
- **Function**: `subscription_check_filters`
- **OID**: `17157`
- **Owner**: `supabase_admin` (managed role)
- **Issue**: Invalid aggregate function usage in variable declaration

### Root Cause
The function uses incorrect PostgreSQL syntax:

```sql
-- BROKEN (current):
declare
    col_names text[] = coalesce(
            array_agg(c.column_name order by c.ordinal_position),
            '{}'::text[]
        )
        from information_schema.columns c
    where ...
```

This is **invalid** - you cannot use aggregate functions (`array_agg`) with `FROM` clauses in variable declarations.

### Corrected Syntax
Should be:

```sql
-- FIXED (correct):
DECLARE
  col_names TEXT[];
BEGIN
  SELECT COALESCE(array_agg(c.column_name ORDER BY c.ordinal_position), '{}'::text[])
  INTO col_names
  FROM information_schema.columns c
  WHERE ...
```

## Requested Solution

Please apply the corrected function definition below to fix the syntax error. The function should be recreated with proper `SELECT ... INTO` syntax.

## Corrected Function SQL

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

## Backup Information

I have safely backed up the current (broken) function definition in my database:

**Backup Location**: `supabase_backups.function_backups_v2`
**Backup ID**: (Check with this query after fix)
```sql
SELECT * FROM supabase_backups.function_backups_v2
WHERE function_name = 'subscription_check_filters'
ORDER BY captured_at DESC LIMIT 1;
```

**Current Broken Definition** (for reference):
```
CREATE OR REPLACE FUNCTION realtime.subscription_check_filters()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $function$
```

## Verification Steps

After applying the fix, please verify:

1. **Function exists and is valid**:
```sql
SELECT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
);
```

2. **Function definition uses correct syntax**:
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'subscription_check_filters'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'realtime');
```

3. **Realtime subscriptions work** (test with a simple subscription)

## Project Information

- **Project ID**: [Your project ID - visible in dashboard URL]
- **Plan**: Free tier
- **Application**: IoTank V2.0.0 - Fuel station management system
- **Affected Feature**: Realtime data subscriptions for live tank readings, alerts, etc.

## Urgency

**High** - This affects realtime functionality in our production application. Users rely on live data updates for fuel tank monitoring.

## Additional Context

This function validates realtime subscription filters before they're applied. The invalid syntax may cause:
- Subscription failures when filters are used
- Inconsistent data access patterns
- Potential security issues with filter validation

The fix is straightforward - just replace the broken aggregate-in-declaration syntax with proper SELECT...INTO statements.

---

**Please apply the corrected function SQL above and let me know once completed so I can verify the fix works properly.**

Thank you for your assistance!