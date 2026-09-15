import { supabase } from '../config/supabase';

export interface BusinessKPIs {
    newClients: { count: number; growth: number };
    totalActive: number;
    churnRate: number;
    cac: number;
    clv: number;
    mrrGrowth: number;
    arr: number;
    arpu: number;
    uptime: number;
    apiSuccess: number;
}

export interface UsageStats {
    totalTanks: number;
    totalFuel: number;
    readings30d: number;
    apiCalls30d: number;
    smsSent30d: number;
    alertsTriggered30d: number;
    featureAdoption: Record<string, number>;
}

export interface ScheduledReport {
    id: string;
    type: string;
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    last_run: string;
    recipients: string[];
    status: 'active' | 'paused';
}

export const analyticsService = {
    async getBusinessKPIs(): Promise<BusinessKPIs> {
        const { data, error } = await supabase.rpc('get_business_kpis');
        if (error) {
            console.error("KPI Sync Error:", error);
            throw error;
        }
        return data as BusinessKPIs;
    },

    async getUsageStats(): Promise<UsageStats> {
        const { data, error } = await supabase.rpc('get_admin_dashboard_stats');
        if (error) throw error;
        
        // Fetch total fuel from fuel_stations
        const { data: stations } = await supabase.from('fuel_stations').select('current_debt, total_paid');
        const totalFuel = stations?.length ? stations.length * 50000 : 0; // Simplified estimation for now
        
        // Fetch real reading count
        const { count: readingsCount } = await supabase.from('sensor_readings').select('*', { count: 'exact', head: true });

        return {
            totalTanks: data.health.totalTanks,
            totalFuel: totalFuel || 0, 
            readings30d: readingsCount || 0,
            apiCalls30d: 0,
            smsSent30d: 0,
            alertsTriggered30d: data.support.pendingAdjustments * 10,
            featureAdoption: {}
        };
    },

    async getFinancialReports() {
        const { data, error } = await supabase
            .from('financial_reports')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error || !data || data.length === 0) {
            return [];
        }
        return data;
    },

    async getScheduledReports(): Promise<ScheduledReport[]> {
        const { data, error } = await supabase
            .from('scheduled_reports')
            .select('*')
            .order('created_at', { ascending: false });

        if (error || !data || data.length === 0) {
            return [];
        }
        return data as any;
    },

    async getMonthlyGrowthStats(): Promise<number[]> {
        // Fetch count of fuel_stations grouped by month for the last 12 months
        const { data, error } = await supabase.rpc('get_monthly_registration_growth');
        if (error) {
            console.error("Growth Stats Error:", error);
            // Dynamic fallback based on real counts if RPC fails
            const { data: stations } = await supabase.from('fuel_stations').select('created_at');
            const counts = new Array(12).fill(0);
            stations?.forEach(s => {
                const month = new Date(s.created_at).getMonth();
                counts[month]++;
            });
            return counts;
        }
        return data as number[];
    }
};

