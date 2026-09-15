-- Bridge: the app writes a metadata JSONB column on tanks
-- (see useSupabase.ts and the Initialize Node flow) but no migration adds it.
ALTER TABLE public.tanks
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
