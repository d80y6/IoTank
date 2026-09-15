-- supabase/migrations/20260429000000_storage_uploads_bucket.sql
-- ============================================================================
-- STORAGE: Uploads Bucket Configuration
-- ============================================================================

-- 1. Create the 'uploads' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Storage Object RLS: uploads
-- Allow authenticated users to upload files (e.g., BOL receipts)
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
CREATE POLICY "Authenticated users can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'uploads'
);

-- Allow users to update their own uploads
DROP POLICY IF EXISTS "Authenticated users can update own uploads" ON storage.objects;
CREATE POLICY "Authenticated users can update own uploads"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'uploads' AND owner = auth.uid()
);

-- Allow users to delete their own uploads
DROP POLICY IF EXISTS "Authenticated users can delete own uploads" ON storage.objects;
CREATE POLICY "Authenticated users can delete own uploads"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'uploads' AND owner = auth.uid()
);

-- Public read access (Since BOLs might need to be viewed by admins/supervisors quickly)
-- In a stricter environment, this would be restricted to authenticated users with specific roles
DROP POLICY IF EXISTS "Public read for uploads" ON storage.objects;
CREATE POLICY "Public read for uploads"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'uploads');
