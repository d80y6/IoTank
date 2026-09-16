-- 99999999000022_global_rls_jurisdiction.sql
-- Phase 1: RLS hardening + DB-driven jurisdiction registry.
--
-- 1. Close RLS gaps (sensor_readings parent, unified_events 2026_08..11 partitions,
--    loss_reviews dead-station-id policy, anon USAGE on the internal schema).
-- 2. Introduce jurisdictions / jurisdiction_configs / report_templates + RPCs.
-- 3. Relax Kenya-specific CHECK enums and defaults.
-- 4. Backfill compatible columns used by the client/Super Admin (station_id on
--    daily_summaries, ticket_no/sla_deadline on support_tickets, region_code).
--
-- Safe to apply on a DB that already has 99999999000017 and the 00018..00021
-- bridges applied. All statements are idempotent.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. RLS hardening
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. sensor_readings parent: policies already exist ("Users can view own sensor
-- readings", "ESP devices can insert via anon", "Hardware devices can insert
-- readings"); enable RLS so they are actually enforced.
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;

-- 1b. unified_events 2026_08..11 partitions were created without RLS. Enable RLS
-- and mirror the "Station members can view unified events" SELECT policy that the
-- 2026_03..06 partitions carry. INSERT/DELETE/UPDATE are inherited from the
-- parent table's policies.
DO $$
DECLARE
    v_part text;
BEGIN
    FOREACH v_part IN ARRAY ARRAY['unified_events_2026_08','unified_events_2026_09','unified_events_2026_10','unified_events_2026_11']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = v_part AND c.relkind = 'r') THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_part);
            EXECUTE format('DROP POLICY IF EXISTS "Station members can view unified events" ON public.%I', v_part);
            EXECUTE format(
                'CREATE POLICY "Station members can view unified events" ON public.%I
                 FOR SELECT TO authenticated
                 USING (
                     EXISTS (
                         SELECT 1 FROM public.profiles p
                         WHERE p.station_id = %I.station_id
                           AND p.auth_user_id = auth.uid()
                     )
                     OR (SELECT public.get_auth_level()) <= 4
                 )',
                v_part, v_part
            );
        END IF;
    END LOOP;
END $$;

-- 1c. loss_reviews: the old policy compared station_id against a JWT claim
-- ("auth.jwt()->>'station_id'") that does not exist on user sessions, silently
-- blocking all access. Replace with the standard profiles-based station check +
-- staff override. station_id is stored as text, so cast profiles.station_id.
DROP POLICY IF EXISTS "loss_reviews_station_access" ON public.loss_reviews;

CREATE POLICY "loss_reviews_station_access" ON public.loss_reviews
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.station_id::text = loss_reviews.station_id
          AND p.auth_user_id = auth.uid()
    )
    OR (SELECT public.check_is_staff())
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.station_id::text = loss_reviews.station_id
          AND p.auth_user_id = auth.uid()
    )
    OR (SELECT public.check_is_staff())
);

-- 1d. Revoke anon's schema-level USAGE on internal (00018 granted it broadly).
-- authenticated/service_role keep USAGE + EXECUTE so SECURITY INVOKER wrappers
-- continue to work.
REVOKE USAGE ON SCHEMA internal FROM anon;
REVOKE USAGE ON SCHEMA internal FROM PUBLIC;

-- 1e. Canonical partition-security helper used by the partition auto-create
-- routine below, so every future partition inherits RLS + the same policies
-- automatically instead of being created wide-open.
CREATE OR REPLACE FUNCTION internal.apply_partition_security(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, internal, auth
AS $$
DECLARE
    v_tablename text;
    v_polname text;
BEGIN
    v_tablename := to_regclass(p_table)::text;

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_tablename);

    v_polname := 'Station members can view unified events';
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = split_part(v_tablename, '.', 1)
          AND tablename   = split_part(v_tablename, '.', 2)
          AND policyname  = v_polname
    ) THEN
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR SELECT TO authenticated
             USING (
                 EXISTS (SELECT 1 FROM public.profiles p
                         WHERE p.station_id = %s.station_id
                           AND p.auth_user_id = auth.uid())
                 OR (SELECT public.get_auth_level()) <= 4
             )',
            v_polname, v_tablename, split_part(v_tablename, '.', 2)
        );
    END IF;

    v_polname := 'Allow authenticated inserts to unified_events';
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = split_part(v_tablename, '.', 1)
          AND tablename   = split_part(v_tablename, '.', 2)
          AND policyname  = v_polname
    ) THEN
        EXECUTE format(
            'CREATE POLICY %I ON %s FOR INSERT TO authenticated
             WITH CHECK (actor_id = auth.uid())',
            v_polname, v_tablename
        );
    END IF;
