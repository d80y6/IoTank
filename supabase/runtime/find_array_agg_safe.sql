-- find_array_agg_safe.sql
-- Safe search for occurrences of the literal "array_agg" across DB object source text
-- Run in staging SQL editor and paste outputs here.

-- 1) Functions: search pg_proc.prosrc (text) to avoid pg_get_functiondef execution
SELECT n.nspname AS schema_name, p.proname AS function_name, p.oid,
       substring(p.prosrc from 1 for 2000) AS source_snippet
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prosrc ILIKE '%array_agg%'
ORDER BY n.nspname, p.proname;

-- 2) Views: check pg_views.definition
SELECT schemaname, viewname, definition
FROM pg_views
WHERE definition ILIKE '%array_agg%'
ORDER BY schemaname, viewname;

-- 3) Materialized views
SELECT schemaname, matviewname, definition
FROM pg_matviews
WHERE definition ILIKE '%array_agg%'
ORDER BY schemaname, matviewname;

-- 4) Constraints (check constraints etc.)
SELECT connamespace::regnamespace::text AS schema_name, conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE pg_get_constraintdef(c.oid) ILIKE '%array_agg%'
ORDER BY conname;

-- 5) Rewrite rules
SELECT ev_class::regclass::text AS table_name, r.rulename, pg_get_ruledef(r.oid) AS rule_definition
FROM pg_rewrite r
WHERE pg_get_ruledef(r.oid) ILIKE '%array_agg%'
ORDER BY table_name, r.rulename;

-- 6) Triggers that call functions whose source contains array_agg
SELECT t.tgname AS trigger_name, t.tgrelid::regclass::text AS table_name, p.proname AS function_name, n.nspname AS function_schema
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prosrc ILIKE '%array_agg%'
ORDER BY table_name, trigger_name;

-- 7) Policies: try to list policy names (avoid pg_get_expr to reduce risk). We'll show policy rows; inspect later via safer tooling if needed.
SELECT oid, polname, polrelid, polcmd
FROM pg_policy
WHERE polname ILIKE '%array_agg%'
ORDER BY polname;

-- End
