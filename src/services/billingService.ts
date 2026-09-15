import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

export interface ClientBillingSummary {
  station: {
    current_debt: number;
    total_paid: number;
    account_status: string;
    next_billing_date: string | null;
  };
  tanks: {
    id: string;
    name: string;
    fuel_type: string;
    current_volume: number;
    capacity: number;
    fill_percentage: number;
    temperature: number;
    status: string;
  }[];
  unread_alerts: number;
  critical_alerts: number;
}

export const billingService = {
  /**
   * Fetches the dashboard summary for a station using the `get_station_dashboard_summary` RPC function
   */
  async getDashboardSummary(stationId: string): Promise<ClientBillingSummary | null> {
    try {
      if (!stationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stationId)) {
        return null;
      }
      
      const { data, error } = await supabase.rpc('get_station_dashboard_summary', {
        p_station_id: stationId
      });

      if (error) {
        throw error;
      }

      return data as ClientBillingSummary;
    } catch (error) {
      logger.error('[billingService] Error fetching station dashboard summary:', error);
      return null;
    }
  },

  /**
   * Fetches the full billing record for a specific station
   */
  async getClientBilling(stationId: string) {
    try {
      if (!stationId) return null;
      const { data, error } = await supabase
        .from('fuel_stations')
        .select('*')
        .eq('id', stationId)   // fuel_stations PK is 'id', not 'station_id'
        .single();
        
      if (error) {
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.error('[billingService] Error fetching client billing:', error);
      return null;
    }
  },
  
  /**
   * Fetches recent transactions for a specific station
   */
  async getTransactions(stationId: string, limit = 10) {
    try {
      if (!stationId) return [];
      const { data, error } = await supabase
        .from('fuel_transactions') // HIGH-08 FIX: was 'transactions' — must match actual table name
        .select('*')
        .eq('station_id', stationId)
        .order('created_at', { ascending: false })
        .limit(limit);
        
      if (error) {
        throw error;
      }
      
      return data;
    } catch (error) {
      logger.error('[billingService] Error fetching transactions:', error);
      return [];
    }
  }
};
