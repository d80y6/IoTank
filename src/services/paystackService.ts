import { supabase } from '../config/supabase';
import { logger } from '../utils/logger';

export interface PaystackTransaction {
    id: string;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    channel: string;
    created_at: string;
    customer_email: string;
    metadata?: any;
}

export interface PaystackCustomer {
    id: string;
    customer_code: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    metadata?: any;
}

export const paystackService = {
    /**
     * Fetches transactions from the database (synced via webhooks)
     */
    async getTransactions(limit = 10): Promise<PaystackTransaction[]> {
        try {
            const { data, error } = await supabase
                .from('transactions') // We use the existing transactions table but map it
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data || [];
        } catch (error) {
            logger.error('[paystackService] Error fetching Paystack transactions:', error);
            return [];
        }
    },

    /**
     * Fetches customers from the database
     */
    async getCustomers(limit = 10): Promise<PaystackCustomer[]> {
        try {
            const { data, error } = await supabase
                .from('billing_customers')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return data || [];
        } catch (error) {
            logger.error('[paystackService] Error fetching Paystack customers:', error);
            return [];
        }
    },

    /**
     * Saves Paystack configuration for the station.
     *
     * @security IMPORTANT: The `live_secret_key` and `test_secret_key` fields are
     * Paystack server-side credentials and MUST NOT be stored from client code in a
     * production system. This function is tolerated here only because it writes via
     * RLS-protected Supabase with authenticated sessions. Migrate to an Edge Function
     * before enabling live payment processing. (C-02)
     */
    async saveConfig(config: {
        test_secret_key: string;
        test_public_key: string;
        live_secret_key: string;
        live_public_key: string;
        is_live_mode: boolean;
    }, stationId: string) {
        try {
            const { error } = await supabase
                .from('paystack_config')
                .upsert({
                    station_id: stationId,
                    ...config,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Fetches Paystack configuration
     */
    async getConfig(stationId: string) {
        try {
            const { data, error } = await supabase
                .from('paystack_config')
                .select('*')
                .eq('station_id', stationId)
                .maybeSingle();

            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('[paystackService] Error fetching Paystack config:', error);
            return null;
        }
    }
};
