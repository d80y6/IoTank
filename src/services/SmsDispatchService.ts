import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

export interface SmsPayload {
    to: string;
    message: string;
}

export class SmsDispatchService {
    private static async getSafeAuthHeaders(): Promise<Record<string, string>> {
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const headers: Record<string, string> = { 
            'Content-Type': 'application/json',
            'apikey': anonKey || ''
        };

        try {
            // Always fetch fresh session — no caching to prevent cross-tenant identity spoofing
            const { data: { session } } = await supabase.auth.getSession();
            const isValidToken = session && (session.expires_at ? session.expires_at > (Date.now() / 1000) + 10 : true);
            
            if (isValidToken && session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }
        } catch (e) {
            logger.warn('[SmsDispatchService] Auth check failed, proceeding anonymously.');
        }

        return headers;
    }

    /**
     * Dispatch a tactical SMS alert via Twilio through the IoTank Edge Function.
     */
    static async sendSms(payload: SmsPayload) {
        try {
            const headers = await this.getSafeAuthHeaders();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const response = await fetch(`${supabaseUrl}/functions/v1/dispatch-critical-alerts`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    cmd: 'direct_sms_alert',
                    to: payload.to,
                    message: payload.message
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (err) {
            logger.error('[SmsDispatchService] Failed to dispatch SMS:', err);
            return null;
        }
    }
}
