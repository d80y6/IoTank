# Script to fix subscription_check_filters using direct psql connection (Windows/PowerShell)
# Usage: .\fix_function.ps1 -ConnectionString "postgresql://user:password@host:port/database"

param(
    [Parameter(Mandatory=$true)]
    [string]$ConnectionString,
    
    [string]$PsqlPath = "psql"
)

# Verify psql is available
$psqlTest = & $PsqlPath --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "psql not found. Please ensure PostgreSQL client tools are installed and in PATH."
    exit 1
}

Write-Host "PostgreSQL client version: $psqlTest"

# Create temporary SQL file
$tmpFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.sql'

$sqlContent = @'
-- Direct approach: Backup and forcefully recreate the function
BEGIN;

-- 1) Create backup schema & table
CREATE SCHEMA IF NOT EXISTS supabase_backups;
CREATE TABLE IF NOT EXISTS supabase_backups.function_backups_v2 (
  id BIGSERIAL PRIMARY KEY,
  schema_name TEXT,
  function_name TEXT,
  oid OID,
  definition TEXT,
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- 2) Backup current definition if it exists
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
    RAISE NOTICE 'Backup saved';
  END IF;
END$$;

-- 3) Drop with CASCADE
DROP FUNCTION IF EXISTS realtime.subscription_check_filters() CASCADE;

-- 4) Recreate corrected version
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

-- 5) Verify
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
  ) THEN
    RAISE NOTICE 'SUCCESS: Function recreated';
  ELSE
    RAISE EXCEPTION 'FAILED: Function not found after recreation';
  END IF;
END$$;

COMMIT;
'@

# Write SQL to temp file
Set-Content -Path $tmpFile -Value $sqlContent
Write-Host "Created temporary SQL file: $tmpFile"

# Execute
Write-Host "Connecting to database and executing migration..."
& $PsqlPath $ConnectionString -f $tmpFile

# Check result
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Migration completed successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
}

# Cleanup
Remove-Item -Path $tmpFile -Force
Write-Host "Cleaned up temporary file"
