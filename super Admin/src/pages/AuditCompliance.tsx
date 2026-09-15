import React, { useState, useEffect, useMemo, useRef } from 'react';
import Layout from '../components/Layout';
import { adminAuditService, AuditEntry, FinancialTrail, ComplianceStatus, SecurityIncident } from '../services/adminAuditService';
import { 
    FiShield, FiList, FiDollarSign, FiCheckCircle, 
    FiAlertTriangle, FiUser, FiCalendar, FiSearch, 
    FiDownload, FiTarget, FiActivity, FiKey, 
    FiGlobe, FiCpu, FiExternalLink, FiChevronDown, FiChevronUp,
    FiLock, FiUnlock, FiEye, FiBarChart2, FiChevronRight, FiFileText, FiPlus,
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

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [activeTab]);

    const parentRef = useRef<HTMLDivElement>(null);
    
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
        count: auditLogs.length,
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

    const renderAuditLog = () => (
        <div className="audit-log-section animate-fade-in">
            <div className="flex flex-wrap gap-4 mb-8">
                <div className="relative flex-1">
                    <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" />
                    <input type="text" placeholder="Search by description, resource ID, or IP..." className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-12 pr-4 text-sm font-bold outline-none" />
                </div>
                <select className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-600 outline-none">
                    <option>Category: All</option>
                    <option>System</option>
                    <option>Financial</option>
                    <option>Security</option>
                </select>
                <div className="flex gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
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
                            ) : auditLogs.length === 0 ? (
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
                                        const log = auditLogs[virtualRow.index];
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
                <button className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20">
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
                            <tr key={trail.id}>
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
                                    <button className="action-circle view"><FiFileText size={16}/></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderCompliance = () => (
        <div className="compliance-section animate-fade-in">
              <div className="dp-stats-grid">
                {[
                    { label: 'EPRA Licenses', total: 42, active: 38, icon: <FiActivity />, color: '#8b5cf6' },
                    { label: 'KRA Tax P10', total: 12, active: 12, icon: <FiDollarSign />, color: '#10b981' },
                    { label: 'NEMA Permits', total: 42, active: 30, icon: <FiGlobe />, color: '#f59e0b' },
                    { label: 'Data Registry', total: 1, active: 1, icon: <FiShield />, color: '#06b6d4' }
                ].map(cat => (
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

            <div className="flex justify-between items-center mb-6 mt-12">
                <h4 className="font-black lowercase tracking-tighter text-2xl">Regulatory compliance monitor</h4>
                <div className="flex gap-4">
                     <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                        <FiDownload /> Register Portability
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20">
                        <FiPlus /> Initialize Permit
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {compliance.map(comp => (
                    <div key={comp.id} className="report-template-card">
                        <div className="flex items-center gap-6">
                            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-2xl text-slate-400 group-hover:text-emerald-600 transition-all">
                                {comp.category === 'EPRA' ? <FiActivity /> : comp.category === 'KRA' ? <FiDollarSign /> : <FiGlobe />}
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
                             <button className="text-emerald-600 mt-4 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 float-right hover:gap-4 transition-all">
                                 View Docs <FiChevronRight />
                             </button>
                        </div>
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
                             <button className="px-6 py-3 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20">Block Source</button>
                             <button className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all">Dismiss</button>
                         </div>
                    </div>
                </div>
            ))}

            <div className="security-grid">
                 <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Sensitive Data Access log</h4></div>
                    <div className="space-y-4">
                        {[
                            { user: 'Joseph O.', resource: 'Bulk Client Export', time: '10m ago', status: 'verified' },
                            { user: 'Sarah L.', resource: 'Financial Ledger Access', time: '1h ago', status: 'verified' },
                            { user: 'Security System', resource: 'Admin Permissions Edit', time: '2h ago', status: 'flagged' }
                        ].map((log, i) => (
                            <div key={i} className="flex justify-between items-center p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                 <div className="flex items-center gap-4">
                                     <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-[10px] font-black text-purple-700">{log.user.charAt(0)}</div>
                                     <div>
                                         <div className="text-xs font-black text-slate-700">{log.resource}</div>
                                         <div className="text-[9px] opacity-40 font-black uppercase">{log.user}</div>
                                     </div>
                                 </div>
                                 <span className={`text-[9px] font-black uppercase ${log.status === 'verified' ? 'text-emerald-600' : 'text-rose-600'}`}>{log.status}</span>
                            </div>
                        ))}
                    </div>
                 </div>

                 <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Administrative Session Monitor</h4></div>
                    <div className="space-y-4">
                        {[
                            { user: 'Joseph O.', ip: '192.168.1.42', location: 'Nairobi, KE' },
                            { user: 'Admin Bot', ip: '10.0.0.12', location: 'Internal' }
                        ].map((s, i) => (
                             <div key={i} className="flex justify-between items-center p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                  <div className="flex items-center gap-4">
                                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 text-xl"><FiUnlock /></div>
                                      <div>
                                          <div className="font-black text-xs text-slate-700">{s.user}</div>
                                          <div className="text-[10px] opacity-30 font-mono tracking-tighter">{s.ip} • {s.location}</div>
                                      </div>
                                  </div>
                                  <button className="text-rose-600 text-[9px] font-black uppercase tracking-widest px-4 py-2 hover:bg-rose-50 rounded-lg transition-all">Terminate</button>
                             </div>
                        ))}
                    </div>
                 </div>
            </div>
        </div>
    );

    const renderAccountability = () => (
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
                        <h3 className="text-amber-600">MODERATE</h3>
                        <div className="risk-meter"><div className="risk-level" style={{ width: '65%' }} /></div>
                    </div>
                 </div>
                 <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfdf5', color: '#10b981' }}><FiTarget /></div>
                    <div className="stat-content">
                        <label>Reporting Accuracy</label>
                        <h3>98.2%</h3>
                        <div className="stat-trend up">Certified accuracy</div>
                    </div>
                 </div>
             </div>

             <div className="tdv-transaction-table-container mt-12">
                <div className="table-header-toolbar">
                    <div className="text-sm font-black text-slate-800">Administrative Behavioral Risk Matrix</div>
                    <button className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 hover:bg-slate-200 transition-all">
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
