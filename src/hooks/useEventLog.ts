import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type EventCategory = 'SHIFT' | 'DELIVERY' | 'ORDER' | 'TEAM' | 'SECURITY' | 'SYSTEM' | 'FINANCE' | 'AI' | 'CALIBRATION';
export type EventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type EventIntegrity = 'verified' | 'system_generated' | 'manual_override';
export type EventTriggeredBy = 'system' | 'user' | 'ai';
export type EventSource = 'ESP32' | 'Manual' | 'AI' | 'System';

export interface EventLogEntry {
    id: string;
    category: EventCategory;
    type: string;            // Maps to audit_logs.action
    title: string;
    description: string;
    tankId?: string;
    tankName?: string;
    timestamp: number;       // epoch ms
    triggeredBy: EventTriggeredBy;
    triggeredByName: string;
    severity: EventSeverity;
    integrity: EventIntegrity;
    // Expandable detail
    beforeValue?: string;
    afterValue?: string;
    delta?: string;
    nodeId?: string;
    source?: EventSource;
    rawPayload?: Record<string, unknown>;
}

export interface EventLogFilters {
    timeRange: '24h' | '7d' | '30d' | 'custom';
    customStart?: number;
    customEnd?: number;
    category: EventCategory | 'all';
    tankId: string;          // '' = all
    severity: EventSeverity | 'all';
    triggeredBy: EventTriggeredBy | 'all';
    search: string;
}

const DEFAULT_FILTERS: EventLogFilters = {
    timeRange: '7d',
    category: 'all',
    tankId: '',
    severity: 'all',
    triggeredBy: 'all',
    search: '',
};

export const PAGE_SIZE = 25;

