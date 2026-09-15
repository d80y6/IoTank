import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { FuelOrder } from '@/types';
import { logger } from '@/utils/logger';

export function useOrders(stationId: string) {
    const [orders, setOrders] = useState<FuelOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchOrders = useCallback(async () => {
        if (!stationId) return;

        setLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('unified_events')
                .select('*')
                .eq('station_id', stationId)
                .eq('event_category', 'ORDER')
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;

            const mappedOrders: FuelOrder[] = (data || []).map(log => ({
                id: log.id,
                orderRef: log.metadata?.order_ref || log.id.slice(0, 8),
                supplier: log.metadata?.supplier || 'Unknown',
                product: log.metadata?.product || 'Fuel',
                quantity: Number(log.metadata?.quantity || 0),
                expectedDate: log.metadata?.expected_date || log.created_at,
                status: log.metadata?.status || 'Pending',
                priority: log.metadata?.priority || 'Normal',
                actorEmail: log.actor_email || 'System',
                createdAt: log.created_at,
                notes: log.metadata?.notes
            }));

            setOrders(mappedOrders);
            setError(null);
        } catch (err: any) {
            logger.error('[useOrders] Error fetching orders:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [stationId]);

    useEffect(() => {
        if (!stationId) return;

        fetchOrders();

        if (import.meta.env.VITE_DISABLE_REALTIME === 'true') return;

        const channel = supabase
            .channel(`orders-realtime-${stationId}`)
            .on(
                'postgres_changes',
                { 
                    event: 'INSERT', 
                    schema: 'public', 
                    table: 'unified_events',
                    filter: `station_id=eq.${stationId}`   // ← Scoped at DB level, not just client-side
                },
                (payload) => {
                    // Check if the event matches our station and category
                    const newLog = payload.new as any;
                    if (newLog?.station_id === stationId && newLog?.event_category === 'ORDER') {
                        fetchOrders();
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchOrders, stationId]);

    return { orders, loading, error, refresh: fetchOrders };
}
