-- 99999999000039_storage_bucket_hardening.sql
--
-- Make the document buckets private and add station-scoped read policies.
--
-- `uploads` (CSV/financial docs, delivery BOL photos) and
-- `forensic-attachments` (variance evidence) were world-readable. Public
-- buckets bypass storage RLS entirely, so any leaked object path was a full
-- document disclosure. Private buckets + signed URLs close that gap.
--
-- `profile-photos` stays public on purpose (avatars/branding are rendered in
-- <img> tags and are intentionally shareable).

-- 1. Flip the buckets private (applies to local + remote once pushed)
UPDATE storage.buckets SET public = false WHERE id IN ('uploads', 'forensic-attachments');

-- 2. Read access for authenticated station members and system users.
--    Path conventions in use:
--      uploads:            uploads/<station_id>/<file>            (FileAnalysisService)
--                          deliveries/invoices/<station_id>/<file> (DeliveryModal)
--      forensic-attachments: variance-evidence/<station_id>/<file> (variance review)
--    so the station id may appear at folder index 1 or 2.
DROP POLICY IF EXISTS "Station members can read uploads" ON storage.objects;
CREATE POLICY "Station members can read uploads"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'uploads' AND (
    owner = auth.uid()
    OR check_is_staff()
    OR (storage.foldername(name))[1] = get_station_id_from_auth()::text
    OR (storage.foldername(name))[2] = get_station_id_from_auth()::text
  )
);

DROP POLICY IF EXISTS "Station members can read forensic attachments" ON storage.objects;
CREATE POLICY "Station members can read forensic attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'forensic-attachments' AND (
    owner = auth.uid()
    OR check_is_staff()
    OR (storage.foldername(name))[1] = get_station_id_from_auth()::text
    OR (storage.foldername(name))[2] = get_station_id_from_auth()::text
  )
);

-- 3. Allow station members to upload to forensic-attachments (previously there
--    were no policies at all, which only worked because the bucket was public).
DROP POLICY IF EXISTS "Station members can upload forensic attachments" ON storage.objects;
CREATE POLICY "Station members can upload forensic attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'forensic-attachments'
  AND (
    (storage.foldername(name))[2] = get_station_id_from_auth()::text
    OR check_is_staff()
  )
);

NOTIFY pgrst, 'reload schema';
