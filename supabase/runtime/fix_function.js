#!/usr/bin/env node

/**
 * Fix realtime.subscription_check_filters function in Supabase
 * Usage: node fix_function.js "postgresql://postgres:password@host:5432/postgres"
 */

const { URL } = require('url');

// Try to use pg if available, otherwise guide user
let pg;
try {
  pg = require('pg');
} catch (e) {
  console.error('ERROR: pg package not installed.');
  console.error('Install it with: npm install pg');
  process.exit(1);
}

const { Client } = pg;

async function fixSubscriptionCheckFilters(connectionString) {
  const client = new Client({ connectionString });
  
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('✓ Connected successfully\n');
    
    // Start transaction
    await client.query('BEGIN;');
    
    // 1) Create backup infrastructure
    console.log('1) Creating backup schema and table...');
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS supabase_backups;
      CREATE TABLE IF NOT EXISTS supabase_backups.function_backups_v2 (
        id BIGSERIAL PRIMARY KEY,
        schema_name TEXT,
        function_name TEXT,
        oid OID,
        definition TEXT,
        captured_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log('✓ Backup infrastructure ready\n');
    
    // 2) Backup current function definition
    console.log('2) Backing up current function definition...');
    await client.query(`
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
    `);
    console.log('✓ Function backed up\n');
    
    // 3) Drop existing function
    console.log('3) Dropping existing function...');
    await client.query(`
      DROP FUNCTION IF EXISTS realtime.subscription_check_filters() CASCADE;
    `);
    console.log('✓ Function dropped\n');
    
    // 4) Recreate with corrected syntax
    console.log('4) Recreating function with corrected syntax...');
    const createFunctionSQL = `
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
              RAISE EXCEPTION 'too many values for \`in\` filter. Maximum 100';
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
    `;
    await client.query(createFunctionSQL);
    console.log('✓ Function recreated with corrected syntax\n');
    
    // 5) Verify
    console.log('5) Verifying function exists...');
    const result = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
      );
    `);
    
    if (result.rows[0].exists) {
      console.log('✓ Function verified\n');
    } else {
      throw new Error('Function verification failed');
    }
    
    // Commit
    await client.query('COMMIT;');
    await client.end();
    
    console.log('='.repeat(60));
    console.log('SUCCESS: subscription_check_filters function has been fixed!');
    console.log('='.repeat(60));
    return true;
    
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    try {
      await client.query('ROLLBACK;');
    } catch (e) {
      // Ignore rollback errors
    }
    try {
      await client.end();
    } catch (e) {
      // Ignore end errors
    }
    return false;
  }
}

// Main
if (process.argv.length < 3) {
  console.log('Usage: node fix_function.js <connection_string>');
  console.log('\nExample:');
  console.log('  node fix_function.js "postgresql://postgres:password@host:5432/postgres"');
  process.exit(1);
}

const connectionString = process.argv[2];
fixSubscriptionCheckFilters(connectionString)
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
