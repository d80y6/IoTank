-- supabase/migrations/20260506160000_performance_and_access_linter_fixes.sql
-- ============================================================================
-- RESOLVING RLS INITIALIZATION PLAN AND PUBLIC ACCESS LINTER WARNINGS
-- ============================================================================

-- 1. Automate Fix for auth_rls_initplan
-- The linter flags policies that use auth.uid() directly because Postgres 
-- evaluates the function per-row, causing severe performance degradation.
-- This PL/pgSQL block automatically rewrites all existing public RLS policies
-- to wrap auth.uid() and auth.jwt() in a (select ...) subquery for cacheable 
-- execution plans.

DO $$
DECLARE
    pol record;
    new_qual text;
    new_with_check text;
    recreate_stmt text;
    roles_text text;
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        -- Only process policies containing auth.uid() or auth.jwt()
        IF (pol.qual LIKE '%auth.uid()%' OR pol.qual LIKE '%auth.jwt()%' OR 
            pol.with_check LIKE '%auth.uid()%' OR pol.with_check LIKE '%auth.jwt()%') THEN
            
            -- Normalize: remove existing '(select auth.uid())' to prevent double wrapping
            new_qual := COALESCE(pol.qual, '');
            new_qual := REPLACE(new_qual, '(select auth.uid())', 'auth.uid()');
            new_qual := REPLACE(new_qual, '(SELECT auth.uid())', 'auth.uid()');
            new_qual := REPLACE(new_qual, '(select auth.jwt())', 'auth.jwt()');
            new_qual := REPLACE(new_qual, '(SELECT auth.jwt())', 'auth.jwt()');
            
            -- Apply the performance wrapper
            new_qual := REPLACE(new_qual, 'auth.uid()', '(select auth.uid())');
            new_qual := REPLACE(new_qual, 'auth.jwt()', '(select auth.jwt())');

            new_with_check := COALESCE(pol.with_check, '');
            new_with_check := REPLACE(new_with_check, '(select auth.uid())', 'auth.uid()');
            new_with_check := REPLACE(new_with_check, '(SELECT auth.uid())', 'auth.uid()');
            new_with_check := REPLACE(new_with_check, '(select auth.jwt())', 'auth.jwt()');
            new_with_check := REPLACE(new_with_check, '(SELECT auth.jwt())', 'auth.jwt()');

            new_with_check := REPLACE(new_with_check, 'auth.uid()', '(select auth.uid())');
            new_with_check := REPLACE(new_with_check, 'auth.jwt()', '(select auth.jwt())');
            
            -- Construct the DROP statement
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
            
            -- Prepare the roles
            roles_text := array_to_string(pol.roles, ', ');
            IF roles_text = 'public' THEN
                roles_text := 'PUBLIC';
            END IF;

            -- Construct the CREATE statement
            recreate_stmt := format('CREATE POLICY %I ON %I.%I FOR %s TO %s', 
                                    pol.policyname, pol.schemaname, pol.tablename, pol.cmd, roles_text);
            
            IF new_qual <> '' THEN
                recreate_stmt := recreate_stmt || ' USING (' || new_qual || ')';
            END IF;
            
            IF new_with_check <> '' THEN
                recreate_stmt := recreate_stmt || ' WITH CHECK (' || new_with_check || ')';
            END IF;
            
            -- Execute the replacement
            EXECUTE recreate_stmt;
        END IF;
    END LOOP;
END;
$$;


-- 2. Revoke unauthenticated access to global tables
-- The linter flagged global_announcements, market_prices, and dashboard_banners 
-- as being accessible by 'anon' due to the default PUBLIC role assignment.

-- Dashboard Banners
DROP POLICY IF EXISTS "Admins full access to banners" ON public.dashboard_banners;
DROP POLICY IF EXISTS "Authenticated users can view market prices" ON public.market_prices;
CREATE POLICY "Admins full access to banners" ON public.dashboard_banners
    FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = (select auth.uid()) AND is_active = TRUE));

DROP POLICY IF EXISTS "Everyone can read active banners" ON public.dashboard_banners;
CREATE POLICY "Everyone can read active banners" ON public.dashboard_banners
    FOR SELECT TO authenticated USING (is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()));

-- Global Announcements
DROP POLICY IF EXISTS "Admins full access to announcements" ON public.global_announcements;
CREATE POLICY "Admins full access to announcements" ON public.global_announcements
    FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.system_users WHERE auth_user_id = (select auth.uid()) AND is_active = TRUE));

DROP POLICY IF EXISTS "Everyone can read announcements" ON public.global_announcements;
CREATE POLICY "Everyone can read announcements" ON public.global_announcements
    FOR SELECT TO authenticated USING (status = 'sent' AND target_audience = 'All');

-- Market Prices
DROP POLICY IF EXISTS "Anyone can view market prices" ON public.market_prices;
DROP POLICY IF EXISTS "Everyone can see market prices" ON public.market_prices;
CREATE POLICY "Authenticated users can view market prices" ON public.market_prices
    FOR SELECT TO authenticated USING (true);

