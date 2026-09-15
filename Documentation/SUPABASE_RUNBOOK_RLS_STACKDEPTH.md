# Supabase runbook — Inspect 54001 / RLS 403 and apply fixes

This runbook explains how to inspect Postgres/Supabase logs for `54001` (stack depth limit) and 403 RLS failures, and how to apply the safe runtime fixes in `supabase/runtime/rls_and_stackdepth_fixes.sql`.

Important: run these steps in a staging environment first and back up current policy/function definitions.

Steps — inspect logs (Supabase dashboard)
1. Open your Supabase project dashboard.
2. Click **Logs** → filter by `Database` (or search the text box).
3. Search for `54001` or `stack depth` to find the PL/pgSQL stack overflow traces. Open an entry and note the function name and line numbers in the stack trace (e.g. `public.some_fn()` at line N).
4. Search for `403` or `permission denied` to find RLS/permission failures (e.g. when selecting `market_signals`). Note the request context (user role, JWT claims) shown in the log entry.

Steps — inspect policies & functions via Supabase SQL editor
1. Open **SQL** in the Supabase dashboard (or connect with psql if you prefer).
2. Run the diagnostic query to list current policies and their expressions:

```sql
SELECT p.polname, c.relname AS tablename,
       pg_get_expr(p.polqual, p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck_expr
FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid
WHERE c.relnamespace = 'public'::regnamespace
ORDER BY c.relname, p.polname;
```

3. If your logs pointed to a specific function (e.g. `get_user_bundle_v2`), fetch the function definition:

```sql
SELECT n.nspname, p.proname, pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname ILIKE '%get_user_bundle_v2%' OR p.proname ILIKE '%prevent_audit_tampering%';
```

How to apply the fixes I prepared
1. Open file [supabase/runtime/rls_and_stackdepth_fixes.sql](supabase/runtime/rls_and_stackdepth_fixes.sql) in this repo and review the statements.
2. In Supabase SQL editor, paste the contents of that file and run it in staging first.
3. The script will:
   - Create/replace safe helper functions `public.check_is_super_admin()` and `public.check_is_staff()` as SECURITY DEFINER.
   - Recreate the `tanks` and `alerts` update policies to use direct `public.firebase_uid() = firebase_uid` checks (no self-selects).
   - Recreate `market_signals` policies to use `public.firebase_uid()` when matching `client_billing`.
   - Issue `NOTIFY pgrst, 'reload schema'` to refresh PostgREST rules.

Verification after applying the script
1. Re-run the diagnostic policies query above and confirm policy expressions no longer include subselects like `(SELECT firebase_uid FROM alerts WHERE id = alerts.id)`.
2. In your application, reproduce the failed flows:
   - Attempt the `market_signals` query that previously returned 403 and confirm it now returns appropriately for the authenticated user.
   - Re-run the activity that triggered the 54001 trace and check logs for new entries.
3. If you still see 54001, open the stack trace — it will show the exact function(s) and lines involved. Use the function-def query above to grab the full source and look for queries that call back into tables guarded by RLS; refactor such functions to be `SECURITY DEFINER` or rewrite their logic to avoid re-querying the protected table.

Reversion (if needed)
- If something goes wrong, revert by restoring the previous policy definitions you backed up in step 1, or restore a DB snapshot.

Notes & warnings
- Do not run these changes during a high-traffic production window without a tested rollback plan.
- Always test in staging. The SQL is intentionally conservative and idempotent, but environment differences (custom policies / functions) can change effects.

If you want, I can:
- provide a one-click SQL blob ready to paste into Supabase SQL editor, or
- prepare a small migration file (already added) you can deploy via your CI/CD pipeline.
