import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';

/**
 * TankIQ Toolset
 * Handlers for AI-generated tool calls that interact with Supabase safely.
 */
export const TankIQToolset = {
    /**
     * Fetches basic station status including tanks and active alerts.
     */
    async get_station_summary(stationId: string) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_station_summary', {
                p_station_id: stationId
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_station_summary] Error:', err);
            return { error: 'Failed to fetch station summary.' };
        }
    },

    /**
     * Fetches fuel consumption statistics over a specific period.
     */
    async get_consumption_analytics(stationId: string, parameters: { days?: number }) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_consumption_stats', {
                p_station_id: stationId,
                p_days: parameters.days || 7
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_consumption_analytics] Error:', err);
            return { error: 'Failed to fetch consumption statistics.' };
        }
    },

    /**
     * Fetches recent delivery logs.
     */
    async get_delivery_logs(stationId: string, parameters: { limit?: number }) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_delivery_logs', {
                p_station_id: stationId,
                p_limit: parameters.limit || 5
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_delivery_logs] Error:', err);
            return { error: 'Failed to fetch delivery logs.' };
        }
    },

    /**
     * Fetches market context including EPRA prices and regulatory notices.
     */
    async get_market_context() {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_market_context');
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_market_context] Error:', err);
            return { error: 'Failed to fetch market context.' };
        }
    },
    
    /**
     * Fetches detailed shift analytics including variances and sales.
     */
    async get_shift_analytics(stationId: string, parameters: { limit?: number }) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_shift_analytics', {
                p_station_id: stationId,
                p_limit: parameters.limit || 5
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_shift_analytics] Error:', err);
            return { error: 'Failed to fetch shift analytics.' };
        }
    },

    /**
     * Fetches financial status including debt and invoices.
     */
    async get_financial_status(stationId: string) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_financial_status', {
                p_station_id: stationId
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_financial_status] Error:', err);
            return { error: 'Failed to fetch financial status.' };
        }
    },

    /**
     * Fetches hardware health diagnostics for all sensors.
     */
    async get_hardware_health(stationId: string) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_hardware_health', {
                p_station_id: stationId
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_hardware_health] Error:', err);
            return { error: 'Failed to fetch hardware health diagnostics.' };
        }
    },

    /**
     * Fetches forensic audit logs for the station.
     */
    async get_audit_logs(stationId: string, parameters: { limit?: number }) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_audit_logs', {
                p_station_id: stationId,
                p_limit: parameters.limit || 10
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_audit_logs] Error:', err);
            return { error: 'Failed to fetch audit logs.' };
        }
    },

    /**
     * Fetches a summary of support tickets.
     */
    async get_support_summary(stationId: string) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_support_summary', {
                p_station_id: stationId
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_support_summary] Error:', err);
            return { error: 'Failed to fetch support summary.' };
        }
    },

    /**
     * Fetches platform usage insights.
     */
    async get_usage_insights(stationId: string, parameters: { days?: number }) {
        try {
            const { data, error } = await supabase.rpc('get_tankiq_usage_insights', {
                p_station_id: stationId,
                p_days: parameters.days || 30
            });
            if (error) throw error;
            return data;
        } catch (err) {
            logger.error('TankIQ Tool [get_usage_insights] Error:', err);
            return { error: 'Failed to fetch usage insights.' };
        }
    }
};

/**
 * Tool Definitions for the AI Models
 */
export const TANKIQ_TOOLS_METADATA = [
    {
        type: 'function',
        function: {
            name: 'get_station_summary',
            description: 'Get live telemetry readings, real-time sensor data, and a summary of the station (name, location, county) and all tanks (volumes, capacities, fuel types) and currently active/unresolved alerts for the station.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_consumption_analytics',
            description: 'Get fuel consumption stats (total burn, avg daily burn) per tank over a specific number of days.',
            parameters: {
                type: 'object',
                properties: {
                    days: { type: 'number', description: 'Number of days to analyze (default: 7)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_delivery_logs',
            description: 'Get a log of the most recent fuel deliveries recorded for the station.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Number of recent deliveries to fetch (default: 5)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_market_context',
            description: 'Get current EPRA fuel prices in Kenya and recent regulatory notices or advisories.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_shift_analytics',
            description: 'Get summary of recent shift closures, volume sold, cash/mpesa collections, and variances (shortages/overages).',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Number of recent shifts to fetch (default: 5)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_financial_status',
            description: 'Get the financial standing of the station, including current debt, total paid, subscription tier, and recent invoices.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_hardware_health',
            description: 'Get diagnostic data for all hardware sensors (signal strength, reading quality, last telemetry timestamp).',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_audit_logs',
            description: 'Get a forensic audit trail of all critical events, system changes, and actor activities for the station.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Number of recent events to fetch (default: 10)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_support_summary',
            description: 'Get a summary of all active and historical support tickets, including their status and priority.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_usage_insights',
            description: 'Get insights into platform usage (SMS, API calls, AI queries) and associated costs over a period.',
            parameters: {
                type: 'object',
                properties: {
                    days: { type: 'number', description: 'Number of days to analyze (default: 30)' }
                }
            }
        }
    }
];
