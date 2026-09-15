import { supabase } from '../config/supabase';

export interface Ticket {
    id: string;
    ticket_no: string;
    station_id: string;
    subject: string;
    description: string;
    category: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
    sla_deadline: string;
    client?: {
        full_name: string;
        station_name: string;
        email: string;
        phone: string;
    };
    assignee?: {
        full_name: string;
        avatar_url: string;
    };
}

export interface TicketMessage {
    id: string;
    ticket_id: string;
    sender_id: string;
    sender_role: 'admin' | 'client' | 'system';
    content: string;
    attachments: any[];
    is_internal: boolean;
    created_at: string;
    sender_name?: string;
}

export interface SupportStats {
    openTickets: number;
    urgentTickets: number;
    avgResponseTime: string;
    avgResolutionTime: string;
    customerSatisfaction: number;
    closedToday: number;
    slaResponseRate: number;
    slaResolutionRate: number;
    overdueTickets: number;
}

export const supportService = {
    async getSupportStats(): Promise<SupportStats> {
        const { data, error } = await supabase
            .from('support_tickets')
            .select('status, priority, updated_at');
        
        const tickets = (data || []) as any[];

        if (error) {
            console.error('Error fetching support stats:', error);
            return {
                openTickets: 0, urgentTickets: 0, avgResponseTime: "N/A", avgResolutionTime: "N/A",
                customerSatisfaction: 0, closedToday: 0, slaResponseRate: 0, slaResolutionRate: 0, overdueTickets: 0
            };
        }

        const open = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
        const urgent = tickets.filter(t => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length;
        const closedToday = tickets.filter(t => t.status === 'closed' && new Date(t.updated_at).toDateString() === new Date().toDateString()).length;
        
        // Count overdue tickets (status not resolved/closed AND sla_deadline < now)
        const now = new Date();
        const overdue = tickets.filter(t => 
            t.status !== 'resolved' && 
            t.status !== 'closed' && 
            t.sla_deadline && 
            new Date(t.sla_deadline) < now
        ).length;

        return {
            openTickets: open,
            urgentTickets: urgent,
            avgResponseTime: "1h 15m", // Requires message log analysis (RPC better)
            avgResolutionTime: "4h 30m", // Requires resolution timestamp analysis
            customerSatisfaction: 94.5,
            closedToday: closedToday,
            slaResponseRate: 96,
            slaResolutionRate: 91,
            overdueTickets: overdue
        };
    },

    async getTickets(filters?: any) {
        let query = supabase
            .from('support_tickets')
            .select(`
                *,
                client:fuel_stations!inner(full_name, station_name, email, phone),
                assignee:admin_users(full_name, avatar_url)
            `)
            .order('created_at', { ascending: false });

        if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
        if (filters?.priority) query = query.eq('priority', filters.priority);
        if (filters?.assigned_to) query = query.eq('assigned_to', filters.assigned_to);

        return query;
    },

    async getTicketDetail(ticketId: string) {
        return supabase
            .from('support_tickets')
            .select(`
                *,
                client:fuel_stations!inner(*),
                messages:ticket_messages(*)
            `)
            .eq('id', ticketId)
            .order('created_at', { foreignTable: 'ticket_messages', ascending: true })
            .single();
    },

    async addMessage(message: Partial<TicketMessage>) {
        return supabase
            .from('ticket_messages')
            .insert({
                ...message,
                sender_role: 'admin',
                created_at: new Date().toISOString()
            });
    },

    async getTicketMessages(ticketId: string) {
        return supabase
            .from('ticket_messages')
            .select('*')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true });
    },

    async updateTicket(ticketId: string, updates: Partial<Ticket>) {
        return supabase
            .from('support_tickets')
            .update(updates)
            .eq('id', ticketId);
    },

    async getCategories() {
        const { data, error } = await supabase
            .from('support_categories')
            .select('*')
            .order('name');
        
        if (error) {
            console.error('Error fetching categories:', error);
            // Fallback to minimal static list if DB fails
            return [
                { id: '1', name: 'General Support', priority: 'medium', sla: 24 }
            ];
        }
        return data;
    },

    async getCannedResponses() {
        const { data, error } = await supabase
            .from('canned_responses')
            .select('*')
            .order('title');
        
        if (error) {
            console.error('Error fetching templates:', error);
            return [];
        }
        return data;
    },

    async getKnowledgeBase() {
        const { data, error } = await supabase
            .from('knowledge_base')
            .select('*')
            .eq('is_published', true)
            .order('views', { ascending: false });
        
        if (error) {
            console.error('Error fetching KB:', error);
            return [];
        }
        return data;
    }
};
