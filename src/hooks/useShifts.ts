import { supabase } from '@/config/supabase';
import { ShiftDocument } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { validateUUID } from '@/utils/sanitization';

interface UseShiftsOptions {
    startDate?: Date;
    endDate?: Date;
    tankId?: string;
    siteId?: string;
}

interface UseShiftsReturn {
    shifts: ShiftDocument[];
    loading: boolean;
    error: string | null;
}

/**
 * Hook for Shift Operational Logs (Historical)
 */
export function useShifts(stationId: string, options: UseShiftsOptions = {}): UseShiftsReturn {
    const query = useQuery({
        queryKey: ['shifts', stationId, options],
        queryFn: async () => {
            if (!stationId) return [];

            let sbQuery = supabase
                .from('shift_closures')
                .select('*')
                .eq('station_id', stationId)
                .order('closed_at', { ascending: false });

            if (options.startDate) {
                sbQuery = sbQuery.gte('closed_at', options.startDate.toISOString());
            }

            if (options.endDate) {
                const endOfDay = new Date(options.endDate);
                endOfDay.setHours(23, 59, 59, 999);
                sbQuery = sbQuery.lte('closed_at', endOfDay.toISOString());
            }

            if (options.tankId && validateUUID(options.tankId)) {
                sbQuery = sbQuery.eq('tank_id', options.tankId);
            }

            if (options.siteId) {
                sbQuery = sbQuery.eq('site_id', options.siteId);
            }

            const { data, error } = await sbQuery;
            if (error) throw error;

            return (data || []).map(row => {
                const pumpReadings = row.pump_readings || {};
                const readingsArray = Object.values(pumpReadings) as any[];
                
                // Aggregate data for multi-tank stations
                const totalOpening = readingsArray.reduce((sum, r) => sum + (r.start || 0), 0);
                const totalClosing = readingsArray.reduce((sum, r) => sum + (r.end || 0), 0);
                const totalSales = row.volume_sold_liters || 0;
                
                return {
                    ...row,
                    id: row.id,
                    tankId: row.tank_id,
                    siteId: row.site_id,
                    received_collections: row.received_collections || {},
                    variance_data: row.variance_data || {},
                    
                    openingReading: totalOpening,
                    closingReading: totalClosing,
                    salesVolume: totalSales,
                    variance: row.variance_data?.amount || 0,
                    cashCollected: row.received_collections?.total || 0,
                    
                    openedAt: row.opened_at,
                    closedAt: row.closed_at,
                    operatorName: row.metadata?.opened_by?.display || row.metadata?.operator?.name || row.operator_name || 'Unknown',
                    notes: row.supervisor_notes || row.notes,
                    status: row.status,
                    reviewState: row.review_state
                } as unknown as ShiftDocument;
            });
        },
        enabled: !!stationId,
        staleTime: 1000,
        refetchInterval: 5000, // M-03: Increased from 2s — historical shift data doesn't need sub-2s accuracy
    });

    return { 
        shifts: query.data || [], 
        loading: query.isLoading, 
        error: query.error ? (query.error as Error).message : null 
    };
}

/**
 * Hook for Active Shift Tracking (Continuous State)
 */
export function useActiveShift(stationId: string | undefined) {
    const query = useQuery({
        queryKey: ['active_shift', stationId],
        queryFn: async () => {
            if (!stationId) return null;
            const { data, error } = await supabase
                .from('current_station_shifts')
                .select('*')
                .eq('station_id', stationId)
                .maybeSingle();

            if (error) throw error;
            return data || null;
        },
        enabled: !!stationId,
        staleTime: 1000,
        refetchInterval: 3000, // M-03: Increased from 2s — active shift state detection at 3s is sufficient
    });

    return { activeShift: query.data || null, loading: query.isLoading, error: query.error as Error | null };
}
