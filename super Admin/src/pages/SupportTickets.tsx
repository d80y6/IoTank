import React, { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import { supportService, Ticket, SupportStats, TicketMessage } from '../services/supportService';
import { supabase } from '../config/supabase';
import { 
    FiMessageSquare, FiAlertCircle, FiClock, FiCheckCircle, 
    FiUser, FiSearch, FiFilter, FiPlus, FiSend, 
    FiFileText, FiBarChart2, FiUsers, FiBook, FiMoreVertical,
    FiArrowUpRight, FiMail, FiPhone, FiChevronLeft, FiChevronRight,
    FiZap, FiActivity, FiActivity as FiCompliance, FiDownload, FiLoader, FiExternalLink
} from 'react-icons/fi';
import './SupportTickets.css';

// Internal Pagination Component (Standardized)
const TablePagination = ({ 
    currentPage, 
    totalItems, 
    pageSize, 
    onPageChange 
}: { 
    currentPage: number, 
    totalItems: number, 
    pageSize: number, 
    onPageChange: (p: number) => void 
}) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    return (
        <div className="table-pagination-footer">
            <div className="pagination-info">
                Showing <b>{start}</b> to <b>{end}</b> of <b>{totalItems}</b> cases
            </div>
            <div className="pagination-controls">
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    <FiChevronLeft /> Previous
                </button>
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next <FiChevronRight />
                </button>
            </div>
        </div>
    );
};

