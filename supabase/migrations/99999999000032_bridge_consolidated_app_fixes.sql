-- Bridge: consolidates fixes applied ad-hoc via psql during dev session.

-- 1. profiles.id alias (some app queries select=id)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS id UUID GENERATED ALWAYS AS (auth_user_id) STORED;

-- 2. latest_sensor_readings: expose both "timestamp" and captured_at
DROP VIEW IF EXISTS public.latest_sensor_readings;
CREATE VIEW public.latest_sensor_readings AS
SELECT DISTINCT ON (tank_id)
    id, station_id, tank_id, volume, temperature,
    "timestamp",
    "timestamp" AS captured_at,
    '{}'::jsonb AS metadata,
    rssi
FROM public.sensor_readings_legacy
ORDER BY tank_id, "timestamp" DESC;
GRANT SELECT ON public.latest_sensor_readings TO authenticated;

-- 3. audit_logs.system_user_id (admin_logs view writes)
ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS system_user_id UUID REFERENCES public.system_users(id) ON DELETE SET NULL;

-- 4. increment_article_views with the arg name the app sends
DROP FUNCTION IF EXISTS public.increment_article_views(uuid);
CREATE OR REPLACE FUNCTION public.increment_article_views(article_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.knowledge_base
       SET views = COALESCE(views, 0) + 1
     WHERE id = article_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_article_views(uuid) TO authenticated;