END;
$$;

-- 1f. Wire the partition auto-create routine to apply security on new partitions.
CREATE OR REPLACE FUNCTION internal.create_event_partition(p_year_month text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, internal
AS $$
DECLARE
    v_table_name text;
    v_start_date text;
    v_end_date text;
BEGIN
    v_table_name := 'unified_events_' || p_year_month;
    v_start_date := replace(p_year_month, '_', '-') || '-01';
    v_end_date := (v_start_date)::date + INTERVAL '1 month';

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.unified_events
         FOR VALUES FROM (%L) TO (%L)',
        v_table_name, v_start_date, v_end_date
    );

    PERFORM internal.apply_partition_security(format('public.%I', v_table_name)::regclass);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Jurisdiction registry
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.jurisdictions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code             text NOT NULL UNIQUE,
    name             text NOT NULL,
    country_code     text,
    currency         text NOT NULL DEFAULT 'USD',
    currency_symbol  text DEFAULT '$',
    locale           text NOT NULL DEFAULT 'en',
    timezone         text NOT NULL DEFAULT 'UTC',
    phone_prefix     text DEFAULT '+1',
    regulatory_body  text,
    is_active        boolean NOT NULL DEFAULT true,
    config           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jurisdiction_configs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction_code text NOT NULL REFERENCES public.jurisdictions(code) ON DELETE CASCADE,
    config_key        text NOT NULL,
    config_value      jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active         boolean NOT NULL DEFAULT true,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (jurisdiction_code, config_key)
);

CREATE TABLE IF NOT EXISTS public.report_templates (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction_code text NOT NULL REFERENCES public.jurisdictions(code) ON DELETE CASCADE,
    template_code     text NOT NULL,
    name              text NOT NULL,
    description       text,
    category          text NOT NULL DEFAULT 'regulatory',
    schema_version    integer NOT NULL DEFAULT 1,
    template_body     jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active         boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (jurisdiction_code, template_code)
);

-- RLS: platform-level configuration is readable by any authenticated user;
-- writes are only possible through admin RPCs (SECURITY DEFINER, level <= 2).
ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisdiction_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read jurisdictions" ON public.jurisdictions;
CREATE POLICY "Authenticated can read jurisdictions" ON public.jurisdictions
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can read jurisdiction_configs" ON public.jurisdiction_configs;
CREATE POLICY "Authenticated can read jurisdiction_configs" ON public.jurisdiction_configs
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can read report_templates" ON public.report_templates;
CREATE POLICY "Authenticated can read report_templates" ON public.report_templates
FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.jurisdictions TO authenticated;
GRANT SELECT ON public.jurisdiction_configs TO authenticated;
GRANT SELECT ON public.report_templates TO authenticated;
GRANT SELECT ON public.jurisdictions TO service_role;
GRANT SELECT ON public.jurisdiction_configs TO service_role;
GRANT SELECT ON public.report_templates TO service_role;

-- ─── RPCs ─────────────────────────────────────────────────────────────────────

