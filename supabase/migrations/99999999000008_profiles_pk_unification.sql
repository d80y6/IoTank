-- supabase/migrations/20260514130000_profiles_pk_unification.sql
-- ============================================================================
-- FIX: user_preferences FK Mismatch and Profiles PK Unification
-- Resolves: 'insert or update on table "user_preferences" violates foreign key constraint'
-- ============================================================================

DO $$ 
BEGIN
    -- Only proceed if both 'id' and 'auth_user_id' exist (indicating a legacy state)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'id') 
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'auth_user_id') THEN
        
        RAISE NOTICE 'Unifying Profiles identity and fixing user_preferences FK...';

        -- 1. Drop the FK from user_preferences to profiles(id)
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'user_preferences_user_id_fkey') THEN
            ALTER TABLE public.user_preferences DROP CONSTRAINT user_preferences_user_id_fkey;
        END IF;

        -- 2. Data Migration: Update user_preferences to use actual Supabase UIDs
        -- We map the existing random user_id (which matches profiles.id) to the actual auth_user_id
        UPDATE public.user_preferences up
        SET user_id = p.auth_user_id
        FROM public.profiles p
        WHERE up.user_id = p.id
          AND p.auth_user_id IS NOT NULL;

        -- 3. Profiles: Swap PK from 'id' (random) to 'auth_user_id' (Supabase UID)
        -- CASCADE handles any other internal constraints pointing to the PK
        ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey CASCADE;
        ALTER TABLE public.profiles ADD PRIMARY KEY (auth_user_id);

        -- 4. Clean up: Drop the redundant random 'id' column
        ALTER TABLE public.profiles DROP COLUMN id;

        -- 5. Restore FK: user_preferences now correctly points to the identity column
        ALTER TABLE public.user_preferences 
            ADD CONSTRAINT user_preferences_user_id_fkey 
            FOREIGN KEY (user_id) REFERENCES public.profiles(auth_user_id) ON DELETE CASCADE;

        RAISE NOTICE 'Profiles identity unification complete.';
    ELSE
        RAISE NOTICE 'Profiles already unified or in unexpected state. Skipping PK swap.';
    END IF;
END $$;

-- 6. Ensure RLS for user_preferences is permissive for the owner
-- ============================================================================
DROP POLICY IF EXISTS "Users manage own preferences" ON public.user_preferences;
CREATE POLICY "Users manage own preferences" ON public.user_preferences
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- RELOAD PostgREST
NOTIFY pgrst, 'reload schema';
