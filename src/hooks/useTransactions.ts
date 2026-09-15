import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';
import { FuelTransaction } from '@/types';
import { validateUUID } from '@/utils/sanitization';
import { logger } from '@/utils/logger';

export function useTransactions(stationId: string, tankId?: string) {
    const query = useQuery({
        queryKey: ['transactions', stationId, tankId],
        queryFn: async () => {
            if (!stationId || (stationId !== 'SYSTEM_GOVERNANCE' && !validateUUID(stationId))) return [];

            let dbQuery = supabase
                .from('fuel_transactions')
                .select('*');
            
            if (stationId !== 'SYSTEM_GOVERNANCE') {
                dbQuery = dbQuery.eq('station_id', stationId);
            }
            
            dbQuery = dbQuery
                .order('timestamp', { ascending: false })
                .limit(50); // Capped — analytics uses dedicated consumption hooks, not this poller

            if (tankId && validateUUID(tankId)) {
                dbQuery = dbQuery.eq('tank_id', tankId);
            }

            const { data, error } = await dbQuery;
            if (error) throw error;

            return (data || []).map(t => ({
                id: t.id,
                type: t.transaction_type,
                tankId: t.tank_id,
                amount: Number(t.amount),
                timestamp: new Date(t.timestamp).getTime(),
                performedBy: t.performed_by_auth_id,
                metadata: t.metadata
            } as FuelTransaction));
        },
        enabled: !!stationId && (stationId === 'SYSTEM_GOVERNANCE' || validateUUID(stationId)),
        refetchInterval: 30000, // MED-11 FIX: Managed polling instead of manual setInterval
    });

    const logTransaction = async (data: Omit<FuelTransaction, 'id' | 'timestamp'>) => {
        try {
            const { error } = await supabase
                .from('fuel_transactions')
                .insert({
                    station_id: stationId,
                    tank_id: data.tankId,
                    transaction_type: data.type,
                    amount: data.amount,
                    performed_by_auth_id: data.performedBy,
                    metadata: data.metadata || {}
                });

            if (error) throw error;
            // Optimistically update or trigger refetch
            query.refetch();
        } catch (error) {
            logger.error('[useTransactions] Error logging transaction:', error);
            throw error;
        }
    };

    return { 
        transactions: query.data || [], 
        logTransaction, 
        loading: query.isLoading, 
        error: query.error as Error | null 
    };
}
