-- Bridge: JurisdictionRegistryPage + jurisdictionsService reference
-- jurisdictions.is_global (list ordering, badges, delete guard, insert/update).
-- The base table at 99999999000023_global_rls_jurisdiction.sql omits it.

ALTER TABLE public.jurisdictions
    ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed at least one global row so the UI has something to show; mark common
-- global jurisdictions. Adjust to your data model.
UPDATE public.jurisdictions SET is_global = TRUE WHERE code IN ('GLOBAL', 'INTL');
