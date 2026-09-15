#!/usr/bin/env python3
"""
Fix realtime.subscription_check_filters function in Supabase
This script connects directly to your database and recreates the function with correct syntax.
"""

import sys
import os
from urllib.parse import urlparse

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 not installed.")
    print("Install it with: pip install psycopg2-binary")
    sys.exit(1)


def fix_subscription_check_filters(connection_string: str):
    """Fix the subscription_check_filters function."""
    
    # Parse connection string
    try:
        parsed = urlparse(connection_string)
        conn_params = {
            'host': parsed.hostname,
            'port': parsed.port or 5432,
            'database': parsed.path.lstrip('/') or 'postgres',
            'user': parsed.username,
            'password': parsed.password,
        }
    except Exception as e:
        print(f"ERROR: Failed to parse connection string: {e}")
        return False
    
    try:
        # Connect to database
        print(f"Connecting to {conn_params['host']}:{conn_params['port']}/{conn_params['database']}...")
        conn = psycopg2.connect(**conn_params)
        conn.autocommit = False
        cursor = conn.cursor()
        print("✓ Connected successfully")
        
        # Begin transaction
        cursor.execute("BEGIN;")
        
        # 1) Create backup schema and table
        print("\n1) Creating backup schema and table...")
        cursor.execute("""
            CREATE SCHEMA IF NOT EXISTS supabase_backups;
            CREATE TABLE IF NOT EXISTS supabase_backups.function_backups_v2 (
              id BIGSERIAL PRIMARY KEY,
              schema_name TEXT,
              function_name TEXT,
              oid OID,
              definition TEXT,
              captured_at TIMESTAMPTZ DEFAULT now()
            );
        """)
        print("✓ Backup infrastructure ready")
        
        # 2) Backup current function definition
        print("\n2) Backing up current function definition...")
        cursor.execute("""
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
        """)
        print("✓ Function backed up")
        
        # 3) Drop existing function
        print("\n3) Dropping existing function...")
        cursor.execute("""
            DROP FUNCTION IF EXISTS realtime.subscription_check_filters() CASCADE;
        """)
        print("✓ Function dropped")
        
        # 4) Recreate with corrected syntax
        print("\n4) Recreating function with corrected syntax...")
        create_function_sql = """
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
        """
        cursor.execute(create_function_sql)
        print("✓ Function recreated with corrected syntax")
        
        # 5) Verify
        print("\n5) Verifying function exists...")
        cursor.execute("""
            SELECT EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
              WHERE n.nspname = 'realtime' AND p.proname = 'subscription_check_filters'
            );
        """)
        exists = cursor.fetchone()[0]
        
        if exists:
            print("✓ Function verified")
        else:
            print("✗ Function verification failed")
            conn.rollback()
            return False
        
        # Commit
        conn.commit()
        cursor.close()
        conn.close()
        
        print("\n" + "="*60)
        print("SUCCESS: subscription_check_filters function has been fixed!")
        print("="*60)
        return True
        
    except psycopg2.Error as e:
        print(f"\n✗ Database error: {e}")
        try:
            conn.rollback()
            conn.close()
        except:
            pass
        return False
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python fix_function.py <connection_string>")
        print("\nExample:")
        print("  python fix_function.py 'postgresql://postgres:password@host:5432/postgres'")
        sys.exit(1)
    
    connection_string = sys.argv[1]
    success = fix_subscription_check_filters(connection_string)
    sys.exit(0 if success else 1)
