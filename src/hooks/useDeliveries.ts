import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { DeliveryDocument } from '@/types';
import { validateUUID } from '@/utils/sanitization';
import { EXPANSION_COEFFICIENTS, REF_TEMP_C } from '@/utils/thermalCorrection';
import { logger } from '@/utils/logger';

// Fuel type alias resolver for thermal correction
const FUEL_ALIASES: Record<string, keyof typeof EXPANSION_COEFFICIENTS> = {
    pms: 'petrol', super: 'petrol', gasoline: 'petrol',
    ago: 'diesel', biodiesel: 'diesel',
    ik: 'kerosene', kerosene: 'kerosene',
};

/**
 * Standardize an observed volume to the 15°C reference using the inverse thermal formula.
 * V_std = V_observed / (1 + alpha * (T_delivery - T_ref))
 */
function standardizeToRef(observedLiters: number, deliveryTempC: number, fuelTypeRaw: string): number {
    const key = FUEL_ALIASES[fuelTypeRaw.toLowerCase()] ?? 'diesel';
    const alpha = EXPANSION_COEFFICIENTS[key];
    const deltaT = deliveryTempC - REF_TEMP_C;
    const factor = 1 + alpha * deltaT;
    return factor > 0 ? parseFloat((observedLiters / factor).toFixed(2)) : observedLiters;
}

interface UseDeliveriesOptions {
    startDate?: string;
    endDate?: string;
    tankId?: string;
    status?: string;
}

export function useDeliveries(stationId: string, options: UseDeliveriesOptions = {}) {
    const [deliveries, setDeliveries] = useState<DeliveryDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchDeliveries = useCallback(async () => {
        if (!stationId) return;

        setLoading(true);
        try {
            let query = supabase
                .from('deliveries')
                .select('*, tanks(fuel_type, tank_name)')  // Join tank to get product type
                .eq('station_id', stationId)
                .order('created_at', { ascending: false });

            if (options.startDate) {
                query = query.gte('created_at', options.startDate);
            }
            if (options.endDate) {
                query = query.lte('created_at', options.endDate);
            }
            if (options.tankId && validateUUID(options.tankId)) {
                query = query.eq('tank_id', options.tankId);
            }
            if (options.status) {
                query = query.eq('status', options.status);
            }

            const { data, error: fetchError } = await query;

            if (fetchError) throw fetchError;

            const mappedDeliveries = (data || []).map(row => {
                // variance_volume is a DB GENERATED COLUMN: bol_claimed_volume - actual_received_volume
                const varianceLiters = row.variance_volume !== null && row.variance_volume !== undefined
                    ? Number(row.variance_volume)
                    : (Number(row.bol_claimed_volume || 0) - Number(row.actual_received_volume || 0));
                const invoiceLiters = Number(row.bol_claimed_volume || 0);
                const variancePct = invoiceLiters > 0 ? (varianceLiters / invoiceLiters) * 100 : 0;

                const actualReceivedVol = Number(row.actual_received_volume || row.tank_after_volume || 0);
                const beforeVol = Number(row.tank_before_volume || 0);
                const afterVol  = Number(row.tank_after_volume || 0);
                const capacity  = Number(row.tanks?.capacity || row.capacity || 1);
                const tempC     = Number(row.temperature_c || REF_TEMP_C);
                const fuelTypeRaw = row.tanks?.fuel_type || row.product || 'AGO';

                // Standardize observed volume to 15°C reference for forensic comparison
                const standardLiters = standardizeToRef(actualReceivedVol, tempC, fuelTypeRaw);

                // Normalize DB status to DeliveryDocument union
                const rawStatus = (row.verification_status || row.status || '').toUpperCase();
                const status: 'VERIFIED' | 'NEEDS_REVIEW' | 'DISPUTED' =
                    rawStatus === 'VERIFIED' ? 'VERIFIED' :
                    rawStatus === 'DISPUTED' ? 'DISPUTED' : 'NEEDS_REVIEW';

                return {
                    id: row.id,
                    ts: row.delivery_date || row.created_at,
                    ts_day: row.delivery_date ? row.delivery_date.slice(0, 10) : (row.created_at || '').slice(0, 10),
                    siteId: row.site_id || '',
                    nodeId: row.node_id || '',
                    tankId: row.tank_id || '',
                    // Product comes from joined tank's fuel_type
                    product: row.tanks?.fuel_type || row.product || 'Unknown',
                    supplier: row.supplier_name || row.supplier || '',
                    invoiceNo: row.bol_number || row.invoice_no || '',
                    invoiceLiters,
                    // Full measured shape as required by DeliveryDocument
                    measured: {
                        observedLiters: actualReceivedVol,
                        standardizedLiters: standardLiters,  // Thermal correction applied: V_std at 15°C
                        tempC,
                        refTempC: REF_TEMP_C
                    },
                    // Full before/after shape as required by DeliveryDocument
                    before: {
                        pct: capacity > 0 ? parseFloat(((beforeVol / capacity) * 100).toFixed(1)) : 0,
                        litersStd: beforeVol
                    },
                    after: {
                        pct: capacity > 0 ? parseFloat(((afterVol / capacity) * 100).toFixed(1)) : 0,
                        litersStd: afterVol
                    },
                    variance: {
                        liters: varianceLiters,
                        pct: parseFloat(variancePct.toFixed(2))
                    },
                    status,
                    verified: row.is_accepted === true,
                    createdBy: (() => {
                        if (typeof row.created_by === 'string') {
                            try {
                                return JSON.parse(row.created_by);
                            } catch {
                                return { kind: 'system', authUserId: '', display: row.created_by || 'System' };
                            }
                        }
                        return row.created_by || { kind: 'system', authUserId: '', display: 'System' };
                    })(),
                    createdAt: row.created_at,
                    notes: row.dispute_notes || row.notes,
                    bolPhotoUrl: row.bol_photo_url
                } as unknown as DeliveryDocument;
            });

            setDeliveries(mappedDeliveries);
            setError(null);
        } catch (err: any) {
            logger.error('[useDeliveries] Error fetching deliveries:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [stationId, options.startDate, options.endDate, options.tankId, options.status]);

    useEffect(() => {
        fetchDeliveries();
    }, [fetchDeliveries]);

    // Stable Realtime subscription — keyed only on stationId so filter changes
    // do not spawn duplicate channels that leak Supabase connection slots.
    useEffect(() => {
        if (!stationId) return;

        const channelId = `deliveries-all-${stationId}`;
        const channel = supabase
            .channel(channelId)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `station_id=eq.${stationId}` },
                fetchDeliveries
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'deliveries', filter: `station_id=eq.${stationId}` },
                fetchDeliveries
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [stationId, fetchDeliveries]);

    return { deliveries, loading, error, refresh: fetchDeliveries };
}
