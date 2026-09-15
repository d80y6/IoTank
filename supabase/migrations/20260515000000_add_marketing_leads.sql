-- supabase/migrations/20260515000000_add_marketing_leads.sql

CREATE TABLE IF NOT EXISTS public.marketing_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    source TEXT DEFAULT 'lead_magnet_newsletter',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (anon access for the landing page)
DROP POLICY IF EXISTS "Anyone can join the newsletter" ON public.marketing_leads;
CREATE POLICY "Anyone can join the newsletter" ON public.marketing_leads 
    FOR INSERT 
    TO anon, authenticated
    WITH CHECK (true);

-- Only admins can view the leads
DROP POLICY IF EXISTS "Admins can view all leads" ON public.marketing_leads;
CREATE POLICY "Admins can view all leads" ON public.marketing_leads 
    FOR SELECT 
    TO authenticated
    USING (public.is_system_admin('admin_helper'));

-- Grant access to anon and authenticated
GRANT INSERT ON public.marketing_leads TO anon, authenticated;
GRANT SELECT ON public.marketing_leads TO authenticated;
