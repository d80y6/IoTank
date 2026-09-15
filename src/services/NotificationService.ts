/**
 * Service to handle browser native notifications
 */
import { sanitizeIds } from '@/utils/formatUtils';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

export class NotificationService {
    private static storageKey = 'iotank_notifications_enabled';

    /**
     * Check if browser supports notifications
     */
    static isSupported(): boolean {
        return 'Notification' in window;
    }

    /**
     * Check if notifications are enabled by user and permission granted
     */
    static isEnabled(): boolean {
        return (
            this.isSupported() &&
            Notification.permission === 'granted' &&
            localStorage.getItem(this.storageKey) !== 'false'
        );
    }

    /**
     * Request permission for notifications
     */
    static async requestPermission(): Promise<boolean> {
        if (!this.isSupported()) return false;

        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                localStorage.setItem(this.storageKey, 'true');
                return true;
            }
            // If denied or dismissed, ensure storage reflects it
            localStorage.setItem(this.storageKey, 'false');
            return false;
        } catch (err) {
            logger.error('[NotificationService] Permission request failed:', err, 'NOTIFICATIONS');
            return false;
        }
    }

    /**
     * Disable notifications
     */
    static disable() {
        localStorage.setItem(this.storageKey, 'false');
    }

    /**
     * Get permission state
     */
    static getPermissionState(): NotificationPermission {
        if (!this.isSupported()) return 'denied';
        return Notification.permission;
    }

    /**
     * Show a browser notification
     */
    static show(title: string, options?: NotificationOptions) {
        if (!this.isEnabled()) {
            return;
        }

        try {
            const sanitizedTitle = sanitizeIds(title);
            const sanitizedOptions: NotificationOptions = {
                ...options,
                body: options?.body ? sanitizeIds(options.body) : undefined,
                icon: '/favicon.ico', 
                badge: '/favicon.ico'
            };

            const notification = new Notification(sanitizedTitle, sanitizedOptions);

            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch (err) {
            logger.error('Failed to show notification:', err, 'NOTIFICATIONS');
        }
    }

    /**
     * Specialized notification for Security Breaches (Theft/Collusion/Leak/Blackout)
     */
    static notifySecurity(type: 'THEFT' | 'LEAK' | 'COLLUSION' | 'DISCONNECT' | 'SYSTEM_CRITICAL', site: string, detail: string) {
        const title = type === 'SYSTEM_CRITICAL' ? `🚨 CRITICAL: ${type}` : `🚨 SECURITY ALERT: ${type}`;
        const body = `Terminal: ${site}\n${detail}\nClick to view forensics.`;
        
        this.show(title, {
            body,
            tag: `security-${type}-${site}`,
            requireInteraction: true,
            silent: false
        });
    }

    /**
     * Subscribe to Web Push and save to database
     */
    static async subscribeToPush(userId: string): Promise<boolean> {
        if (!this.isSupported()) return false;

        try {
            const registration = await navigator.serviceWorker.ready;
            
            // Check for existing subscription
            let subscription = await registration.pushManager.getSubscription();
            
            if (!subscription) {
                // Subscribe if not present
                // NOTE: In production, you need a VAPID public key
                const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
                if (!vapidPublicKey) {
                    logger.warn('[NotificationService] VITE_VAPID_PUBLIC_KEY is not set. Web Push subscriptions are disabled. Add the key to .env to enable push notifications.', null, 'NOTIFICATIONS');
                    return false;
                }

                const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedVapidKey
                });
            }

            // Save token/subscription to Supabase
            if (subscription) {
                const { error } = await supabase
                    .from('user_push_tokens')
                    .upsert({
                        auth_user_id: userId,
                        token: JSON.stringify(subscription),
                        device_type: 'web',
                        last_seen_at: new Date().toISOString()
                    }, { onConflict: 'auth_user_id, token' });

                if (error) throw error;
                return true;
            }
            return false;
        } catch (err) {
            logger.error('[NotificationService] Push subscription failed:', err, 'NOTIFICATIONS');
            return false;
        }
    }

    /**
     * Check if we should nudge the user to enable notifications
     */
    static shouldShowNudge(): boolean {
        if (!this.isSupported()) return false;
        if (Notification.permission === 'granted') return false;
        
        // Don't nudge if dismissed this session
        return sessionStorage.getItem('iotank_notification_nudge_dismissed') !== 'true';
    }

    /**
     * Dismiss the nudge for this session
     */
    static dismissNudge() {
        sessionStorage.setItem('iotank_notification_nudge_dismissed', 'true');
    }
}

/**
 * Utility for VAPID key conversion
 */
function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
