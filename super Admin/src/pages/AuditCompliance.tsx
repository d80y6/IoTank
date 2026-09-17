import React, { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import { adminAuditService, AuditEntry, FinancialTrail, ComplianceStatus, SecurityIncident } from '../services/adminAuditService';
import { supabase } from '../config/supabase';
import { 
    FiShield, FiList, FiDollarSign, FiCheckCircle, 
    FiAlertTriangle, FiUser, FiCalendar, FiSearch, 
    FiDownload, FiTarget, FiActivity, FiKey, 
    FiGlobe, FiCpu, FiExternalLink, FiChevronDown, FiChevronUp,
    FiLock, FiUnlock, FiEye, FiBarChart2, FiChevronRight, FiFileText,
    FiFilter, FiZap, FiBox
} from 'react-icons/fi';
import { useVirtualizer } from '@tanstack/react-virtual';
import './AuditCompliance.css';

const AuditCompliance: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const [activeTab, setActiveTab] = useState<'forensics' | 'compliance' | 'security'>('forensics');
    const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
    const [financialTrail, setFinancialTrail] = useState<FinancialTrail[]>([]);
    const [compliance, setCompliance] = useState<ComplianceStatus[]>([]);
    const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
    const [riskMetrics, setRiskMetrics] = useState<any>(null);
    const [expandedLog, setExpandedLog] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('All');
    const [expandedTrail, setExpandedTrail] = useState<string | null>(null);
    const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
    const [blockedIps, setBlockedIps] = useState<string[]>([]);
    const [terminatedSessions, setTerminatedSessions] = useState<string[]>([]);

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeTab]);

    const parentRef = useRef<HTMLDivElement>(null);

    const filteredAuditLogs = useMemo(() => {
        const query = search.trim().toLowerCase();
        return auditLogs.filter(log => {
            if (category !== 'All' && (log.action_category || '').toLowerCase() !== category.toLowerCase()) return false;
            if (!query) return true;
            return (log.description || '').toLowerCase().includes(query)
                || (log.resource_id || '').toLowerCase().includes(query)
                || (log.ip_address || '').toLowerCase().includes(query);
        });
    }, [auditLogs, search, category]);
    
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [auditData, financialData, complianceData, incidentData, metricsData] = await Promise.all([
                    adminAuditService.getAuditLogs(),
                    adminAuditService.getFinancialTrail(),
                    adminAuditService.getComplianceOverview(),
                    adminAuditService.getSecurityIncidents(),
                    adminAuditService.getAdminRiskMetrics()
                ]);
                setAuditLogs(auditData || []);
                setFinancialTrail(financialData || []);
                setCompliance(complianceData || []);
                setIncidents(incidentData || []);
                setRiskMetrics(metricsData);
            } catch (error) {
                console.error('Error fetching audit data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const rowVirtualizer = useVirtualizer({
        count: filteredAuditLogs.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 65,
        overscan: 10,
    });

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'compliant': return 'comp-compliant';
            case 'warning': return 'comp-warning';
            case 'expired': return 'comp-expired';
            default: return '';
        }
    };

    const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
        const escape = (value: string | number) => {
            const str = String(value ?? '');
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        };
        const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

    const exportAuditCsv = () => {
        downloadCsv('audit_logs.csv',
            ['Timestamp', 'User', 'Role', 'Category', 'Action', 'Description', 'Resource ID', 'IP', 'Status'],
            filteredAuditLogs.map(log => [
                log.timestamp, log.user_name, log.user_role, log.action_category, log.action_type,
                log.description, log.resource_id || '', log.ip_address, log.result
            ])
        );
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: { title: 'Audit Logs Exported', message: `${filteredAuditLogs.length} forensic entries written to CSV.`, type: 'success' }
        }));
    };

    const runReconciliation = async () => {
        const { data, error } = await supabase.rpc('reconcile_financial_trails');
        if (error) {
            const credits = financialTrail.filter(t => t.amount > 0).length;
            const debits = financialTrail.filter(t => t.amount < 0).length;
            const delta = financialTrail.reduce((sum, t) => sum + t.amount, 0);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Reconciliation Degraded',
                    message: `Could not reach database ledger — ran a local recount of ${financialTrail.length} loaded records (${credits} credits, ${debits} debits, net ${delta.toLocaleString()}).`,
                    type: 'warning'
                }
            }));
            return;
        }
        const r = data as any;
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Reconciliation Complete',
                message: `Ledger rebalanced — ${r?.records || 0} transactions (${r?.credits || 0} credits, ${r?.debits || 0} debits, ${r?.pending || 0} pending, net ${Number(r?.net || 0).toLocaleString()}).`,
                type: 'success'
            }
        }));
    };

    const recordSecurityEvent = async (eventType: string, description: string, metadata: Record<string, any>, severity = 'WARNING') => {
        const user = (await supabase.auth.getUser()).data.user;
        const { error } = await supabase.from('unified_events').insert({
            event_category: 'SECURITY',
            event_type: eventType,
            severity,
            description,
            actor_email: user?.email || 'super_admin',
            metadata: { ...metadata, actor_name: 'Super Admin', result: 'success' }
        });
        if (error) throw error;
    };

    const notify = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
        window.dispatchEvent(new CustomEvent('system-toast', { detail: { title, message, type } }));
    };

    const handleBlockSource = async (incident: any) => {
        setBlockedIps(prev => prev.includes(incident.source_ip) ? prev : [...prev, incident.source_ip]);
        setIncidents(prev => prev.filter(x => x.id !== incident.id));
        try {
            await recordSecurityEvent(
                'source_blocked',
                `Security source ${incident.source_ip} blocked by super admin`,
                { ip_address: incident.source_ip, resource_id: incident.id },
                'CRITICAL'
            );
        } catch (error) {
            console.error('Error recording source block:', error);
        }
        notify('Source Blocked', `${incident.source_ip} added to the source blocklist.`, 'success');
    };

    const handleDismissIncident = async (incident: any) => {
        setIncidents(prev => prev.filter(x => x.id !== incident.id));
        try {
            await recordSecurityEvent(
                'incident_dismissed',
                `Security incident ${incident.id.slice(0, 8)} dismissed`,
                { ip_address: incident.source_ip, resource_id: incident.id },
                'INFO'
            );
        } catch (error) {
            console.error('Error recording dismissal:', error);
        }
        notify('Incident Dismissed', `Alert from ${incident.source_ip} removed from the active view.`, 'info');
    };

    const handleTerminateSession = async (session: AuditEntry) => {
        setTerminatedSessions(prev => prev.includes(session.id) ? prev : [...prev, session.id]);
        try {
            await recordSecurityEvent(
                'admin_session_terminated',
                `Administrative session for ${session.user_name} terminated`,
                { ip_address: session.ip_address, resource_id: session.id },
                'WARNING'
            );
        } catch (error) {
            console.error('Error recording session termination:', error);
        }
        notify('Session Terminated', `Active session for ${session.user_name} terminated.`, 'success');
    };

    const relativeTime = (ts: string) => {
        const diff = Date.now() - new Date(ts).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    };

    const sensitiveAccessLogs = useMemo(() => auditLogs
        .filter(log => /access|export|read|view|permission|bulk/i.test(`${log.action_type} ${log.description}`))
        .slice(0, 5), [auditLogs]);

    const adminSessions = useMemo(() => auditLogs
        .filter(log => /login|session|sign/i.test(`${log.action_type} ${log.description}`) || log.action_category === 'Security')
        .filter(log => !terminatedSessions.includes(log.id))
        .slice(0, 5), [auditLogs, terminatedSessions]);

    const complianceStats = useMemo(() => {
        const compliant = compliance.filter(c => c.status === 'compliant').length;
        const warning = compliance.filter(c => c.status === 'warning').length;
        const expired = compliance.filter(c => c.status === 'expired').length;
        return [
            { label: 'Total Records', total: compliance.length, active: compliance.length, icon: <FiShield />, color: '#06b6d4' },
            { label: 'Compliant', total: compliance.length, active: compliant, icon: <FiCheckCircle />, color: '#10b981' },
            { label: 'Warnings', total: compliance.length, active: warning, icon: <FiAlertTriangle />, color: '#f59e0b' },
            { label: 'Expired', total: compliance.length, active: expired, icon: <FiActivity />, color: '#ef4444' }
        ];
    }, [compliance]);

    const exportPerformanceReport = () => {
        const byUser = new Map<string, AuditEntry[]>();
        auditLogs.forEach(log => {
            const key = log.user_email || log.user_name || 'SYSTEM';
            if (!byUser.has(key)) byUser.set(key, []);
            byUser.get(key)!.push(log);
        });

        const matrix = Array.from(byUser.entries()).map(([email, logs]) => {
            const high_risk_actions = logs.filter(l => /password|role|permission|export|delete|suspend|reset|command/i.test(l.action_type || '')).length;
            const security_alerts = logs.filter(l => l.action_category === 'Security' && l.result === 'failed').length;
            return {
                actor_email: email,
                high_risk_actions,
                security_alerts,
                risk_score: Math.min(100, high_risk_actions * 20 + security_alerts * 25)
            };
        });

        const rows: (string | number)[][] = matrix.map((row: any) => [
            (row.actor_email || '').substring(0, 8),
            row.actor_email || '',
            row.high_risk_actions,
            row.security_alerts,
            row.risk_score,
            row.risk_score > 50 ? 'CRITICAL_RISK' : 'NOMINAL_STATE'
        ]);
        if (rows.length === 0) {
            rows.push(['SYSTEM_WIDE', '', riskMetrics?.highRiskActions || 0, riskMetrics?.suspiciousLogins || 0, '', '']);
        }
        downloadCsv('performance_report.csv',
            ['Administrative Entity', 'Email Address', 'High Risk Actions', 'Security Alerts', 'Aggregate Score', 'Accountability Status'],
            rows
        );
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: { title: 'Performance Report Exported', message: `${rows.length} risk matrix entries written to CSV.`, type: 'success' }
        }));
    };

    const renderAuditLog = () => (
        <div className="audit-log-section animate-fade-in">
            <div className="flex flex-wrap gap-4 mb-8">
                <div className="relative flex-1">
                    <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
                    <input type="text" placeholder="Search by description, resource ID, or IP..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-12 pr-4 text-sm font-bold outline-none" />
                </div>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-600 outline-none">
                    <option value="All">Category: All</option>
                    <option>System</option>
                    <option>Financial</option>
                    <option>Security</option>
                </select>
                <div className="flex gap-2">
                    <button onClick={exportAuditCsv} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                        <FiDownload /> Export CSV
                    </button>
                </div>
            </div>

            <div className="tdv-transaction-table-container">
                <div 
                    ref={parentRef}
                    className="custom-scrollbar"
                    style={{ height: '600px', overflow: 'auto' }}
                >
                    <table className="forensic-table">
                        <thead>
                            <tr style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
                                <th>Timestamp</th>
                                <th>Identity & Role</th>
                                <th>Category</th>
                                <th>Action & Description</th>
                                <th>IP Origin</th>
                                <th>Status</th>
                                <th className="text-right">Audit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={7} className="p-20 text-center opacity-40">Loading Forensic Logs...</td></tr>
                            ) : filteredAuditLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-20 text-center opacity-40">
                                        <FiList className="mx-auto mb-4" size={32} />
                                        <p className="text-xs font-bold uppercase tracking-widest">No forensic events found</p>
                                    </td>
                                </tr>
                            ) : (
                                <>
                                    {rowVirtualizer.getVirtualItems().length > 0 && (
                                        <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }} />
                                    )}
                                    {rowVirtualizer.getVirtualItems().map(virtualRow => {
                                        const log = filteredAuditLogs[virtualRow.index];
                                        const isExpanded = expandedLog === log.id;
                                        return (
                                            <React.Fragment key={log.id}>
                                                <tr 
                                                    className={`cursor-pointer group ${isExpanded ? 'bg-slate-50' : ''}`} 
                                                    onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                                                    style={{ height: `${virtualRow.size}px` }}
                                                >
                                                    <td className="font-mono text-[10px] opacity-50">{new Date(log.timestamp).toLocaleString([], { hour12: false })}</td>
                                                    <td>
                                                        <div className="font-bold text-sm">{log.user_name}</div>
                                                        <div className="text-[9px] opacity-40 font-black uppercase">{log.user_role}</div>
                                                    </td>
                                                    <td>
                                                        <span className="text-[9px] font-black uppercase text-purple-600 px-2 py-1 bg-purple-50 rounded-lg">{log.action_category}</span>
                                                    </td>
                                                    <td className="max-w-[300px] truncate">
                                                        <div className="font-bold text-xs">{log.action_type}</div>
                                                        <div className="text-[10px] opacity-50 mt-1">{log.description}</div>
                                                    </td>
                                                    <td className="font-mono text-[10px] opacity-40">{log.ip_address}</td>
                                                    <td>
                                                        <div className={`flex items-center gap-1 text-[10px] font-black uppercase ${log.result === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {log.result === 'success' ? <FiCheckCircle /> : <FiAlertTriangle />} {log.result}
                                                        </div>
                                                    </td>
                                                    <td className="text-right">
                                                        <button className="action-circle view">{isExpanded ? <FiChevronUp /> : <FiChevronDown />}</button>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="detail-row">
                                                        <td colSpan={7} className="p-0">
                                                            <div className="detail-expansion-panel animate-fade-in">
                                                                <div className="grid grid-cols-2 gap-8">
                                                                    <div>
                                                                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">Metadata</label>
                                                                        <div className="space-y-2">
                                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Resource:</span> <span className="font-mono font-bold">{log.resource_id || 'N/A'}</span></div>
                                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Agent:</span> <span className="opacity-60 truncate max-w-[250px]">{log.user_agent}</span></div>
                                                                        </div>
                                                                    </div>
                                                                    {log.changes && (
                                                                        <div>
                                                                            <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">State Delta</label>
                                                                            <div className="json-diff-container">
                                                                                {Object.keys(log.changes.after).map(key => (
                                                                                    <div key={key} className="diff-field">
                                                                                        <span className="opacity-40">{key}:</span>
                                                                                        <div className="flex gap-2">
                                                                                            <span className="diff-before">{JSON.stringify(log.changes?.before[key])}</span>
                                                                                            <FiChevronRight className="opacity-20" />
                                                                                            <span className="diff-after">{JSON.stringify(log.changes?.after[key])}</span>
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                    {rowVirtualizer.getVirtualItems().length > 0 && (
                                        <tr style={{ height: `${rowVirtualizer.getTotalSize() - rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1].end}px` }} />
                                    )}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderFinancialAudit = () => (
        <div className="financial-audit animate-fade-in">
            <div className="incident-card mb-8 flex justify-between items-center border-emerald-500/20 bg-emerald-50/50">
                <div className="flex items-center gap-6">
                    <FiLock className="text-2xl text-emerald-600" />
                    <div>
                        <h3 className="text-lg font-black lowercase tracking-tighter">Immutable Integrity Ledger</h3>
                        <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">Financial records cannot be deleted or modified post-settlement</p>
                    </div>
                </div>
                <button onClick={runReconciliation} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20">
                    Run Reconciliation
                </button>
            </div>

            <div className="tdv-transaction-table-container">
                <table className="forensic-table">
                    <thead>
                        <tr>
                            <th>Record ID</th>
                            <th>Timestamp</th>
                            <th>Classification</th>
                            <th>Entity / Station</th>
                            <th className="text-right">Delta Shift</th>
                            <th className="text-right">Balance</th>
                            <th>Operator</th>
                            <th className="text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {financialTrail.map(trail => (
                            <React.Fragment key={trail.id}>
                                <tr className="cursor-pointer" onClick={() => setExpandedTrail(expandedTrail === trail.id ? null : trail.id)}>
                                    <td className="font-mono text-[10px] font-black opacity-30">#{trail.id.slice(0,8)}</td>
                                    <td className="font-mono text-[10px] opacity-60">{trail.timestamp}</td>
                                    <td><span className="text-[9px] font-black uppercase text-emerald-600 px-2 py-1 bg-emerald-50 rounded-lg">{trail.type}</span></td>
                                    <td>
                                        <div className="font-bold text-sm">{trail.client_name}</div>
                                        <div className="text-[10px] opacity-40 font-black truncate">REF: {trail.reference}</div>
                                    </td>
                                    <td className="text-right font-mono font-black text-sm">
                                        <span className={trail.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                            {trail.amount > 0 ? '+' : ''}{trail.amount.toLocaleString()}
                                        </span>
                                    </td>
                                    <td className="text-right font-mono font-black text-sm">{trail.new_balance.toLocaleString()}</td>
                                    <td className="text-[10px] font-bold text-slate-500 uppercase">{trail.initiated_by}</td>
                                    <td className="text-right">
                                        <button className="action-circle view" onClick={() => setExpandedTrail(expandedTrail === trail.id ? null : trail.id)}>
                                            {expandedTrail === trail.id ? <FiChevronUp /> : <FiFileText size={16}/>}
                                        </button>
                                    </td>
                                </tr>
                                {expandedTrail === trail.id && (
                                    <tr className="detail-row">
                                        <td colSpan={8} className="p-0">
                                            <div className="detail-expansion-panel animate-fade-in">
                                                <div className="grid grid-cols-2 gap-8">
                                                    <div>
                                                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">Ledger Record</label>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Record ID:</span> <span className="font-mono font-bold">{trail.id}</span></div>
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Reference:</span> <span className="font-mono font-bold">{trail.reference}</span></div>
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Previous Balance:</span> <span className="font-mono font-bold">{trail.prev_balance.toLocaleString()}</span></div>
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Status:</span> <span className="font-mono font-bold">{trail.status}</span></div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">Settlement Trace</label>
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Initiated By:</span> <span className="font-mono font-bold">{trail.initiated_by}</span></div>
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Timestamp:</span> <span className="font-mono font-bold">{trail.timestamp}</span></div>
                                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Delta Shift:</span> <span className={`font-mono font-bold ${trail.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{trail.amount > 0 ? '+' : ''}{trail.amount.toLocaleString()}</span></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderCompliance = () => (
        <div className="compliance-section animate-fade-in">
              <div className="dp-stats-grid">
                {complianceStats.map(cat => (
                    <div key={cat.label} className="dp-premium-stat-card">
                        <div className="stat-icon-blob" style={{ background: `${cat.color}10`, color: cat.color }}>
                            {cat.icon}
                        </div>
                        <div className="stat-content">
                            <label>{cat.label}</label>
                            <h3>{cat.active} <span className="text-xs opacity-20">/ {cat.total}</span></h3>
                            <div className="risk-meter"><div className="risk-level" style={{ width: `${(cat.active/cat.total)*100}%`, background: cat.color }} /></div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mb-6 mt-12">
                <h4 className="font-black lowercase tracking-tighter text-2xl">Regulatory compliance monitor</h4>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {compliance.map(comp => (
                    <div key={comp.id} className="report-template-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-6">
                                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-2xl text-slate-400 group-hover:text-emerald-600 transition-all">
                                    {['Regulatory', 'Licensing', 'License'].some(k => (comp.category || '').includes(k)) ? <FiActivity /> : ['Tax', 'Financial'].some(k => (comp.category || '').includes(k)) ? <FiDollarSign /> : <FiGlobe />}
                                </div>
                                <div>
                                    <h5 className="font-black text-lg text-slate-800 tracking-tight">{comp.name}</h5>
                                    <div className="text-[10px] font-bold opacity-40 uppercase mb-3">Audit Log: {comp.last_audit} • Category: {comp.category}</div>
                                    <span className={`comp-badge ${getStatusColor(comp.status)}`}>{comp.status}</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[9px] font-black uppercase text-slate-300 mb-1">Expiry Trace</div>
                                <div className="font-mono font-black text-sm text-slate-600">{comp.expiry_date}</div>
                                <button
                                    className="text-emerald-600 mt-4 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 float-right hover:gap-4 transition-all"
                                    onClick={() => setExpandedDoc(expandedDoc === comp.id ? null : comp.id)}
                                >
                                    {expandedDoc === comp.id ? 'Hide Docs' : 'View Docs'} {expandedDoc === comp.id ? <FiChevronDown /> : <FiChevronRight />}
                                </button>
                            </div>
                        </div>
                        {expandedDoc === comp.id && (
                            <div className="detail-expansion-panel animate-fade-in mt-4 w-full">
                                <div className="grid grid-cols-2 gap-8">
                                    <div>
                                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">Compliance Record</label>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Document:</span> <span className="font-mono font-bold">{comp.name}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Category:</span> <span className="font-mono font-bold">{comp.category}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Registry ID:</span> <span className="font-mono font-bold">{comp.id}</span></div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-4 tracking-widest">Validity Trace</label>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Status:</span> <span className={`font-mono font-bold ${getStatusColor(comp.status)}`}>{comp.status}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Expiry Date:</span> <span className="font-mono font-bold">{comp.expiry_date || 'N/A'}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="opacity-40 uppercase">Last Audited:</span> <span className="font-mono font-bold">{comp.last_audit}</span></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );

    const renderSecurityAudit = () => (
        <div className="security-audit-section animate-fade-in">
            {incidents.filter(i => i.severity === 'high').map(i => (
                <div key={i.id} className="incident-card critical">
                    <div className="flex items-center justify-between">
                         <div className="flex items-center gap-6">
                            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-2xl">
                                <FiAlertTriangle />
                            </div>
                            <div>
                                <h3 className="text-xl font-black lowercase tracking-tighter">unauthorized access attempt flagged</h3>
                                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest text-rose-600">Threat detected at {i.timestamp} from {i.source_ip}</p>
                            </div>
                         </div>
                         <div className="flex gap-3">
                             <button className="px-6 py-3 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20" onClick={() => handleBlockSource(i)}>Block Source</button>
                             <button className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all" onClick={() => handleDismissIncident(i)}>Dismiss</button>
                         </div>
                    </div>
                </div>
            ))}

            {blockedIps.length > 0 && (
                <div className="incident-card mb-8">
                    <div className="flex items-center justify-between w-full">
                        <h4 className="font-black lowercase tracking-tighter">Local source blocklist</h4>
                        <span className="text-[10px] font-black uppercase text-rose-600">{blockedIps.length} blocked</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                        {blockedIps.map(ip => (
                            <span key={ip} className="font-mono text-[10px] font-black px-2 py-1 bg-rose-50 text-rose-600 rounded-lg">{ip}</span>
                        ))}
                    </div>
                </div>
            )}

            <div className="security-grid">
                 <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Sensitive Data Access log</h4></div>
                    <div className="space-y-4">
                        {sensitiveAccessLogs.map((log) => (
                            <div key={log.id} className="flex justify-between items-center p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                 <div className="flex items-center gap-4">
                                     <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-[10px] font-black text-purple-700">{(log.user_name || 'S').charAt(0)}</div>
                                     <div>
                                         <div className="text-xs font-black text-slate-700">{log.description}</div>
                                         <div className="text-[9px] opacity-40 font-black uppercase">{log.user_name} • {relativeTime(log.timestamp)}</div>
                                     </div>
                                 </div>
                                 <span className={`text-[9px] font-black uppercase ${log.result === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>{log.result}</span>
                            </div>
                        ))}
                        {sensitiveAccessLogs.length === 0 && (
                            <div className="p-8 text-center text-[10px] font-black uppercase tracking-widest opacity-30">No sensitive access events logged.</div>
                        )}
                    </div>
                 </div>

                 <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Administrative Session Monitor</h4></div>
                    <div className="space-y-4">
                        {adminSessions.map((session) => (
                             <div key={session.id} className="flex justify-between items-center p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                  <div className="flex items-center gap-4">
                                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 text-xl"><FiUnlock /></div>
                                      <div>
                                          <div className="font-black text-xs text-slate-700">{session.user_name}</div>
                                          <div className="text-[10px] opacity-30 font-mono tracking-tighter">{session.ip_address} • {session.user_role} • {relativeTime(session.timestamp)}</div>
                                      </div>
                                  </div>
                                  <button onClick={() => handleTerminateSession(session)} className="text-rose-600 text-[9px] font-black uppercase tracking-widest px-4 py-2 hover:bg-rose-50 rounded-lg transition-all">Terminate</button>
                             </div>
                        ))}
                        {adminSessions.length === 0 && (
                            <div className="p-8 text-center text-[10px] font-black uppercase tracking-widest opacity-30">No active administrative sessions.</div>
                        )}
                    </div>
                 </div>
            </div>
        </div>
    );

    const renderAccountability = () => {
        const riskScore = (riskMetrics?.highRiskActions || 0) + (riskMetrics?.suspiciousLogins || 0);
        const riskLevel = riskScore > 20 ? 'HIGH' : riskScore > 5 ? 'MODERATE' : 'LOW';
        const riskWidth = riskScore > 0 ? Math.min(100, riskScore * 4) : 5;
        const reportingAccuracy = auditLogs.length
            ? Math.round((auditLogs.filter(l => l.result === 'success').length / auditLogs.length) * 1000) / 10
            : null;
        return (
        <div className="accountability-section animate-fade-in">
             <div className="dp-stats-grid">
                 <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob"><FiBarChart2 /></div>
                    <div className="stat-content">
                        <label>Critical Adjustments</label>
                        <h3>{riskMetrics?.highRiskActions || 0}</h3>
                        <div className="stat-trend">Manual balance shifts</div>
                    </div>
                 </div>
                 <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#fffbeb', color: '#f59e0b' }}><FiAlertTriangle /></div>
                    <div className="stat-content">
                        <label>System Risk Index</label>
                        <h3 className="text-amber-600">{riskLevel}</h3>
                        <div className="risk-meter"><div className="risk-level" style={{ width: `${riskWidth}%` }} /></div>
                    </div>
                 </div>
                 <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfdf5', color: '#10b981' }}><FiTarget /></div>
                    <div className="stat-content">
                        <label>Reporting Accuracy</label>
                        <h3>{reportingAccuracy === null ? '—' : `${reportingAccuracy}%`}</h3>
                        <div className="stat-trend up">Derived from forensic logs</div>
                    </div>
                 </div>
             </div>

             <div className="tdv-transaction-table-container mt-12">
                <div className="table-header-toolbar">
                    <div className="text-sm font-black text-slate-800">Administrative Behavioral Risk Matrix</div>
                    <button onClick={exportPerformanceReport} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 hover:bg-slate-200 transition-all">
                        <FiDownload /> Performance Report
                    </button>
                </div>
                <table className="forensic-table">
                    <thead>
                        <tr>
                            <th>Administrative Entity</th>
                            <th>Email Address</th>
                            <th className="text-right">High Risk Actions</th>
                            <th className="text-right">Security Alerts</th>
                            <th className="text-right">Aggregate Score</th>
                            <th>Accountability Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {riskMetrics?.matrix?.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-20 text-center opacity-40">
                                    <FiUser className="mx-auto mb-4" size={32} />
                                    <p className="text-xs font-bold uppercase tracking-widest">No administrative entities mapped for behavioral scoring</p>
                                </td>
                            </tr>
                        ) : (
                            riskMetrics?.matrix?.map((row: any) => (
                                <tr key={row.actor_uid}>
                                    <td>
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-black uppercase">{row.actor_email?.charAt(0)}</div>
                                            <div className="font-bold text-sm">ADMIN_NODE_{row.actor_uid.substring(0, 8)}</div>
                                        </div>
                                    </td>
                                    <td className="font-mono text-[10px] opacity-40">{row.actor_email}</td>
                                    <td className="text-right font-mono font-bold text-rose-600">{row.high_risk_actions}</td>
                                    <td className="text-right font-mono font-bold text-amber-600">{row.security_alerts}</td>
                                    <td className="text-right font-mono font-black text-slate-800">{row.risk_score.toFixed(1)}</td>
                                    <td>
                                        <div className={`status-pill ${row.risk_score > 50 ? 'offline' : 'online'}`}>
                                            {row.risk_score > 50 ? 'CRITICAL_RISK' : 'NOMINAL_STATE'}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>

             </div>
        </div>
        );
    };

    const content = (
        <div className="audit-page">
                <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">audit & compliance</h1>
                        <div className="dp-subtitle">Strategic Accountability & Regulatory Transparency Terminal</div>
                    </div>
                    
                    <div className="dp-header-actions">
                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-amber-500 rounded-xl border border-amber-500/20">
                            <FiShield />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Forensic Engine: Secure</span>
                        </div>
                    </div>
                </header>

                <div className="hw-tabs mb-8">
                    {[
                        { id: 'forensics', label: 'Operational Forensics' },
                        { id: 'compliance', label: 'Compliance Monitor' },
                        { id: 'security', label: 'Security & Accountability' }
                    ].map(tab => (
                        <button 
                            key={tab.id}
                            className={`hw-tab-btn ${activeTab === tab.id ? 'active' : ''}`} 
                            onClick={() => setActiveTab(tab.id as any)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-40">
                        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Synchronizing Forensic Archives...</p>
                    </div>
                ) : (
                    <>
                        {activeTab === 'forensics' && (
                            <div className="space-y-12">
                                {renderAuditLog()}
                                <div className="forensic-divider" />
                                {renderFinancialAudit()}
                            </div>
                        )}
                        {activeTab === 'compliance' && renderCompliance()}
                        {activeTab === 'security' && (
                            <div className="space-y-12">
                                {renderSecurityAudit()}
                                <div className="forensic-divider" />
                                {renderAccountability()}
                            </div>
                        )}
                    </>
                )}
            </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default AuditCompliance;
