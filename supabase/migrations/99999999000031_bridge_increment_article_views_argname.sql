-- Bridge: app calls increment_article_views with named arg "article_id"
-- (no p_ prefix), so PostgREST can't find the p_article_id version.
-- Recreate with matching argument name.

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