export function useEventLog(stationId: string) {
    const [events, setEvents] = useState<EventLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<EventLogFilters>(DEFAULT_FILTERS);
    const [currentPage, setCurrentPage] = useState(1);
    const [tanks, setTanks] = useState<{id: string, name: string}[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!stationId) return;
        fetchTanks();
    }, [stationId]);

    useEffect(() => {
        if (!stationId) return;
        fetchEvents();
    }, [stationId, filters, currentPage]);

    useEffect(() => {
        const fetchCounts = async () => {
            if (!stationId) return;
            const cats: EventCategory[] = ['SHIFT', 'DELIVERY', 'SECURITY', 'SYSTEM', 'AI', 'CALIBRATION'];
            const newCounts: Record<string, number> = {};
            
            await Promise.all(cats.map(async cat => {
                const { count } = await supabase
                    .from('unified_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('station_id', stationId)
                    .eq('event_category', cat);
                newCounts[cat.toLowerCase()] = count || 0;
            }));
            setCounts(newCounts);
        };
        fetchCounts();
    }, [stationId]);

    const fetchTanks = useCallback(async () => {
        const { data } = await supabase.from('tanks').select('id, tank_name').eq('station_id', stationId);
        if (data) setTanks(data.map(t => ({ id: t.id, name: t.tank_name })));
    }, [stationId]);

    const fetchEvents = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('unified_events')
                .select('*', { count: 'exact' })
                .eq('station_id', stationId)
                .order('created_at', { ascending: false });

            // Apply time filters
            const now = new Date();
            if (filters.timeRange !== 'custom') {
                const ms = filters.timeRange === '24h' ? 86400000 : filters.timeRange === '7d' ? 604800000 : 2592000000;
                query = query.gte('created_at', new Date(now.getTime() - ms).toISOString());
            }

            // Apply Category filter
            if (filters.category !== 'all') {
                query = query.eq('event_category', filters.category.toUpperCase());
            }

            if (filters.severity !== 'all') {
                query = query.eq('severity', filters.severity.toUpperCase());
            }

            if (filters.search) {
                query = query.or(`event_type.ilike.%${filters.search}%,description.ilike.%${filters.search}%,actor_email.ilike.%${filters.search}%`);
            }

            // [SECURITY/NOISE]: Silence technical audit noise at the DB level
            query = query
                .not('description', 'ilike', '%detected on alerts%')
                .not('description', 'ilike', '%detected on tanks%')
                .not('description', 'ilike', '%detected on sensor_readings%');

            if (filters.tankId && filters.tankId !== 'all' && filters.tankId !== '') {
                query = query.eq('metadata->>tankId', filters.tankId);
            }

            if (filters.triggeredBy && filters.triggeredBy !== 'all') {
                if (filters.triggeredBy === 'system') {
                    query = query.ilike('metadata->>actor_name', '%system%');
                } else if (filters.triggeredBy === 'user') {
                    query = query.not('metadata->>actor_name', 'ilike', '%system%')
                                 .not('metadata->>actor_name', 'ilike', '%ai%');
                } else if (filters.triggeredBy === 'ai') {
                    // M-06 FIX: Previously unhandled — ai-triggered events use 'TankIQ' or 'ai' in actor_name
                    query = query.ilike('metadata->>actor_name', '%ai%');
                }
            }

            const { data, count, error } = await query
                .range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1);

            if (error) {
                logger.error(`[useEventLog] Fetch failed for station ${stationId}:`, error);
                throw error;
            }

            logger.info(`[useEventLog] Fetched ${data?.length || 0} events (total in DB: ${count})`, { stationId });

            const mapped: EventLogEntry[] = (data || []).map(log => ({
                id: log.id,
                category: (log.event_category || 'SYSTEM') as EventCategory,
                type: log.event_type,
                title: log.event_type.replace(/_/g, ' '),
                description: log.description,
                timestamp: new Date(log.created_at).getTime(),
                triggeredBy: (log.metadata?.actor_name || '').toLowerCase().includes('system') ? 'system' : 'user',
                triggeredByName: log.metadata?.actor_name || log.actor_email || 'System',
                severity: (log.severity || log.metadata?.severity || 'INFO') as EventSeverity,
                integrity: 'verified',
                beforeValue: log.metadata?.before ? JSON.stringify(log.metadata.before, null, 2) : undefined,
                afterValue: log.metadata?.after ? JSON.stringify(log.metadata.after, null, 2) : undefined,
                rawPayload: log.metadata || {}
            }));

            setEvents(mapped);
            setTotal(count || 0);
        } catch (err) {
            logger.error('[useEventLog] Error fetching audit logs:', err);
        } finally {
            setLoading(false);
        }
    }, [stationId, filters, currentPage]);

    async function resolveEvent(eventId: string) {
        if (!eventId) return;
        try {
            const { error } = await supabase.rpc('resolve_unified_event', { p_event_id: eventId });
            if (error) throw error;
            fetchEvents();
        } catch (err) {
            logger.error('[useEventLog] Error resolving event:', err);
        }
    }

    async function acknowledgeAll() {
        if (!stationId) {
            logger.warn('[useEventLog] Cannot acknowledge: No stationId provided.');
            return;
        }
        try {
            // M-05 FIX: Removed fragile dual-parameter retry that silently swallowed
            // non-parameter RPC errors. Using the correct parameter name only.
            const res = await supabase.rpc('resolve_all_station_events', { p_station_id: stationId });
            if (res.error) throw res.error;

            logger.info('[useEventLog] All events acknowledged for station:', stationId);
            fetchEvents();
        } catch (err) {
            logger.error('[useEventLog] Error acknowledging all events:', err);
        }
    }

    function updateFilter<K extends keyof EventLogFilters>(key: K, value: EventLogFilters[K]) {
        setFilters(prev => ({ ...prev, [key]: value }));
        setCurrentPage(1);
    }

    function resetFilters() {
        setFilters(DEFAULT_FILTERS);
        setCurrentPage(1);
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    async function exportCSV() {
        if (!stationId) return;
        
        try {
            logger.info('[useEventLog] Starting full dataset export...', null, 'AUDIT');
            // Fetch up to 1000 records for the current filters (bypassing pagination)
            let query = supabase
                .from('unified_events')
                .select('*')
                .eq('station_id', stationId)
                .order('created_at', { ascending: false })
                .limit(1000);

            // Apply same filters as fetchEvents
            const now = new Date();
            if (filters.timeRange !== 'custom') {
                const ms = filters.timeRange === '24h' ? 86400000 : filters.timeRange === '7d' ? 604800000 : 2592000000;
                query = query.gte('created_at', new Date(now.getTime() - ms).toISOString());
            }
            if (filters.category !== 'all') query = query.eq('event_category', filters.category.toUpperCase());
            if (filters.severity !== 'all') query = query.eq('severity', filters.severity.toUpperCase());
            if (filters.search) query = query.or(`event_type.ilike.%${filters.search}%,description.ilike.%${filters.search}%,actor_email.ilike.%${filters.search}%`);

            const { data, error } = await query;
            if (error) throw error;

            if (!data || data.length === 0) {
                logger.warn('[useEventLog] No events found for export.');
                return;
            }

            const headers = ['EventID', 'Category', 'Type', 'Severity', 'Description', 'Timestamp', 'Actor'];
            const rows = data.map(log => [
                log.id,
                log.event_category,
                log.event_type,
                log.severity || log.metadata?.severity || 'INFO',
                `"${(log.description || '').replace(/"/g, '""')}"`,
                log.created_at,
                log.actor_email || log.metadata?.actor_name || 'System'
            ].join(','));

            const csvContent = [headers.join(','), ...rows].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `iotank-forensic-audit-${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            logger.info(`[useEventLog] Exported ${data.length} events to CSV.`);
        } catch (err) {
            logger.error('[useEventLog] CSV Export failed:', err);
        }
    }


    return {
        events,
        total,
        totalPages,
        currentPage,
        setCurrentPage,
        loading,
        filters,
        updateFilter,
        resetFilters,
        resolveEvent,
        acknowledgeAll,
        categoryCounts: counts,
        tanks,
        exportCSV,
    };
}
