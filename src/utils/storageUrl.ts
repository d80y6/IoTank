import { supabase } from '@/config/supabase';

/**
 * Resolve a stored storage reference into a usable URL.
 *
 * Private buckets (uploads, forensic-attachments) return a time-limited signed
 * URL; legacy rows that persisted an absolute public URL (from when the bucket
 * was public) are passed through untouched so old records keep working.
 */
export async function resolveStorageUrl(
    bucket: string,
    pathOrUrl: string | null | undefined,
    expiresIn = 3600
): Promise<string> {
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(pathOrUrl, expiresIn);

    if (error) return '';
    return data?.signedUrl || '';
}
