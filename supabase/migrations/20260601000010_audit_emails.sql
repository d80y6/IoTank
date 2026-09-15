-- supabase/migrations/20260601000010_audit_emails.sql
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT email, role, station_id FROM public.profiles LIMIT 5) LOOP
        RAISE NOTICE 'Profile: email=%, role=%, station_id=%', r.email, r.role, r.station_id;
    END LOOP;

    FOR r IN (SELECT email, role FROM public.system_users LIMIT 5) LOOP
        RAISE NOTICE 'System User: email=%, role=%', r.email, r.role;
    END LOOP;
END $$;