-- Resolve one jurisdiction by code. SECURITY INVOKER: row visibility governed by
-- the table's RLS (authenticated SELECT); safe to expose through PostgREST.
CREATE OR REPLACE FUNCTION public.get_jurisdiction(p_code text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT json_build_object(
        'id',            j.id,
        'code',          j.code,
        'name',          j.name,
        'country_code',  j.country_code,
        'currency',      j.currency,
        'currency_symbol', j.currency_symbol,
        'locale',        j.locale,
        'timezone',      j.timezone,
        'phone_prefix',  j.phone_prefix,
        'regulatory_body', j.regulatory_body,
        'is_active',     j.is_active,
        'config',        j.config
    )
    FROM public.jurisdictions j
    WHERE j.code = p_code
    LIMIT 1;
$$;

-- Merged configuration for a jurisdiction: row-level `config` plus any active
-- jurisdiction_configs rows (config_key -> config_value). Returns a single JSONB.
CREATE OR REPLACE FUNCTION public.get_jurisdiction_config(p_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    WITH j AS (
        SELECT * FROM public.jurisdictions
        WHERE code = COALESCE(p_code, 'GLOBAL')
        LIMIT 1
    ),
    cfg AS (
        SELECT jsonb_object_agg(config_key, config_value) AS merged
        FROM public.jurisdiction_configs
        WHERE jurisdiction_code = (SELECT code FROM j) AND is_active
    )
    SELECT jsonb_build_object(
        'jurisdiction', to_jsonb(j.*) - 'id' - 'created_at' - 'updated_at',
        'config', COALESCE((SELECT merged FROM cfg), '{}'::jsonb)
    )
    FROM j;
$$;

-- Admin CRUD for jurisdictions/configs/templates. SECURITY DEFINER, gated to
-- system admins levels 1-2 (super_admin / admin_helper) via the existing
-- internal helper; explicit search_path to avoid RLS recursion traps.
CREATE OR REPLACE FUNCTION internal.upsert_jurisdiction(
    p_code text,
    p_name text,
    p_config jsonb DEFAULT '{}'::jsonb,
    p_country_code text DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_currency_symbol text DEFAULT NULL,
    p_locale text DEFAULT NULL,
    p_timezone text DEFAULT NULL,
    p_phone_prefix text DEFAULT NULL,
    p_regulatory_body text DEFAULT NULL,
    p_is_active boolean DEFAULT true
)
RETURNS public.jurisdictions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, internal
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row public.jurisdictions;
BEGIN
    IF NOT internal.check_is_admin_internal(v_uid, 'admin_helper') THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    INSERT INTO public.jurisdictions (
        code, name, config, country_code, currency, currency_symbol,
        locale, timezone, phone_prefix, regulatory_body, is_active
    ) VALUES (
        p_code, p_name, p_config, p_country_code, COALESCE(p_currency, 'USD'),
        COALESCE(p_currency_symbol, '$'), COALESCE(p_locale, 'en'),
        COALESCE(p_timezone, 'UTC'), COALESCE(p_phone_prefix, '+1'),
        p_regulatory_body, p_is_active
    )
    ON CONFLICT (code) DO UPDATE SET
        name            = EXCLUDED.name,
        config          = EXCLUDED.config,
        country_code    = EXCLUDED.country_code,
        currency        = EXCLUDED.currency,
        currency_symbol = EXCLUDED.currency_symbol,
        locale          = EXCLUDED.locale,
        timezone        = EXCLUDED.timezone,
        phone_prefix    = EXCLUDED.phone_prefix,
        regulatory_body = EXCLUDED.regulatory_body,
        is_active       = EXCLUDED.is_active,
        updated_at      = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION internal.set_jurisdiction_config(
    p_jurisdiction_code text,
    p_config_key text,
    p_config_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, internal
AS $$
BEGIN
    IF NOT internal.check_is_admin_internal(auth.uid(), 'admin_helper') THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    INSERT INTO public.jurisdiction_configs (jurisdiction_code, config_key, config_value, is_active)
    VALUES (p_jurisdiction_code, p_config_key, p_config_value, true)
    ON CONFLICT (jurisdiction_code, config_key) DO UPDATE SET
        config_value = EXCLUDED.config_value,
        is_active    = true,
        updated_at   = now();
END;
$$;

CREATE OR REPLACE FUNCTION internal.upsert_report_template(
    p_jurisdiction_code text,
    p_template_code text,
    p_name text,
    p_template_body jsonb,
    p_description text DEFAULT NULL,
    p_category text DEFAULT 'regulatory',
    p_schema_version integer DEFAULT 1,
    p_is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, internal
AS $$
BEGIN
    IF NOT internal.check_is_admin_internal(auth.uid(), 'admin_helper') THEN
        RAISE EXCEPTION 'Not allowed';
    END IF;

    INSERT INTO public.report_templates (
        jurisdiction_code, template_code, name, template_body,
        description, category, schema_version, is_active
    ) VALUES (
        p_jurisdiction_code, p_template_code, p_name, p_template_body,
        p_description, p_category, p_schema_version, p_is_active
    )
    ON CONFLICT (jurisdiction_code, template_code) DO UPDATE SET
        name           = EXCLUDED.name,
        template_body  = EXCLUDED.template_body,
        description    = EXCLUDED.description,
        category       = EXCLUDED.category,
        schema_version = EXCLUDED.schema_version,
        is_active      = EXCLUDED.is_active,
        updated_at     = now();
END;
$$;

-- Grant USAGE + EXECUTE for the public functions via PostgREST (rpc/).
GRANT EXECUTE ON FUNCTION public.get_jurisdiction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_jurisdiction(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_jurisdiction_config(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_jurisdiction_config(text) TO service_role;

-- ─── Seeds ────────────────────────────────────────────────────────────────────

INSERT INTO public.jurisdictions (
    code, name, country_code, currency, currency_symbol, locale, timezone,
    phone_prefix, regulatory_body, is_active, config
) VALUES (
    'GLOBAL', 'Global (Default)', NULL, 'USD', '$', 'en', 'UTC', '+1',
    NULL, true,
    '{"pricing":null,"regulatory":{"body":"Global","adapter":"generic","priceCycle":null},"market":{"newsLocales":"us","sources":["eia","newsapi"]}}'::jsonb
) ON CONFLICT (code) DO NOTHING;

INSERT INTO public.jurisdictions (
    code, name, country_code, currency, currency_symbol, locale, timezone,
    phone_prefix, regulatory_body, is_active, config
) VALUES (
    'KE', 'Kenya', 'KE', 'KES', 'KSh', 'en-KE', 'Africa/Nairobi', '+254',
    'EPRA', true,
    '{"pricing":{"superPetrol":190.84,"diesel":170.19,"kerosene":169.53,"priceCycle":"monthly","vatRate":0.16},"regulatory":{"body":"EPRA","adapter":"epra","priceCycle":"monthly"},"market":{"newsLocales":"ke","sources":["eia","newsapi","blogs"]}}'::jsonb
) ON CONFLICT (code) DO NOTHING;

INSERT INTO public.report_templates (
    jurisdiction_code, template_code, name, description, category, schema_version, template_body
) VALUES (
    'KE', 'epra_compliance_pack', 'EPRA Compliance Pack',
    'Regulatory compliance pack for the Kenyan energy regulator (EPRA).',
    'regulatory', 1,
    '{"sections":["station_profile","volumes_by_product","loss_analysis","attachments"],"format":"pdf","frequency":"monthly"}'::jsonb
) ON CONFLICT (jurisdiction_code, template_code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Relax Kenya-specific enums + defaults
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.market_prices DROP CONSTRAINT IF EXISTS market_prices_source_check;
ALTER TABLE public.market_prices ADD CONSTRAINT market_prices_source_check
    CHECK (source = ANY (ARRAY['epra','bloomberg','manual','api','jurisdiction','eia','other']));

ALTER TABLE public.market_prices ALTER COLUMN currency DROP DEFAULT;
ALTER TABLE public.market_prices ALTER COLUMN region DROP DEFAULT;
ALTER TABLE public.market_prices ADD COLUMN IF NOT EXISTS jurisdiction_code text;

ALTER TABLE public.billing_transactions DROP CONSTRAINT IF EXISTS billing_transactions_provider_check;
ALTER TABLE public.billing_transactions ADD CONSTRAINT billing_transactions_provider_check
    CHECK (provider = ANY (ARRAY['MPESA','PAYSTACK','CASH','BANK_TRANSFER','AIRTEL_MONEY','CARD','MOBILE_MONEY','ONLINE','OTHERS']));

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_payment_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method = ANY (ARRAY['MPESA','PAYSTACK','CASH','BANK_TRANSFER','AIRTEL_MONEY','CARD','MOBILE_MONEY','ONLINE','OTHERS']));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Compatibility columns used by client / Super Admin surfaces
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.daily_summaries ADD COLUMN IF NOT EXISTS station_id uuid;
CREATE INDEX IF NOT EXISTS idx_daily_summaries_station_id_date
    ON public.daily_summaries (station_id, date);

DO $$
BEGIN
    ALTER TABLE public.daily_summaries
        ADD CONSTRAINT daily_summaries_station_fk
        FOREIGN KEY (station_id) REFERENCES public.fuel_stations (station_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ticket_no text;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS sla_deadline timestamptz;
CREATE INDEX IF NOT EXISTS idx_support_tickets_station_status
    ON public.support_tickets (station_id, status);

ALTER TABLE public.fuel_stations ADD COLUMN IF NOT EXISTS region_code text;

COMMIT;