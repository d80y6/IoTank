import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { billingService, ClientBillingSummary } from '../services/billingService';
import { supabase } from '../config/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Enterprise-grade hook for dashboard data management.
 * Leverages TanStack Query for caching and Supabase Realtime for live updates.
 */
export const useDashboardData = () => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const stationId = currentUser?.stationId || '';

  const {
    data,
    isLoading: loading,
    error,
    refetch
  } = useQuery({
    queryKey: ['dashboard_summary', stationId],
    queryFn: async () => {
      if (!stationId || stationId === 'SYSTEM_GOVERNANCE' || currentUser?.isSystemAccount) {
        return null;
      }
      return billingService.getDashboardSummary(stationId);
    },
    enabled: !!stationId && stationId !== 'SYSTEM_GOVERNANCE' && !currentUser?.isSystemAccount,
    staleTime: 30 * 1000, // Data fresh for 30 seconds
  });

  useEffect(() => {
    if (!stationId || currentUser?.isSystemAccount) return;

    // ─── Real-Time "Live Listening" ────────────────────────────────
    
    // 1. Subscribe to Tank Updates
    // C-06 FIX: Stable channel name — Date.now()+Math.random() was creating a new orphaned
    // Supabase channel on every re-render, exhausting the 200-slot connection pool.
    const tankChannelId = `live-tanks-${stationId}`;
    const tankSubscription = supabase
      .channel(tankChannelId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tanks',
          filter: `station_id=eq.${stationId}`
        },
        (payload) => {
          // Update the cache directly instead of refetching everything
          queryClient.setQueryData(['dashboard_summary', stationId], (prev: ClientBillingSummary | undefined) => {
            if (!prev) return prev;
            
            const updatedTanks = prev.tanks.map(tank => {
              if (tank.id === payload.new.id) {
                return {
                  ...tank,
                  current_volume: payload.new.current_volume,
                  temperature: payload.new.current_temperature,
                  fill_percentage: (payload.new.current_volume / payload.new.tank_capacity) * 100,
                  status: payload.new.status
                };
              }
              return tank;
            });

            return { ...prev, tanks: updatedTanks };
          });
        }
      )
      .subscribe();

    // 2. Subscribe to Alerts
    const alertChannelId = `live-alerts-${stationId}`;
    const alertSubscription = supabase
      .channel(alertChannelId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
          filter: `station_id=eq.${stationId}`
        },
        () => {
          // For alerts, we invalidate the query to trigger a background refetch
          // as the summary counts are computed in the DB.
          queryClient.invalidateQueries({ queryKey: ['dashboard_summary', stationId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tankSubscription);
      supabase.removeChannel(alertSubscription);
    };
  }, [stationId, currentUser?.isSystemAccount, queryClient]);

  return { data, loading, error: error as Error, refetch };
};

