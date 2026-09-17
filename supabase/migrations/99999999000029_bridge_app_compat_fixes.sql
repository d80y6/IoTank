-- Bridge: corrections to the 99999999000028 compat layer.

-- 1. increment_article_views uses knowledge_base.views (not view_count)
CREATE OR REPLACE FUNCTION public.increment_article_views(p_article_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.knowledge_base
       SET views = COALESCE(views, 0) + 1
     WHERE id = p_article_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_article_views(uuid) TO authenticated;

-- 2. latest_sensor_readings: expose "timestamp" for app compat
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
