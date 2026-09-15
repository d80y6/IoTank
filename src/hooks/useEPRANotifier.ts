import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

const EPRA_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
const EPRA_SNOOZE_DURATION = 60 * 60 * 1000; // 1 hour snooze

export const useEPRANotifier = () => {
    const { currentUser } = useAuth();

    useEffect(() => {
        if (!currentUser) return;

        const checkEPRAPrice = async () => {
            try {
                // M-02 FIX: parseInt on a corrupted value returns NaN, making Date.now() < NaN
                // always false — flooding the user with EPRA alerts. Use a safe parse with isNaN guard.
                const snoozeUntil = localStorage.getItem('iotank_epra_snooze_until');
                const snoozeTime = snoozeUntil ? parseInt(snoozeUntil, 10) : NaN;
                if (!isNaN(snoozeTime) && Date.now() < snoozeTime) {
                    return; // Still snoozing
                }

                // Query for the latest EPRA market intelligence signal (from market_prices)
                const { data, error } = await supabase
                    .from('market_prices')
                    .select('effective_date, fuel_type, price_per_liter')
                    .eq('source', 'epra')
                    .order('effective_date', { ascending: false })
                    .limit(1)
                    .single();

                if (error && error.code !== 'PGRST116') {
                    logger.error('[useEPRANotifier] Failed to fetch latest EPRA notice:', error);
                    return;
                }

                if (!data) return;

                // Fingerprint this specific EPRA record by combining effective_date + fuel_type.
                // Using timestamp alone fails for future-dated records: Date.now() < futureDate
                // means the alert re-fires every 5 min indefinitely until acknowledged.
                const alertKey = `${data.effective_date}::${data.fuel_type}`;
                const lastAcknowledgedKey = localStorage.getItem('iotank_epra_last_acknowledged_key');

                if (lastAcknowledgedKey === alertKey) {
                    return; // This exact record was already acknowledged
                }

                // If we reach here, we have an unacknowledged EPRA alert and we're not snoozing!
                window.dispatchEvent(new CustomEvent('system-toast', {
                    detail: {
                        title: '⚠️ EPRA MANDATE: RETAIL PRICE UPDATE REQUIRED',
                        message: `The system detected new official EPRA price limits for ${data.fuel_type} (KES ${data.price_per_liter}).\n\nYou must update your local retail pump prices immediately to maintain operational margin tracking.`,
                        type: 'error',
                        persistent: true,
                        actions: [
                            {
                                label: 'Acknowledge & Update',
                                primary: true,
                                onClick: () => {
                                    // Mark this specific record as permanently acknowledged
                                    localStorage.setItem('iotank_epra_last_acknowledged_key', alertKey);
                                    
                                    // Dispatch event to open AutoUpdatePriceModal
                                    window.dispatchEvent(new CustomEvent('system-modal', {
                                        detail: { modalType: 'market_auto_update' }
                                    }));
                                }
                            },
                            {
                                label: 'Remind Me in 1 Hr',
                                onClick: () => {
                                    // Snooze for 1 hour (but do NOT acknowledge — will re-check after snooze)
                                    const nextSnooze = Date.now() + EPRA_SNOOZE_DURATION;
                                    localStorage.setItem('iotank_epra_snooze_until', nextSnooze.toString());
                                }
                            }
                        ]
                    }
                }));

            } catch (err) {
                logger.error('[useEPRANotifier] Exception during price check:', err);
            }
        };

        // Initial check
        checkEPRAPrice();

        // Polling interval
        const intervalId = setInterval(checkEPRAPrice, EPRA_CHECK_INTERVAL);

        return () => clearInterval(intervalId);
    }, [currentUser]);
};
