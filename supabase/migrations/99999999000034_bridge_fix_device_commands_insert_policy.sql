-- Bridge: fix device_commands INSERT policy — the previous WITH CHECK compared
-- profiles.station_id to itself (always true for users with a non-null station),
-- letting any authenticated user dispatch device commands against ANY station.
DROP POLICY IF EXISTS "Users can insert station commands" ON public.device_commands;

CREATE POLICY "Users can insert station commands"
    ON public.device_commands
    FOR INSERT
    TO public
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE profiles.auth_user_id = auth.uid()
              AND profiles.station_id = device_commands.station_id
        )
    );