import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

export interface PhotoUploadResult {
    success: boolean;
    url?: string;
    error?: string;
}

/**
 * Service to handle industrial-grade profile photo processing and storage.
 * Supports both User Profile Photos and Organization Logos.
 * - Auto-crops to 256x256 square.
 * - Enforces 2MB limit.
 * - Strips metadata during canvas processing.
 */
export class ProfilePhotoService {
    static MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
    static TARGET_DIMENSION = 256;

    /**
     * Upload User Profile Photo.
     */
    static async uploadProfilePhoto(authUserId: string, file: File | Blob): Promise<PhotoUploadResult> {
        return this.uploadAsset(`users/${authUserId}/profile_photo_${Date.now()}.webp`, {
            table: 'profiles',
            column: 'photo_url',
            filterColumn: 'auth_user_id',
            filterValue: authUserId,
            oldUrlPattern: `users/${authUserId}/profile_photo_`
        }, file);
    }

    /**
     * Upload Organization Logo.
     */
    static async uploadOrganizationLogo(stationId: string, file: File | Blob): Promise<PhotoUploadResult> {
        return this.uploadAsset(`organizations/${stationId}/logo_${Date.now()}.webp`, {
            table: 'fuel_stations',
            column: 'logo_url',
            filterColumn: 'id',
            filterValue: stationId,
            oldUrlPattern: `organizations/${stationId}/logo_`
        }, file);
    }

    /**
     * Generic Asset Upload Handler.
     */
    private static async uploadAsset(
        storagePath: string, 
        dbTarget: { table: string, column: string, filterColumn: string, filterValue: string, oldUrlPattern?: string },
        file: File | Blob
    ): Promise<PhotoUploadResult> {
        // 1. Initial validation (Only if it's a File object, Blobs are usually pre-validated)
        if (file instanceof File) {
            if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
                return { success: false, error: 'Only JPG, JPEG, PNG, and WEBP files are allowed.' };
            }
            if (file.size > this.MAX_SIZE_BYTES) {
                return { success: false, error: 'File size must be less than 5 MB.' };
            }
        }

        try {
            // 2. Process image if it's a raw File. If it's a Blob, we assume it's already cropped/processed.
            const processedBlob = file instanceof File ? await this.processImage(file) : file;

            // 3. Cleanup Old Assets (Delete existing files matching the pattern to avoid storage bloat)
            if (dbTarget.oldUrlPattern) {
                const folderPath = storagePath.substring(0, storagePath.lastIndexOf('/'));
                const { data: files } = await supabase.storage
                    .from('profile-photos')
                    .list(folderPath);
                
                if (files && files.length > 0) {
                    const prefix = dbTarget.oldUrlPattern.split('/').pop() || '';
                    const toDelete = files
                        .filter(f => f.name.startsWith(prefix))
                        .map(f => `${folderPath}/${f.name}`);
                    
                    if (toDelete.length > 0) {
                        await supabase.storage.from('profile-photos').remove(toDelete);
                    }
                }
            }

            // 4. Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('profile-photos')
                .upload(storagePath, processedBlob, {
                    contentType: 'image/webp',
                    upsert: true
                });

            if (uploadError) throw uploadError;

            // 5. Get Public URL
            const { data: publicUrlData } = supabase.storage
                .from('profile-photos')
                .getPublicUrl(storagePath);
            
            const downloadURL = publicUrlData.publicUrl;

            // 6. Update Database Record
            const { error: dbError } = await supabase
                .from(dbTarget.table)
                .update({ [dbTarget.column]: downloadURL })
                .eq(dbTarget.filterColumn, dbTarget.filterValue);

            if (dbError) throw dbError;

            return { success: true, url: downloadURL };
        } catch (error: any) {
            logger.error(`[ProfilePhotoService] Asset upload failed for ${storagePath}:`, error);
            return { success: false, error: error.message || 'Failed to upload asset.' };
        }
    }

    /**
     * Processes the image using HTML5 Canvas to ensure:
     * - Square aspect ratio (center crop)
     * - 256x256 resolution
     * - EXIF metadata stripping
     * - WebP conversion
     */
    private static async processImage(file: File): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.TARGET_DIMENSION;
                    canvas.height = this.TARGET_DIMENSION;
                    const ctx = canvas.getContext('2d');

                    if (!ctx) {
                        reject(new Error('Canvas context not available'));
                        return;
                    }

                    // Calculate square crop
                    const size = Math.min(img.width, img.height);
                    const sourceX = (img.width - size) / 2;
                    const sourceY = (img.height - size) / 2;

                    // Draw image center-cropped and resized
                    ctx.drawImage(
                        img,
                        sourceX, sourceY, size, size, // Source
                        0, 0, this.TARGET_DIMENSION, this.TARGET_DIMENSION // Destination
                    );

                    // Convert to blob (WebP format for optimal size)
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Canvas toBlob conversion failed'));
                        }
                    }, 'image/webp', 0.8);
                };
                img.onerror = () => reject(new Error('Failed to load image into object'));
            };
            reader.onerror = () => reject(new Error('FileReader error'));
        });
    }
}