const SupportTickets: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'queue' | 'detail' | 'create' | 'categories' | 'templates' | 'feedback' | 'team' | 'kb'>('overview');
    const [stats, setStats] = useState<SupportStats | null>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    
    // Controls
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 8;

    const [messages, setMessages] = useState<any[]>([]);
    const [responseBody, setResponseBody] = useState('');
    const [sendingResponse, setSendingResponse] = useState(false);

    const [showFilters, setShowFilters] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');
    const [priorityFilter, setPriorityFilter] = useState('all');
    const [cannedResponses, setCannedResponses] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [creatingTicket, setCreatingTicket] = useState(false);
    const [createForm, setCreateForm] = useState({ subject: '', description: '', priority: 'medium', category: '' });
    const [kbArticles, setKbArticles] = useState<any[]>([]);
    const [feedbackRows, setFeedbackRows] = useState<any[] | null>(null);
    const [selectedKb, setSelectedKb] = useState<any | null>(null);
    const [attachedLogs, setAttachedLogs] = useState<string[]>([]);
    const [isInternal, setIsInternal] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [statsData, ticketsData] = await Promise.all([
                    supportService.getSupportStats(),
                    supportService.getTickets()
                ]);
                setStats(statsData);
                setTickets(ticketsData.data || []);
            } catch (error) {
                console.error('Error fetching support data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (activeTab === 'templates' && cannedResponses.length === 0) {
            supportService.getCannedResponses().then(setCannedResponses);
        }
        if (activeTab === 'kb' && kbArticles.length === 0) {
            supportService.getKnowledgeBase().then(setKbArticles);
        }
        if (activeTab === 'feedback' && feedbackRows === null) {
            (async () => {
                try {
                    const { data, error } = await supabase
                        .from('unified_events')
                        .select('*')
                        .or('event_type.ilike.%feedback%,event_type.ilike.%csat%')
                        .order('created_at', { ascending: false })
                        .limit(20);
                    if (error || !data || data.length === 0) {
                        setFeedbackRows([]);
                        return;
                    }
                    setFeedbackRows(data.map((e: any) => ({
                        id: e.id,
                        ticket_id: e.metadata?.ticket_no || e.metadata?.ticket_id || e.resource_id || null,
                        rating: e.metadata?.rating ?? null,
                        comment: e.metadata?.comment || e.description,
                        created_at: e.created_at
                    })));
                } catch {
                    setFeedbackRows([]);
                }
            })();
        }
        if ((activeTab === 'create' || activeTab === 'categories') && categories.length === 0) {
            supportService.getCategories().then(setCategories);
        }
    }, [activeTab]);

    const notify = (title: string, message: string, type: 'success' | 'error' | 'info' = 'success') => {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: { title, message, type }
        }));
    };

    const handleAttachLogs = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length) setAttachedLogs(prev => [...prev, ...files.map(f => f.name)]);
        e.target.value = '';
    };

    const insertCannedResponse = (response: any) => {
        setResponseBody(response.content || response.body || '');
        if (selectedTicket) setActiveTab('detail');
        notify('Template Applied', `Canned response "${response.title}" loaded into reply buffer.`);
    };

    const handleExportCSV = () => {
        const headers = ['Ticket #', 'Station', 'Subject', 'Category', 'Priority', 'Status', 'Assignee', 'Created At', 'SLA Deadline'];
        const rows = filteredTickets.map(t => [
            `TCK-${t.ticket_no}`,
            t.client?.station_name || '',
            t.subject,
            t.category,
            t.priority,
            t.status,
            t.assignee?.full_name || 'UNASSIGNED',
            t.created_at,
            t.sla_deadline
        ]);
        const csv = [headers, ...rows]
            .map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `support_export_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify('Export Complete', `Exported ${rows.length} support case records to CSV.`);
    };

    const fetchMessages = async (ticketId: string) => {
        const { data } = await supportService.getTicketMessages(ticketId);
        setMessages(data || []);
    };

    const handleTicketClick = async (ticket: Ticket) => {
        setSelectedTicket(ticket);
        await fetchMessages(ticket.id);
        setActiveTab('detail');
    };

    const handleDispatchResponse = async () => {
        if (!responseBody.trim() || !selectedTicket) return;
        setSendingResponse(true);
        try {
            const { error } = await supportService.addMessage({
                ticket_id: selectedTicket.id,
                content: responseBody,
                sender_id: (await supabase.auth.getUser()).data.user?.id,
                is_internal: isInternal
            });
            if (error) throw error;
            setResponseBody('');
            await fetchMessages(selectedTicket.id);
        } catch (error) {
            console.error('Error sending response:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Transmission Error',
                    message: 'Failed to dispatch administrative response. Verify connectivity and try again.',
                    type: 'error'
                }
            }));
        } finally {
            setSendingResponse(false);
        }
    };

    const filteredTickets = useMemo(() => {
        return tickets.filter(t => {
            const matchesSearch =
                t.ticket_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.client?.station_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.subject.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
            const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
            return matchesSearch && matchesStatus && matchesPriority;
        });
    }, [tickets, searchTerm, statusFilter, priorityFilter]);

    const paginatedTickets = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredTickets.slice(start, start + pageSize);
    }, [filteredTickets, currentPage]);

    const renderOverview = () => (
        <div className="support-overview animate-fade-in">
            <div className="dp-stats-grid">
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob">
                        <FiMessageSquare />
                    </div>
                    <div className="stat-content">
                        <label>Active Cases</label>
                        <h3>{stats?.openTickets}</h3>
                        <div className="stat-trend up">
                            <FiZap size={10} /> Real-time queue
                        </div>
                    </div>
                </div>

                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob urgent">
                        <FiAlertCircle />
                    </div>
                    <div className="stat-content">
                        <label>Critical Pulse</label>
                        <h3 className="text-rose-600">{stats?.urgentTickets}</h3>
                        <div className="stat-trend down font-black">
                            SLA RISK DETECTED
                        </div>
                    </div>
                </div>

                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#f0fdf4', color: '#16a34a' }}>
                        <FiClock />
                    </div>
                    <div className="stat-content">
                        <label>Response Velocity</label>
                        <h3>{stats?.avgResponseTime}</h3>
                        <div className="stat-trend up">
                            Target Met: &lt;1hr
                        </div>
                    </div>
                </div>

                <div className="dp-premium-stat-card highlight-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfeff', color: '#0891b2' }}>
                        <FiCompliance />
                    </div>
                    <div className="stat-content">
                        <label>SLA Adherence</label>
                        <h3>{stats?.slaResponseRate}%</h3>
                        <div className="stat-trend up">
                             Compliance Stable
                        </div>
                    </div>
                </div>
            </div>

            <div className="sla-compliance-row">
                <div className="sla-premium-card">
                    <div className="sla-label-row">
                        <label>Resolution SLA Adherence</label>
                        <span className="sla-value">{stats?.slaResolutionRate}%</span>
                    </div>
                    <div className="sla-bar-container">
                        <div className="sla-fill cyan" style={{ width: `${stats?.slaResolutionRate}%` }}></div>
                    </div>
                    <div className="flex justify-between items-center mt-2 px-1">
                        <span className="text-[9px] font-black uppercase text-slate-400">Target Resolution: 4 Hours</span>
                        <span className="text-[9px] font-black uppercase text-slate-500">{stats?.closedToday} COMPLETED TODAY</span>
                    </div>
                </div>

                <div className="sla-premium-card">
                    <div className="sla-label-row">
                        <label>Initial Response SLA Adherence</label>
                        <span className="sla-value text-amber-600">{stats?.slaResponseRate}%</span>
                    </div>
                    <div className="sla-bar-container">
                        <div className="sla-fill amber" style={{ width: `${stats?.slaResponseRate}%` }}></div>
                    </div>
                    <div className="flex justify-between items-center mt-2 px-1">
                        <span className="text-[9px] font-black uppercase text-slate-400">Target Response: 1 Hour</span>
                        <span className="text-[9px] font-black uppercase text-rose-500">{stats?.overdueTickets} OVERDUE BREACHES</span>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderQueue = () => (
        <div className="support-queue animate-fade-in">
            <div className="table-header-toolbar !bg-transparent !p-0 !mb-6">
                <div className="header-search-box">
                    <FiSearch className="search-icon" />
                    <input 
                        type="text" 
                        placeholder="Search ticket # or station..." 
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    />
                </div>
                
                <div className="dp-header-actions">
                     <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                        <FiFilter /> Filter Stream
                    </button>
                    <button onClick={() => setActiveTab('create')} className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-xl text-xs font-black hover:bg-cyan-700 transition-all shadow-md shadow-cyan-600/20">
                        <FiPlus /> Initialize Case
                    </button>
                </div>
            </div>

            {showFilters && (
                <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Filter Stream</label>
                    <select
                        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 outline-none focus:border-cyan-500 transition-all"
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                    >
                        <option value="all">All Statuses</option>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="waiting">Waiting</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                    </select>
                    <select
                        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 outline-none focus:border-cyan-500 transition-all"
                        value={priorityFilter}
                        onChange={(e) => { setPriorityFilter(e.target.value); setCurrentPage(1); }}
                    >
                        <option value="all">All Priorities</option>
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <span className="text-[10px] font-black text-slate-400 uppercase">{filteredTickets.length} CASES MATCH</span>
                </div>
            )}

            <div className="tdv-transaction-table-container">
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Ticket ID</th>
                            <th>Identity / Station</th>
                            <th>Diagnostic Subject</th>
                            <th>Priority</th>
                            <th>Work Status</th>
                            <th>Assignee</th>
                            <th className="text-right">Command</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedTickets.map((ticket) => (
                            <tr key={ticket.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleTicketClick(ticket)}>
                                <td className="font-mono text-[10px] font-black opacity-50">
                                    TCK-{ticket.ticket_no}
                                </td>
                                <td>
                                    <div className="font-bold">{ticket.client?.station_name}</div>
                                    <div className="text-[10px] opacity-60 uppercase">{ticket.client?.full_name}</div>
                                </td>
                                <td className="max-w-[200px] truncate">
                                    <div className="font-bold text-xs">{ticket.subject}</div>
                                    <div className="text-[9px] opacity-40 uppercase font-black">{ticket.category}</div>
                                </td>
                                <td>
                                    <span className={`badge badge--${ticket.priority.toLowerCase()}`}>
                                        {ticket.priority}
                                    </span>
                                </td>
                                <td>
                                    <span className="status-pill">{ticket.status}</span>
                                </td>
                                <td>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-cyan-100 flex items-center justify-center text-[10px] font-black text-cyan-700 uppercase">
                                            {ticket.assignee?.full_name.charAt(0) || '?'}
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-500 uppercase">{ticket.assignee?.full_name || 'UNASSIGNED'}</span>
                                    </div>
                                </td>
                                <td className="text-right">
                                    <div className="flex justify-end pr-2">
                                        <button className="action-circle view" title="View Audit" onClick={(e) => { e.stopPropagation(); handleTicketClick(ticket); }}>
                                            <FiExternalLink size={16}/>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <TablePagination 
                    currentPage={currentPage}
                    totalItems={filteredTickets.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                />
            </div>
        </div>
    );


    const renderDetail = () => {
        if (!selectedTicket) return null;
        const slaClosed = selectedTicket.status === 'resolved' || selectedTicket.status === 'closed';
        const slaDeadline = selectedTicket.sla_deadline ? new Date(selectedTicket.sla_deadline).getTime() : null;
        const slaBreached = !slaClosed && slaDeadline !== null && slaDeadline <= now;
        const msLeft = slaDeadline !== null ? Math.max(0, slaDeadline - now) : 0;
        const slaH = Math.floor(msLeft / 3600000);
        const slaM = Math.floor((msLeft % 3600000) / 60000);
        const slaS = Math.floor((msLeft % 60000) / 1000);
        const slaPad = (n: number) => String(n).padStart(2, '0');
        return (
            <div className="ticket-detail-view animate-fade-in">
                <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-4">
                        <button className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-50 transition-all" onClick={() => setActiveTab('queue')}>Back to Queue</button>
                        <h2 className="text-2xl font-black lowercase tracking-tighter">Case: {selectedTicket.ticket_no}</h2>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2">
                        <div className="bg-white border border-slate-100 rounded-3xl p-8 mb-8 shadow-sm">
                            <div className="flex justify-between items-start mb-4">
                                <h4 className="font-black text-xl text-slate-800">{selectedTicket.subject}</h4>
                                <span className={`badge badge--${selectedTicket.priority.toLowerCase()}`}>{selectedTicket.priority}</span>
                            </div>
                            <p className="text-slate-600 leading-relaxed text-sm">{selectedTicket.description}</p>
                        </div>

                        <div className="flex flex-col gap-4 mb-8">
                            {messages.map((msg, idx) => (
                                <div key={msg.id || idx} className={`message-bubble ${msg.sender_role === 'client' ? 'client' : 'admin'}`}>
                                    <div className="message-meta">
                                        <span>{msg.sender_name || (msg.sender_role === 'client' ? 'Client' : 'Admin')}</span>
                                        <span>{new Date(msg.created_at).toLocaleString()}</span>
                                    </div>
                                    <div className="message-content">{msg.content}</div>
                                </div>
                            ))}
                            {messages.length === 0 && (
                                <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">No communication history logged.</div>
                            )}
                        </div>

                        <div className="bg-white border border-cyan-100 rounded-3xl p-8 shadow-md shadow-cyan-500/5">
                            {isInternal && (
                                <div className="mb-4 flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-100 rounded-xl text-[9px] font-black uppercase tracking-widest text-amber-600">
                                    <FiAlertCircle size={12} /> Internal Observation Mode — message will be logged as internal-only
                                </div>
                            )}
                            <textarea 
                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold min-h-[120px] outline-none focus:border-cyan-500 transition-all" 
                                placeholder={isInternal ? "Enter internal diagnostic note (client will not see this)..." : "Enter administrative response or internal diagnostic note..."}
                                value={responseBody}
                                onChange={(e) => setResponseBody(e.target.value)}
                            ></textarea>
                            {attachedLogs.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-4">
                                    {attachedLogs.map((name, idx) => (
                                        <span key={idx} className="flex items-center gap-2 px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-black text-slate-600">
                                            <FiFileText size={11} /> {name}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="flex justify-between items-center mt-6">
                                <div className="flex gap-4 items-center">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={handleAttachLogs}
                                    />
                                    <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-black uppercase text-slate-400 hover:text-cyan-600 transition-colors">Attach Logs</button>
                                    <button onClick={() => setIsInternal(!isInternal)} className={`text-[10px] font-black uppercase transition-colors ${isInternal ? 'text-amber-500' : 'text-slate-400 hover:text-cyan-600'}`}>Internal Observation</button>
                                </div>
                                <button 
                                    className="flex items-center gap-2 px-6 py-3 bg-cyan-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-cyan-700 transition-all shadow-lg shadow-cyan-600/20 disabled:opacity-50"
                                    onClick={handleDispatchResponse}
                                    disabled={sendingResponse || !responseBody.trim()}
                                >
                                    {sendingResponse ? <FiLoader className="animate-spin" /> : <FiSend />} 
                                    {sendingResponse ? 'Transmitting...' : 'Dispatch Response'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
                            <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">Client Identity Profile</label>
                            <h3 className="font-black text-lg text-slate-800">{selectedTicket.client?.full_name}</h3>
                            <div className="text-[10px] font-bold text-cyan-600 uppercase tracking-wider mb-6">{selectedTicket.client?.station_name}</div>
                            
                            <div className="space-y-3 pt-4 border-t border-slate-50">
                                <div className="flex items-center gap-3 text-sm text-slate-600 font-bold">
                                    <FiMail className="opacity-40" /> {selectedTicket.client?.email}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600 font-bold">
                                    <FiPhone className="opacity-40" /> {selectedTicket.client?.phone}
                                </div>
                            </div>
                        </div>

                        <div className={`${slaBreached ? 'bg-rose-50 border-rose-100' : slaClosed ? 'bg-emerald-50 border-emerald-100' : slaDeadline === null ? 'bg-slate-50 border-slate-100' : 'bg-cyan-50 border-cyan-100'} border rounded-3xl p-6`}>
                            <label className={`text-[9px] font-black uppercase block mb-2 tracking-widest text-center ${slaBreached ? 'text-rose-400' : slaClosed ? 'text-emerald-500' : slaDeadline === null ? 'text-slate-400' : 'text-cyan-600'}`}>SLA Violation Countdown</label>
                            {slaClosed ? (
                                <>
                                    <div className="text-3xl font-black text-emerald-600 text-center tracking-tighter">COMPLIANT</div>
                                    <div className="text-[8px] font-black uppercase text-emerald-500 text-center mt-2">RESOLVED WITHIN SLA WINDOW</div>
                                </>
                            ) : slaDeadline === null ? (
                                <>
                                    <div className="text-3xl font-black text-slate-400 text-center tracking-tighter">--:--:--</div>
                                    <div className="text-[8px] font-black uppercase text-slate-400 text-center mt-2">NO SLA DEADLINE ASSIGNED</div>
                                </>
                            ) : slaBreached ? (
                                <>
                                    <div className="text-3xl font-black text-rose-600 text-center tracking-tighter">00:00:00</div>
                                    <div className="text-[8px] font-black uppercase text-rose-400 text-center mt-2">BREACH DETECTED - ESCALATING</div>
                                </>
                            ) : (
                                <>
                                    <div className="text-3xl font-black text-rose-600 text-center tracking-tighter">{slaPad(slaH)}:{slaPad(slaM)}:{slaPad(slaS)}</div>
                                    <div className="text-[8px] font-black uppercase text-rose-400 text-center mt-2">REMAINING BEFORE SLA BREACH</div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderTemplates = () => (
        <div className="support-templates animate-fade-in">
            <div className="mb-8">
                <h2 className="text-xl font-black lowercase tracking-tighter text-slate-800">Canned Response Library</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Insert pre-approved responses directly into the active reply buffer</p>
            </div>
            {cannedResponses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-slate-200 rounded-3xl">
                    <FiFileText size={40} className="mb-4 opacity-30" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">No canned responses configured</h3>
                    <p className="text-[10px] font-bold text-slate-400 mt-2">Register templates in the assistance database to unlock instant responses.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {cannedResponses.map((response) => (
                        <div key={response.id} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all">
                            <div className="flex justify-between items-start gap-4 mb-3">
                                <h4 className="font-black text-sm text-slate-800 uppercase tracking-wide">{response.title}</h4>
                                <button
                                    onClick={() => insertCannedResponse(response)}
                                    className="shrink-0 px-3 py-1.5 bg-cyan-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-cyan-700 transition-all shadow-sm shadow-cyan-600/20"
                                >
                                    Insert
                                </button>
                            </div>
                            <p className="text-sm text-slate-600 leading-relaxed">{response.content || response.body}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const renderKnowledgeBase = () => (
        <div className="support-kb animate-fade-in">
            <div className="mb-8">
                <h2 className="text-xl font-black lowercase tracking-tighter text-slate-800">Knowledge Base</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Published operational playbooks & troubleshooting references</p>
            </div>
            {kbArticles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-slate-200 rounded-3xl">
                    <FiBook size={40} className="mb-4 opacity-30" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">No published articles</h3>
                    <p className="text-[10px] font-bold text-slate-400 mt-2">Knowledge base is empty or unpublished content only.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-4 mb-8">
                    {kbArticles.map((article) => (
                        <button
                            key={article.id}
                            onClick={() => setSelectedKb(selectedKb?.id === article.id ? null : article)}
                            className={`text-left bg-white border rounded-3xl p-6 shadow-sm transition-all ${selectedKb?.id === article.id ? 'border-cyan-400 shadow-md shadow-cyan-500/10' : 'border-slate-100 hover:border-cyan-200 hover:shadow-md'}`}
                        >
                            <div className="flex justify-between items-center gap-4">
                                <div className="flex-1">
                                    <h4 className="font-black text-sm text-slate-800 uppercase tracking-wide">{article.title}</h4>
                                    <p className="text-sm text-slate-500 mt-1">{article.summary || article.category || ''}</p>
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-2">
                                    <span className="text-[9px] font-black uppercase text-slate-400">{article.views ?? 0} VIEWS</span>
                                    <span className="flex items-center gap-1 text-[10px] font-black uppercase text-cyan-600">
                                        <FiExternalLink size={12} /> {selectedKb?.id === article.id ? 'Collapse' : 'Read'}
                                    </span>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
            {selectedKb && (
                <div className="bg-white border border-cyan-100 rounded-3xl p-8 shadow-md shadow-cyan-500/5 animate-fade-in">
                    <h3 className="font-black text-lg text-slate-800 uppercase tracking-wide mb-6">{selectedKb.title}</h3>
                    <div className="prose prose-slate max-w-none text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{selectedKb.content || selectedKb.body}</div>
                </div>
            )}
        </div>
    );

    const renderFeedback = () => {
        if (feedbackRows === null) {
            return (
                <div className="flex flex-col items-center justify-center py-40">
                    <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Loading CSAT feedback...</p>
                </div>
            );
        }
        if (feedbackRows.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-slate-200 rounded-3xl">
                    <FiMessageSquare size={40} className="mb-4 opacity-30" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">No feedback submitted yet</h3>
                    <p className="text-[10px] font-bold text-slate-400 mt-2">Customer satisfaction responses will surface here once stations complete surveys.</p>
                </div>
            );
        }
        return (
            <div className="support-feedback animate-fade-in">
                <div className="mb-8">
                    <h2 className="text-xl font-black lowercase tracking-tighter text-slate-800">CSAT Feedback Pulse</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Latest {feedbackRows.length} customer satisfaction submissions</p>
                </div>
                <div className="tdv-transaction-table-container">
                    <table className="tdv-transaction-table">
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Rating</th>
                                <th>Comment</th>
                                <th>Submitted</th>
                            </tr>
                        </thead>
                        <tbody>
                            {feedbackRows.map((row, idx) => (
                                <tr key={row.id || idx}>
                                    <td className="font-mono text-[10px] font-black opacity-60">
                                        {row.ticket_id || row.support_ticket_id || row.ticket_no || '—'}
                                    </td>
                                    <td>
                                        <span className={`badge badge--${Number(row.rating) >= 4 ? 'low' : row.rating ? 'medium' : 'high'}`}>
                                            {row.rating != null ? `${row.rating}/5` : '—'}
                                        </span>
                                    </td>
                                    <td className="max-w-[400px]">{row.comment || row.feedback || row.message || 'No comment'}</td>
                                    <td>{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderTeam = () => {
        const assigneeMap = new Map<string, { name: string; count: number }>();
        tickets.forEach(t => {
            const name = t.assignee?.full_name;
            if (!name) return;
            const entry = assigneeMap.get(name) || { name, count: 0 };
            entry.count++;
            assigneeMap.set(name, entry);
        });
        const rows = Array.from(assigneeMap.values()).sort((a, b) => b.count - a.count);
        return (
            <div className="support-team animate-fade-in">
                <div className="mb-8">
                    <h2 className="text-xl font-black lowercase tracking-tighter text-slate-800">Staff Leaderboard</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Assignee workload derived from the live ticket queue</p>
                </div>
                {rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-slate-200 rounded-3xl">
                        <FiUsers size={40} className="mb-4 opacity-30" />
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">No assignees detected</h3>
                        <p className="text-[10px] font-bold text-slate-400 mt-2">Tickets are currently unassigned or the admin directory is empty.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {rows.map((row) => (
                            <div key={row.name} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-cyan-100 flex items-center justify-center text-lg font-black text-cyan-700 uppercase shrink-0">
                                    {row.name.charAt(0)}
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-black text-sm text-slate-800 uppercase tracking-wide">{row.name}</h4>
                                    <div className="text-[10px] font-bold uppercase text-slate-400 mt-1">Active caseholder</div>
                                </div>
                                <div className="shrink-0 flex flex-col items-end">
                                    <span className="text-2xl font-black text-cyan-600">{row.count}</span>
                                    <span className="text-[9px] font-black uppercase text-slate-400">CASES</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const handleCreateTicket = async () => {
        if (!createForm.subject.trim() || !createForm.description.trim()) return;
        setCreatingTicket(true);
        try {
            const { error } = await supabase
                .from('support_tickets')
                .insert({
                    subject: createForm.subject.trim(),
                    description: createForm.description.trim(),
                    priority: createForm.priority,
                    category: createForm.category || null,
                    ticket_no: `TCK-${Date.now()}`,
                    status: 'open',
                    created_at: new Date().toISOString()
                });
            if (error) throw error;
            notify('Case Initialized', `Ticket "${createForm.subject}" opened in the support queue.`);
            setCreateForm({ subject: '', description: '', priority: 'medium', category: '' });
            const [statsData, ticketsData] = await Promise.all([
                supportService.getSupportStats(),
                supportService.getTickets()
            ]);
            setStats(statsData);
            setTickets(ticketsData.data || []);
            setActiveTab('queue');
        } catch (error) {
            console.error('Error creating ticket:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Creation Failed',
                    message: 'Failed to initialize support case. Verify connectivity and try again.',
                    type: 'error'
                }
            }));
        } finally {
            setCreatingTicket(false);
        }
    };

    const renderCreate = () => (
        <div className="support-create animate-fade-in">
            <div className="mb-8">
                <h2 className="text-xl font-black lowercase tracking-tighter text-slate-800">Initialize Support Case</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Open a diagnostic case routed into the admin queue</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-3xl p-8 shadow-sm max-w-3xl">
                <div className="mb-6">
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-2 tracking-widest">Diagnostic Subject</label>
                    <input
                        type="text"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold outline-none focus:border-cyan-500 transition-all"
                        placeholder="e.g. Site-level telemetry gap on tank 02"
                        value={createForm.subject}
                        onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                    />
                </div>
                <div className="mb-6">
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-2 tracking-widest">Category</label>
                    <select
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-600 outline-none focus:border-cyan-500 transition-all"
                        value={createForm.category}
                        onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                    >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                    </select>
                </div>
                <div className="mb-6">
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-2 tracking-widest">Priority</label>
                    <select
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-600 outline-none focus:border-cyan-500 transition-all"
                        value={createForm.priority}
                        onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value })}
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                    </select>
                </div>
                <div className="mb-8">
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-2 tracking-widest">Description</label>
                    <textarea
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold min-h-[140px] outline-none focus:border-cyan-500 transition-all"
                        placeholder="Describe the diagnostic issue, affected assets, and any reproduction steps..."
                        value={createForm.description}
                        onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    ></textarea>
                </div>
                <div className="flex justify-end gap-4">
                    <button
                        onClick={() => setActiveTab('queue')}
                        className="px-6 py-3 border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreateTicket}
                        disabled={creatingTicket || !createForm.subject.trim() || !createForm.description.trim()}
                        className="flex items-center gap-2 px-6 py-3 bg-cyan-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-cyan-700 transition-all shadow-lg shadow-cyan-600/20 disabled:opacity-50"
                    >
                        {creatingTicket ? <FiLoader className="animate-spin" /> : <FiPlus />}
                        {creatingTicket ? 'Opening Case...' : 'Initialize Case'}
                    </button>
                </div>
            </div>
        </div>
    );

    const renderCategories = () => {
        const activeTickets = tickets.filter(t => t.status !== 'closed' && t.status !== 'resolved').length;
        return (
            <div className="support-categories animate-fade-in">
                <div className="mb-8">
                    <h2 className="text-xl font-black lowercase tracking-tighter text-slate-800">Support Category Registry</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">SLA tiers & routing rules for incoming cases</p>
                </div>
                {categories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-slate-200 rounded-3xl">
                        <FiBook size={40} className="mb-4 opacity-30" />
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">No categories registered</h3>
                        <p className="text-[10px] font-bold text-slate-400 mt-2">Establish categories in the assistance database to unlock routing rules.</p>
                    </div>
                ) : (
                    <div className="tdv-transaction-table-container">
                        <table className="tdv-transaction-table">
                            <thead>
                                <tr>
                                    <th>Category</th>
                                    <th>Default Priority</th>
                                    <th>SLA Window</th>
                                    <th className="text-right">Active Cases</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categories.map((c) => {
                                    const catTickets = tickets.filter(t => (t.category || '').toLowerCase() === (c.name || '').toLowerCase());
                                    return (
                                        <tr key={c.id}>
                                            <td className="font-bold">{c.name}</td>
                                            <td>
                                                <span className={`badge badge--${(c.default_priority || c.priority || 'medium').toLowerCase()}`}>
                                                    {c.default_priority || c.priority || 'medium'}
                                                </span>
                                            </td>
                                            <td className="font-mono text-[10px] font-black opacity-60">{c.sla_hours ?? c.sla ?? 0} HOURS</td>
                                            <td className="text-right font-bold text-cyan-600">{catTickets.length}</td>
                                        </tr>
                                    );
                                })}
                                <tr>
                                    <td className="font-bold opacity-50">Across all categories</td>
                                    <td>—</td>
                                    <td className="font-mono text-[10px] font-black opacity-50 uppercase">Open stream</td>
                                    <td className="text-right font-bold">{activeTickets}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const content = (
        <div className="support-page">
            <header className="dp-header">
                <div className="dp-title-group">
                    <h1 className="lowercase">support & SLA monitor</h1>
                    <div className="dp-subtitle">Strategic Help Desk & Compliance Engine</div>
                </div>
                
                <div className="dp-header-actions">
                    <button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                        <FiDownload /> Performance Export
                    </button>
                </div>
            </header>

            <div className="support-tabs-container">
                {[
                    { id: 'overview', label: 'Overview' },
                    { id: 'queue', label: 'Ticket Queue' },
                    { id: 'templates', label: 'Canned logic' },
                    { id: 'feedback', label: 'CSAT Pulse' },
                    { id: 'team', label: 'Staff Leaderboard' },
                    { id: 'kb', label: 'Knowledge Base' }
                ].map(tab => (
                    <button 
                        key={tab.id}
                        className={`support-tab-btn ${activeTab === tab.id ? 'active' : ''}`} 
                        onClick={() => setActiveTab(tab.id as any)}
                    >
                        {tab.label}
                    </button>
                ))}
                {selectedTicket && (
                    <button className={`support-tab-btn ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>Case Detail</button>
                )}
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40">
                    <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Synchronizing support logic...</p>
                </div>
            ) : (
                <>
                    {activeTab === 'overview' && renderOverview()}
                    {activeTab === 'queue' && renderQueue()}
                    {activeTab === 'detail' && renderDetail()}
                    {activeTab === 'templates' && renderTemplates()}
                    {activeTab === 'feedback' && renderFeedback()}
                    {activeTab === 'team' && renderTeam()}
                    {activeTab === 'kb' && renderKnowledgeBase()}
                    {activeTab === 'create' && renderCreate()}
                    {activeTab === 'categories' && renderCategories()}
                </>
            )}
        </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default SupportTickets;
