import React, { useState, useEffect } from 'react';
import { supabase } from '@/config/supabase';
import { FiCpu, FiX } from 'react-icons/fi';
import { useTanks, updateTank } from '@/hooks/useSupabase';
import { logger } from '@/utils/logger';

export const AutoUpdatePriceModal: React.FC<{ stationId: string }> = ({ stationId }) => {
    const [pendingAction, setPendingAction] = useState<any>(null);
    const { tanks } = useTanks(stationId);
    // Keep a ref so the polling closure always sees the latest tanks without re-running the effect
    const tanksRef = React.useRef(tanks);
    tanksRef.current = tanks;

    useEffect(() => {
        if (!stationId) return;

        // Circuit breaker: backs off to 60s after 3 consecutive failures
        let consecutiveFailures = 0;
        const BASE_INTERVAL = 30000;    // 30s — price queue changes infrequently
        const BACKOFF_INTERVAL = 60000; // 60s on repeated failures
        const FAILURE_THRESHOLD = 3;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const checkPendingUpdates = async () => {
            try {
                const { data, error } = await supabase
                    .from('market_action_queue')
                    .select('*')
                    .eq('station_id', stationId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: false });

                if (error) throw error;
                consecutiveFailures = 0; // reset on success

                if (data && data.length > 0) {
                    const action = data[0];
                    const ageMs = Date.now() - new Date(action.created_at).getTime();
                    const isNew = ageMs < 5 * 60 * 1000;
                    const shownInitialKey = `shown_initial_price_${action.id}`;
                    const hasShownInitial = sessionStorage.getItem(shownInitialKey);
                    const isOldRemind = ageMs >= 60 * 60 * 1000;
                    const remindedKey = `reminded_price_${action.id}`;
                    const hasReminded = sessionStorage.getItem(remindedKey);

                    const targetTanks = tanksRef.current.filter((t: any) => {
                        const tType = t.fuelType?.toUpperCase();
                        const aType = action.fuel_type?.toUpperCase();
                        const isMatch = tType === aType ||
                            (tType === 'PETROL' && aType === 'PMS') ||
                            (tType === 'DIESEL' && aType === 'AGO') ||
                            (tType === 'KEROSENE' && aType === 'IK');
                        if (isMatch) {
                            const currentPrice = Number(t.metadata?.retailPrice) || 0;
                            return currentPrice !== action.new_price;
                        }
                        return false;
                    });

                    if (targetTanks.length === 0) {
                        await supabase.from('market_action_queue').update({ status: 'resolved' }).eq('id', action.id);
                    } else if ((isNew && !hasShownInitial) || (isOldRemind && !hasReminded)) {
                        if (isNew) sessionStorage.setItem(shownInitialKey, 'true');
                        if (isOldRemind) {
                            sessionStorage.setItem(remindedKey, 'true');
                            window.dispatchEvent(new CustomEvent('system-toast', {
                                detail: {
                                    title: 'Regulated Price Sync Stale',
                                    message: `It has been over 1 hour since EPRA updated ${action.fuel_type} rates to KES ${action.new_price.toFixed(2)}. Your station's retail price is still out of sync!`,
                                    type: 'warning',
                                    persistent: true
                                }
                            }));
                        }
                        setPendingAction(action);
                    }
                }
            } catch {
                consecutiveFailures++;
            }

            // Adaptive reschedule with backoff
            const delay = consecutiveFailures >= FAILURE_THRESHOLD ? BACKOFF_INTERVAL : BASE_INTERVAL;
            timeoutId = setTimeout(checkPendingUpdates, delay);
        };

        // Stagger initial check to avoid mount-time DB stampede
        timeoutId = setTimeout(checkPendingUpdates, 2000);

        return () => { if (timeoutId) clearTimeout(timeoutId); };
    }, [stationId]);

    if (!pendingAction) return null;

    const handleConfirm = async () => {
        try {
            const targetTanks = tanks.filter((t: any) => {
                const tType = t.fuelType?.toUpperCase();
                const aType = pendingAction.fuel_type?.toUpperCase();
                return tType === aType || 
                       (tType === 'PETROL' && aType === 'PMS') || 
                       (tType === 'DIESEL' && aType === 'AGO') || 
                       (tType === 'KEROSENE' && aType === 'IK');
            });

            if (targetTanks.length > 0) {
                for (const t of targetTanks) {
                    const currentMetadata = t.metadata || {};
                    await updateTank(t.id, {
                        metadata: {
                            ...currentMetadata,
                            retailPrice: pendingAction.new_price
                        }
                    });
                }
                
                window.dispatchEvent(new CustomEvent('system-toast', {
                    detail: {
                        title: 'Retail Prices Updated',
                        message: `Successfully adjusted retail prices for all ${pendingAction.fuel_type} tanks to KES ${pendingAction.new_price.toFixed(2)}/L.`,
                        type: 'success'
                    }
                }));

                const { AuditService } = await import('@/services/AuditService');
                await AuditService.log(
                    'FINANCE',
                    'PRICE_UPDATE',
                    stationId,
                    `Forensic Price Adjustment: Auto-updated retail prices for ${pendingAction.fuel_type} to KES ${pendingAction.new_price.toFixed(2)}`,
                    'INFO',
                    { fuelType: pendingAction.fuel_type, price: pendingAction.new_price, tanksCount: targetTanks.length }
                );
            }

            // Mark action as resolved
            await supabase.from('market_action_queue').update({ status: 'resolved' }).eq('id', pendingAction.id);
            
            // Dispatch event to refresh market intelligence state if MarketPage is open
            window.dispatchEvent(new CustomEvent('market-action-resolved', { detail: pendingAction.id }));

        } catch (err) {
            logger.error('[AutoUpdatePriceModal] Retail update failed:', err);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Update Failed',
                    message: 'Could not apply automatic retail price updates to tanks.',
                    type: 'error'
                }
            }));
        } finally {
            setPendingAction(null);
        }
    };

    const handleDismiss = async () => {
        const ageMs = Date.now() - new Date(pendingAction.created_at).getTime();
        const isOldRemind = ageMs >= 60 * 60 * 1000;
        
        setPendingAction(null);
        
        // If they explicitly reject the reminder (1 hour later), mark as ignored so it never bothers them again.
        if (isOldRemind) {
            await supabase.from('market_action_queue').update({ status: 'ignored' }).eq('id', pendingAction.id);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="ds-card w-full max-w-lg p-6 bg-white/95 border border-white/20 shadow-2xl rounded-2xl animate-in zoom-in-95 duration-300 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#00D4FF] via-[#06b6d4] to-blue-600" />
                
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-2">
                        <FiCpu className="text-[#00D4FF] animate-pulse" size={20} />
                        <h3 className="text-base font-black text-[#323264] uppercase tracking-wider">
                            Auto-Update Retail Price?
                        </h3>
                    </div>
                    <button 
                        onClick={() => setPendingAction(null)} // Soft dismiss, doesn't ignore in DB
                        className="text-[#7A7A95] hover:text-[#323264] transition-colors p-1 rounded-full hover:bg-gray-100"
                    >
                        <FiX size={18} />
                    </button>
                </div>

                <div className="space-y-4 mb-6">
                    <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50/50 to-[#00D4FF]/5 border border-blue-100/50">
                        <p className="text-xs text-[#4A4A65] leading-relaxed">
                            EPRA has revised <span className="font-bold text-[#323264]">{pendingAction.fuel_type}</span> regulated rates to <span className="font-bold text-[#323264]">KES {pendingAction.new_price.toFixed(2)}/L</span>.
                        </p>
                        <p className="text-[11px] text-[#7A7A95] mt-2">
                            Do you want to automatically adjust the retail price for all <span className="font-semibold">{pendingAction.fuel_type}</span> tanks at your station to match this rate?
                        </p>
                    </div>

                    <div className="text-[11px] text-[#7A7A95] border-t border-gray-100 pt-3">
                        <span className="font-bold text-[#323264] block mb-1">Affected Tanks:</span>
                        {tanks.filter((t: any) => {
                            const tType = t.fuelType?.toUpperCase();
                            const aType = pendingAction.fuel_type?.toUpperCase();
                            return tType === aType || 
                                   (tType === 'PETROL' && aType === 'PMS') || 
                                   (tType === 'DIESEL' && aType === 'AGO') || 
                                   (tType === 'KEROSENE' && aType === 'IK');
                        }).length > 0 ? (
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                {tanks.filter((t: any) => {
                                    const tType = t.fuelType?.toUpperCase();
                                    const aType = pendingAction.fuel_type?.toUpperCase();
                                    return tType === aType || 
                                           (tType === 'PETROL' && aType === 'PMS') || 
                                           (tType === 'DIESEL' && aType === 'AGO') || 
                                           (tType === 'KEROSENE' && aType === 'IK');
                                }).map((t: any) => (
                                    <div key={t.id} className="flex justify-between items-center bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                                        <span className="font-bold text-[#323264] truncate max-w-[80px]">{t.name}</span>
                                        <span className="text-gray-400">
                                            {t.metadata?.retailPrice ? `KES ${t.metadata.retailPrice}` : 'Not set'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="italic text-amber-600 block bg-amber-50 px-3 py-1.5 rounded-lg mt-1">
                                No tanks configured for this fuel type.
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                    <button
                        onClick={handleConfirm}
                        className="mi-action-btn-premium py-2.5 px-4 font-black justify-center flex-1 !bg-gradient-to-r !from-[#00D4FF] !to-blue-600 !text-white rounded-lg shadow-md hover:shadow-lg transition-all"
                    >
                        Yes, Update Retail Prices
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 font-bold justify-center flex-1 rounded-lg transition-all"
                    >
                        No, Keep Current Prices
                    </button>
                </div>
            </div>
        </div>
    );
};
