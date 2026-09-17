import { supabase } from '../config/supabase';

export interface AuditEntry {
    id: string;
    timestamp: string;
    user_name: string;
    user_email: string;
    user_role: string;
    action_category: 'System' | 'User' | 'Financial' | 'Support' | 'Security' | 'Hardware' | 'Data';
    action_type: string;
    description: string;
    resource_id?: string;
    ip_address: string;
    user_agent: string;
    result: 'success' | 'failed';
    changes?: { before: any; after: any };
}

export interface FinancialTrail {
    id: string;
    timestamp: string;
    type: 'Payment' | 'Refund' | 'Adjustment' | 'Charge' | 'Credit';
    client_name: string;
    amount: number;
    prev_balance: number;
    new_balance: number;
    initiated_by: string;
    reference: string;
    status: 'completed' | 'reversed' | 'pending';
}

export interface ComplianceStatus {
    id: string;
    name: string;
    category: 'EPRA' | 'NEMA' | 'KRA' | 'Data Protection' | 'Regulatory' | 'Tax' | (string & {});
    status: 'compliant' | 'warning' | 'expired';
    expiry_date?: string;
    last_audit: string;
}

export interface SecurityIncident {
    id: string;
    timestamp: string;
    type: 'Brute Force' | 'Unauthorized Access' | 'Suspicious Export' | 'SQL Injection Attempt';
    severity: 'low' | 'medium' | 'high' | 'critical';
    source_ip: string;
    status: 'blocked' | 'flagged' | 'resolved';
}

export const adminAuditService = {
    async getAuditLogs(filters?: any): Promise<AuditEntry[]> {
        let query = supabase
            .from('unified_events')
            .select('*')
            .order('created_at', { ascending: false });

        if (filters?.category && filters.category !== 'All') {
            query = query.eq('event_category', filters.category);
        }

        const { data, error } = await query.limit(100);
        
        if (error) {
            console.error('Error fetching audit logs:', error);
            return [];
        }

        return (data || []).map(row => ({
            id: row.id,
            timestamp: row.created_at,
            user_name: row.metadata?.actor_name || 'System',
            user_email: row.actor_email || '',
            user_role: row.metadata?.user_role || 'Operator',
            action_category: row.event_category as any,
            action_type: row.event_type,
            description: row.description,
            resource_id: row.metadata?.resource_id,
            ip_address: row.metadata?.ip_address || 'Internal',
            user_agent: row.metadata?.user_agent || 'System',
            result: (row.metadata?.result || 'success') as any,
            changes: row.metadata?.changes
        }));
    },

    async getFinancialTrail(): Promise<FinancialTrail[]> {
        const { data, error } = await supabase
            .from('unified_events')
            .select('*')
            .eq('event_category', 'FINANCIAL')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Error fetching financial trail:', error);
            return [];
        }

        return (data || []).map(row => ({
            id: row.id,
            timestamp: new Date(row.created_at).toLocaleString(),
            type: (row.metadata?.type || 'Adjustment') as any,
            client_name: row.metadata?.station_name || 'Global',
            amount: row.metadata?.amount || 0,
            prev_balance: row.metadata?.prev_balance || 0,
            new_balance: row.metadata?.new_balance || 0,
            initiated_by: row.metadata?.actor_name || 'System',
            reference: row.metadata?.reference || row.id.substring(0, 8),
            status: 'completed'
        }));
    },

    async getComplianceOverview(): Promise<ComplianceStatus[]> {
        const { data, error } = await supabase
            .from('knowledge_base')
            .select('id, title, category, created_at')
            .eq('category', 'compliance')
            .eq('is_published', true);

        if (error) {
            console.error('Error fetching compliance data:', error);
            return [];
        }

        return (data || []).map(row => ({
            id: row.id,
            name: row.title,
            category: 'Data Protection', // Default mapping
            status: 'compliant',
            last_audit: new Date(row.created_at).toLocaleDateString()
        }));
    },

    async getSecurityIncidents(): Promise<SecurityIncident[]> {
        const { data, error } = await supabase
            .from('unified_events')
            .select('*')
            .in('severity', ['WARNING', 'CRITICAL'])
            .in('event_category', ['SECURITY', 'AUTH'])
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) return [];

        return (data || []).map(row => ({
            id: row.id,
            timestamp: new Date(row.created_at).toLocaleString(),
            type: row.event_type as any,
            severity: (row.severity?.toLowerCase() || 'medium') as any,
            source_ip: row.metadata?.ip_address || 'Unknown',
            status: 'flagged'
        }));
    },

    async getAdminRiskMetrics() {
        const { data, error } = await supabase.rpc('get_admin_risk_matrix');

        if (error) {
            console.error('Error fetching risk matrix:', error);
            // Fallback to basic counts if RPC not available yet
            const { data: criticalEvents } = await supabase
                .from('unified_events')
                .select('id')
                .eq('severity', 'CRITICAL');

            const { data: securityEvents } = await supabase
                .from('unified_events')
                .select('id')
                .eq('event_category', 'SECURITY');

            return {
                highRiskActions: criticalEvents?.length || 0,
                suspiciousLogins: securityEvents?.length || 0,
                unauthorizedAttempt: securityEvents?.length || 0,
                avgResolutionTime: '1.2h'
            };
        }

        const totalHighRisk = data.reduce((acc: number, curr: any) => acc + Number(curr.high_risk_actions), 0);
        const totalSecurity = data.reduce((acc: number, curr: any) => acc + Number(curr.security_alerts), 0);

        return {
            highRiskActions: totalHighRisk,
            suspiciousLogins: totalSecurity,
            unauthorizedAttempt: totalSecurity,
            avgResolutionTime: '1.2h',
            matrix: data
        };
    }
};

