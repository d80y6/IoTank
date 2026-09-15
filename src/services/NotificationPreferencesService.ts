import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

export interface UserNotificationPreferences {
    email_enabled: boolean;
    sms_enabled: boolean;
    email_alerts: boolean;
    sms_alerts: boolean;
    email_updates: boolean;
    sms_updates: boolean;
    email_daily_digest: boolean;
    sms_critical_only: boolean;
}

// Default preferences if none exist
const DEFAULT_PREFERENCES: UserNotificationPreferences = {
    email_enabled: true,
    sms_enabled: true,
    email_alerts: true,
    sms_alerts: true,
    email_updates: true,
    sms_updates: false,
    email_daily_digest: false,
    sms_critical_only: true
};

// Cache to avoid repeated database queries
const preferencesCache = new Map<string, { prefs: UserNotificationPreferences; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class NotificationPreferencesService {
    /**
     * Get user notification preferences from database
     * Includes caching to minimize database hits
     */
    static async getUserPreferences(userId: string): Promise<UserNotificationPreferences> {
        // Check cache first
        const cached = preferencesCache.get(userId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.prefs;
        }

        try {
            const { data, error } = await supabase
                .from('user_preferences')
                .select('preferences')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) {
                logger.warn('[NotificationPreferences] Error fetching preferences:', error);
                return DEFAULT_PREFERENCES;
            }

            if (!data?.preferences) {
                return DEFAULT_PREFERENCES;
            }

            const mergedPrefs = {
                ...DEFAULT_PREFERENCES,
                ...(data.preferences as Partial<UserNotificationPreferences>)
            };

            // Cache the result
            preferencesCache.set(userId, {
                prefs: mergedPrefs,
                timestamp: Date.now()
            });

            return mergedPrefs;
        } catch (err) {
            logger.error('[NotificationPreferences] Unexpected error:', err);
            return DEFAULT_PREFERENCES;
        }
    }

    /**
     * Check if SMS should be sent for this user
     */
    static async shouldSendSms(
        userId: string,
        alertType: 'alerts' | 'updates' = 'alerts',
        options?: { isCritical?: boolean }
    ): Promise<boolean> {
        try {
            const prefs = await this.getUserPreferences(userId);
            
            // Check global SMS enable flag
            if (!prefs.sms_enabled) return false;
            
            // Check specific alert type
            if (alertType === 'alerts' && !prefs.sms_alerts) return false;
            if (alertType === 'updates' && !prefs.sms_updates) return false;
            
            // Respect critical-only SMS preferences
            if (prefs.sms_critical_only && !options?.isCritical) return false;
            
            return true;
        } catch (err) {
            logger.error('[NotificationPreferences] Error checking shouldSendSms:', err);
            return false;
        }
    }

    /**
     * Check if email should be sent for this user
     */
    static async shouldSendEmail(userId: string, alertType: 'alerts' | 'updates' | 'digest' = 'alerts'): Promise<boolean> {
        try {
            const prefs = await this.getUserPreferences(userId);
            
            // Check global email enable flag
            if (!prefs.email_enabled) return false;
            
            // Check specific alert type
            if (alertType === 'alerts' && !prefs.email_alerts) return false;
            if (alertType === 'updates' && !prefs.email_updates) return false;
            if (alertType === 'digest' && !prefs.email_daily_digest) return false;
            
            return true;
        } catch (err) {
            logger.error('[NotificationPreferences] Error checking shouldSendEmail:', err);
            // Email defaults to true for backward compatibility
            return true;
        }
    }

    /**
     * Invalidate cache for a user (call after preferences update)
     */
    static invalidateCache(userId: string): void {
        preferencesCache.delete(userId);
    }

    /**
     * Clear all cached preferences
     */
    static clearCache(): void {
        preferencesCache.clear();
    }
}
