-- discovery_no_agg.sql
-- Lightweight discovery queries (no aggregates) to list tables/columns/policies/functions
-- Run this in your Supabase staging SQL editor and paste outputs here.

-- 0) Quick existence checks
SELECT to_regclass('public.market_signals') AS market_signals, to_regclass('public.client_billing') AS client_billing, to_regclass('public.tanks') AS tanks, to_regclass('public.alerts') AS alerts;

-- 1) Tables with client/market/billing in name (public schema)
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name ILIKE '%client%' OR table_name ILIKE '%market%' OR table_name ILIKE '%billing%' OR table_name ILIKE '%signals%')
ORDER BY table_name;

-- 2) Columns named client_id or identity columns of interest
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('client_id','supabase_uid','firebase_uid','supabase_id','supabase_user_id','supabase_userid')
ORDER BY table_name, column_name;

-- 3) Columns for specific tables (market_signals, client_billing, profiles)
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('market_signals','client_billing','profiles','tanks','alerts')
ORDER BY table_name, ordinal_position;

-- 4) Foreign keys referencing client_billing (if exists)
SELECT tc.table_schema, tc.table_name, kcu.column_name AS fk_column,
       ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'client_billing'
ORDER BY tc.table_name;

-- 5) Policies that mention client_billing, firebase_uid, supabase_uid, auth.uid
SELECT c.relname AS table_name, p.polname,
       pg_get_expr(p.polqual,p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck,p.polrelid) AS with_check
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE COALESCE(pg_get_expr(p.polqual,p.polrelid),'') ILIKE '%client_billing%'
   OR COALESCE(pg_get_expr(p.polqual,p.polrelid),'') ILIKE '%firebase_uid%'
   OR COALESCE(pg_get_expr(p.polqual,p.polrelid),'') ILIKE '%supabase_uid%'
   OR COALESCE(pg_get_expr(p.polqual,p.polrelid),'') ILIKE '%auth.uid%'
ORDER BY c.relname, p.polname;

-- 6) Functions (public/auth) whose source mentions these identifiers
SELECT n.nspname, p.proname,
       substring(pg_get_functiondef(p.oid) from 1 for 2000) AS snippet
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%client_billing%'
   OR pg_get_functiondef(p.oid) ILIKE '%firebase_uid%'
   OR pg_get_functiondef(p.oid) ILIKE '%supabase_uid%'
   OR pg_get_functiondef(p.oid) ILIKE '%auth.uid%'
ORDER BY n.nspname, p.proname;

-- 7) If market_signals exists: show its columns and a single row (limit 1) to inspect structure
-- 7) Avoid selecting rows (this can trigger RLS/policy evaluation). List columns only for inspection.
SELECT table_schema, table_name, column_name, ordinal_position, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='market_signals'
ORDER BY ordinal_position;

-- 8) Scan for uses of array_agg across DB objects (functions, policies, views, constraints)
-- Functions whose source mentions array_agg
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE pg_get_functiondef(p.oid) ILIKE '%array_agg%'
ORDER BY n.nspname, p.proname;

-- Policies that include array_agg in their expressions
SELECT c.relname AS table_name, p.polname,
       pg_get_expr(p.polqual,p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck,p.polrelid) AS with_check
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE COALESCE(pg_get_expr(p.polqual,p.polrelid),'') ILIKE '%array_agg%'
ORDER BY c.relname, p.polname;

-- Views that mention array_agg
SELECT schemaname, viewname, definition
FROM pg_views
WHERE definition ILIKE '%array_agg%'
ORDER BY schemaname, viewname;

-- Constraints that mention array_agg (rare but possible inside check constraints)
SELECT conname, contype, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE pg_get_constraintdef(c.oid) ILIKE '%array_agg%'
ORDER BY conname;

-- End of discovery_no_agg.sql
