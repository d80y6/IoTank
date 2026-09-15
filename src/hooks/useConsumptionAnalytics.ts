import { useMemo, useEffect, useState } from 'react';
import { Tank, TankReading } from '@/types';
import { differenceInHours } from 'date-fns';
import { useTelemetryQueue } from '@/contexts/TelemetryQueueContext';
import { useShiftStatus } from './useShiftStatus';
import { supabase } from '@/config/supabase';
import { calculateETE, calculateRate, TELEMETRY_CONSTANTS } from '@/utils/telemetryMath';
import { validateUUID } from '@/utils/sanitization';
import { logger } from '@/utils/logger';

/** Safe localStorage JSON parser — prevents crashes from corrupted or tampered storage. */
function safeParseLocalStorage<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        logger.warn(`[useConsumptionAnalytics] localStorage parse failed for key: "${key}". Returning fallback.`);
        return fallback;
    }
}


export function useConsumptionAnalytics(tank: Tank | null, readings: TankReading[]) {
    const { pushEvent } = useTelemetryQueue();
    const { openedAt, status: shiftStatus } = useShiftStatus();
    const [avgDailyRate, setAvgDailyRate] = useState<number>(0);

    // Fetch Last 7 Days Average Dispense Rate
    useEffect(() => {
        const fetchHistoricalAverage = async () => {
                // Guard: only query Postgres when tank.id is a valid UUID. Skip placeholders like "ghost-tank".
                if (!tank || !tank.id || !validateUUID(tank.id)) return;
            
            try {
                // Get last 7 shift closures for this tank
                const { data, error } = await supabase
                    .from('shift_closures')
                    .select('volume_sold_liters, opened_at, closed_at')
                    .eq('tank_id', tank.id)
                    .order('closed_at', { ascending: false })
                    .limit(7);

                if (error) throw error;

                if (data && data.length > 0) {
                    // Calculate individual daily rates (L/hr) and average them
                    const rates = data.map(shift => {
                        const duration = Math.max(0.5, differenceInHours(new Date(shift.closed_at), new Date(shift.opened_at)));
                        return (Number(shift.volume_sold_liters) || 0) / duration;
                    });
                    const avg = rates.reduce((acc, r) => acc + r, 0) / rates.length;
                    setAvgDailyRate(avg);
                } else {
                    // Fallback to a default if no history exists (e.g. 10 L/hr)
                    setAvgDailyRate(5); 
                }
            } catch (err) {
                logger.warn('[useConsumptionAnalytics] Failed to fetch historical average:', err);
            }
        };

        fetchHistoricalAverage();
    }, [tank?.id]);

    // [BUG 4 FIX]: Cleanup stale shift start volume from localStorage when shift closes.
    // Without this, the object grows unbounded and subsequent shifts inherit the wrong start volume.
    useEffect(() => {
        if (shiftStatus === 'closed' && tank?.id) {
            try {
                const volumes = safeParseLocalStorage<Record<string, number>>('iotank_shift_start_volumes', {});
                if (volumes[tank.id] !== undefined) {
                    delete volumes[tank.id];
                    localStorage.setItem('iotank_shift_start_volumes', JSON.stringify(volumes));
                }
            } catch { /* non-critical, ignore parse errors */ }
        }
    }, [shiftStatus, tank?.id]);

    const analytics = useMemo(() => {
        try {
            if (!tank || !tank.capacity) {
                return {
                    defillRate: 0,
                    ete: 'Calculating...',
                    timeToOrderHrs: null,
                    predictedRefillDate: null,
                    predictedOrderDate: null,
                    isTheftSuspected: false,
                    isLeakageSuspected: false,
                    trend: 'stable' as 'stable' | 'decreasing' | 'increasing',
                    error: null
                };
            }

            const sorted = [...readings].sort((a, b) => b.timestamp - a.timestamp);
            const latest = sorted[0];
            const latestVolume = latest ? (latest.volumeCorrected ?? latest.volume ?? 0) : (tank.currentVolume ?? 0);
            const latestTimestamp = latest ? latest.timestamp : Date.now();

            // 1. Current Shift Dispense Rate (Rate of Change) using unified math
            let currentShiftRate = 0;
            if (shiftStatus === 'open' && openedAt) {
                const shiftStartVolumes = safeParseLocalStorage<Record<string, number>>('iotank_shift_start_volumes', {});
                const startVol = shiftStartVolumes[tank.id] || latestVolume;
                const hrsPassed = Math.max(0.1, (Date.now() - openedAt) / (1000 * 60 * 60));
                currentShiftRate = calculateRate(startVol, latestVolume, hrsPassed);
            } else {
                // If shift is closed, use a short-term 2-hour window for the "Display Rate"
                const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
                const relevant = sorted.filter(r => r.timestamp >= twoHoursAgo);
                if (relevant.length >= 2) {
                    const oldestInWindow = relevant[relevant.length - 1];
                    const hrs = Math.max(0.1, (latestTimestamp - oldestInWindow.timestamp) / (1000 * 60 * 60));
                    currentShiftRate = calculateRate((oldestInWindow.volumeCorrected || oldestInWindow.volume || 0), latestVolume, hrs);
                }
            }

            // 2. ETE Calculation using Blended Activity Logic
            // Strictly isolate dispense rates (must be positive)
            const activeRate = currentShiftRate > 0 ? currentShiftRate : 0;
            
            // Weight current activity against historical norms to handle short telemetry windows
            // If we have few readings (< 10), or current activity is very low, weight historical data more
            const telemetryWeight = Math.min(1, readings.length / 20); 
            const activitySignificance = activeRate > 1 ? 0.8 : 0.2; // If active, favor current rate
            const blendFactor = telemetryWeight * activitySignificance;
            
            const blendedRate = (activeRate * blendFactor) + (avgDailyRate * (1 - blendFactor));
            const effectiveRate = Math.max(0.05, blendedRate);
            
            const hoursLeft = calculateETE(latestVolume, tank.capacity, effectiveRate);

            let ete = 'Stable';
            let predictedRefillDate: number | null = null;

            if (hoursLeft !== null && hoursLeft > 0) {
                predictedRefillDate = latestTimestamp + (hoursLeft * 60 * 60 * 1000);
                
                // [PRACTICAL CAP]: If ETE is > 30 days, show as "Stable" to avoid noise
                if (hoursLeft > 30 * 24) {
                    ete = 'Stable';
                } else if (hoursLeft > 24) {
                    ete = `${(hoursLeft / 24).toFixed(1)} Days`;
                } else {
                    ete = `${hoursLeft.toFixed(1)} Hours`;
                }
            } else if (currentShiftRate < -2) {
                ete = 'Refilling';
            }

            // Real trend detection using raw rate
            const trend = currentShiftRate > 0.5 ? 'decreasing' : currentShiftRate < -0.5 ? 'increasing' : 'stable';

            // [REORDER POINT]: Reorder must be made when volume reaches 20% of capacity
            // So reorder point defines the days/hours remaining to hit 20% capacity.
            const reorderVolume = tank.capacity * 0.20;
            const timeToOrderHrs = (effectiveRate > 0.05) ? ((latestVolume - reorderVolume) / effectiveRate) : null;
            const predictedOrderDate = (timeToOrderHrs !== null) 
                ? (latestTimestamp + (timeToOrderHrs * 60 * 60 * 1000)) 
                : null;

            return {
                defillRate: currentShiftRate, 
                ete,
                timeToOrderHrs,
                predictedRefillDate,
                predictedOrderDate,
                isTheftSuspected: currentShiftRate > (tank.rapidDefillThreshold || TELEMETRY_CONSTANTS.RAPID_DEFILL_LHR),
                isLeakageSuspected: currentShiftRate > 0.38 && currentShiftRate < 10, // precision leak alignment
                trend,
                error: null
            };
        } catch (e: any) {
            logger.error('[useConsumptionAnalytics] Telemetry Analytics Crash:', e);
            return {
                defillRate: 0,
                ete: 'Error',
                timeToOrderHrs: null,
                predictedRefillDate: null,
                predictedOrderDate: null,
                isTheftSuspected: false,
                isLeakageSuspected: false,
                trend: 'stable' as const,
                error: e.message
            };
        }
    }, [tank, readings, shiftStatus, openedAt, avgDailyRate]);

    useEffect(() => {
        if (analytics.error && tank?.name) {
            pushEvent({
                type: 'system_error',
                message: `Analytics failed for ${tank.name}: ${analytics.error}`,
                actionLabel: 'Details',
                onAction: () => {
                    window.dispatchEvent(new CustomEvent('system-toast', {
                        detail: {
                            title: 'Analytics Error',
                            message: `Error processing ${readings.length} readings for ${tank.name}.`,
                            type: 'error',
                            attribution: 'TELEMETRY'
                        }
                    }));
                }
            });
        }
    }, [analytics.error, tank?.name, readings.length, pushEvent]);

    return analytics;
}

