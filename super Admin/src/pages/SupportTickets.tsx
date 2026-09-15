import React, { useState, useEffect, useMemo } from 'react';
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
                sender_id: (await supabase.auth.getUser()).data.user?.id
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
        return tickets.filter(t => 
            t.ticket_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.client?.station_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.subject.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [tickets, searchTerm]);

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
                     <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                        <FiFilter /> Filter Stream
                    </button>
                    <button onClick={() => setActiveTab('create')} className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-xl text-xs font-black hover:bg-cyan-700 transition-all shadow-md shadow-cyan-600/20">
                        <FiPlus /> Initialize Case
                    </button>
                </div>
            </div>

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
                                        <button className="action-circle view" title="View Audit">
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
                            <textarea 
                                className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold min-h-[120px] outline-none focus:border-cyan-500 transition-all" 
                                placeholder="Enter administrative response or internal diagnostic note..."
                                value={responseBody}
                                onChange={(e) => setResponseBody(e.target.value)}
                            ></textarea>
                            <div className="flex justify-between items-center mt-6">
                                <div className="flex gap-4">
                                    <button className="text-[10px] font-black uppercase text-slate-400 hover:text-cyan-600 transition-colors">Attach Logs</button>
                                    <button className="text-[10px] font-black uppercase text-slate-400 hover:text-cyan-600 transition-colors">Internal Observation</button>
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

                        <div className="bg-rose-50 border border-rose-100 rounded-3xl p-6">
                            <label className="text-[9px] font-black uppercase text-rose-400 block mb-2 tracking-widest text-center">SLA Violation Countdown</label>
                            <div className="text-3xl font-black text-rose-600 text-center tracking-tighter">01:42:15</div>
                            <div className="text-[8px] font-black uppercase text-rose-400 text-center mt-2">BREACH DETECTED - ESCALATING</div>
                        </div>
                    </div>
                </div>
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
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
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
                    {/* Note: Templates, Feedback, Team, KB use similar standardized designs */}
                    {['categories', 'templates', 'feedback', 'team', 'kb'].includes(activeTab) && (
                        <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                            <FiLoader size={48} className="mb-4 animate-spin" />
                            <h3 className="text-sm font-black uppercase tracking-widest">{activeTab} module</h3>
                            <p className="text-[10px] font-bold">Industrial layout initialized. Interface validation pending.</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default SupportTickets;
