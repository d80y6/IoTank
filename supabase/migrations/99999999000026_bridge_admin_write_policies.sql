-- Bridge: several admin-managed tables have only SELECT policies, so writes
-- from the admin panel are silently denied (RLS blocks, then PGRST116 on
-- the read-back). Add write policies for the tables the admin panel edits.

-- Helper: idempotent policy drop/create. Assumes check_is_staff() as the gate.

-- jurisdiction_configs
DROP POLICY IF EXISTS "Staff can write jurisdiction_configs" ON public.jurisdiction_configs;
CREATE POLICY "Staff can write jurisdiction_configs"
    ON public.jurisdiction_configs FOR ALL
    TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());

-- report_templates
DROP POLICY IF EXISTS "Staff can write report_templates" ON public.report_templates;
CREATE POLICY "Staff can write report_templates"
    ON public.report_templates FOR ALL
    TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());

-- supply_risks
DROP POLICY IF EXISTS "Staff can write supply_risks" ON public.supply_risks;
CREATE POLICY "Staff can write supply_risks"
    ON public.supply_risks FOR ALL
    TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());

-- support_categories
DROP POLICY IF EXISTS "Staff can write support_categories" ON public.support_categories;
CREATE POLICY "Staff can write support_categories"
    ON public.support_categories FOR ALL
    TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());

-- canned_responses
DROP POLICY IF EXISTS "Staff can write canned_responses" ON public.canned_responses;
CREATE POLICY "Staff can write canned_responses"
    ON public.canned_responses FOR ALL
    TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());

-- knowledge_base
DROP POLICY IF EXISTS "Staff can write knowledge_base" ON public.knowledge_base;
CREATE POLICY "Staff can write knowledge_base"
    ON public.knowledge_base FOR ALL
    TO authenticated
    USING (public.check_is_staff())
    WITH CHECK (public.check_is_staff());

-- profiles: allow self-insert (signup creates own profile)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth_user_id = auth.uid());
