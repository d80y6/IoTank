import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Report {
    id: string;
    station_id: string;
    delivery_id: string | null;
    name: string;
    report_type: 'delivery_verification' | 'inventory_summary' | 'shift_reconciliation' | 'compliance_pack' | 'custom';
    report_data: Record<string, unknown>;
    generated_by: string | null;
    created_at: string;
    // Joined from deliveries
    delivery?: {
        delivery_date: string;
        supplier_name: string | null;
        bol_number: string | null;
        bol_claimed_volume: number | null;
        actual_received_volume: number | null;
        variance_volume: number | null;
        verification_status: string | null;
    } | null;
}

export interface ReportsFilter {
    report_type?: string;
    dateFrom?: string;
    dateTo?: string;
}

export interface UseReportsReturn {
    reports: Report[];
    loading: boolean;
    error: string | null;
    totalCount: number;
    refresh: () => void;
    deleteReport: (id: string) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useReports(
    stationId: string,
    filter: ReportsFilter = {}
): UseReportsReturn {
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [totalCount, setTotalCount] = useState(0);

    const fetchReports = useCallback(async () => {
        if (!stationId) {
            setReports([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            let query = supabase
                .from('reports')
                .select(`
                    id,
                    station_id,
                    delivery_id,
                    name,
                    report_type,
                    report_data,
                    generated_by,
                    created_at,
                    delivery:deliveries (
                        delivery_date,
                        supplier_name,
                        bol_number,
                        bol_claimed_volume,
                        actual_received_volume,
                        variance_volume,
                        verification_status
                    )
                `, { count: 'exact' })
                .eq('station_id', stationId)
                .order('created_at', { ascending: false })
                .limit(100);

            if (filter.report_type) {
                query = query.eq('report_type', filter.report_type);
            }

            if (filter.dateFrom) {
                query = query.gte('created_at', filter.dateFrom);
            }

            if (filter.dateTo) {
                // Add one day to make it inclusive
                const end = new Date(filter.dateTo);
                end.setDate(end.getDate() + 1);
                query = query.lt('created_at', end.toISOString());
            }

            const { data, error: fetchError, count } = await query;

            if (fetchError) throw fetchError;

            setReports((data as unknown as Report[]) || []);
            setTotalCount(count || 0);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to load reports';
            setError(msg);
            logger.error('[useReports] Error:', err);
        } finally {
            setLoading(false);
        }
    }, [stationId, filter.report_type, filter.dateFrom, filter.dateTo]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const deleteReport = useCallback(async (id: string) => {
        const { error: delError } = await supabase
            .from('reports')
            .delete()
            .eq('id', id);

        if (delError) throw delError;
        setReports(prev => prev.filter(r => r.id !== id));
        setTotalCount(prev => prev - 1);
    }, []);

    return {
        reports,
        loading,
        error,
        totalCount,
        refresh: fetchReports,
        deleteReport,
    };
}
