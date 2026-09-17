import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { analyticsService, BusinessKPIs, UsageStats, ScheduledReport } from '../services/analyticsService';
import { 
    FiBarChart2, FiPieChart, FiTrendingUp, FiTrendingDown, 
    FiActivity, FiFileText, FiCalendar, FiUsers, 
    FiMap, FiTarget, FiZap, FiDownload, FiPlus,
    FiFilter, FiMail, FiClock, FiCheckCircle, FiChevronRight,
    FiBox, FiCpu, FiShield, FiExternalLink, FiAlertCircle, FiRefreshCw
} from 'react-icons/fi';
import { formatMoney } from '@shared/lib/jurisdiction';
import { supabase } from '../config/supabase';
import './AnalyticsReports.css';

const AnalyticsReports: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'intelligence' | 'reporting' | 'system'>('intelligence');
    const [kpis, setKpis] = useState<BusinessKPIs | null>(null);
    const [usage, setUsage] = useState<UsageStats | null>(null);
    const [scheduled, setScheduled] = useState<ScheduledReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [growthStats, setGrowthStats] = useState<number[]>(new Array(12).fill(0));
    const [reportTemplate, setReportTemplate] = useState('Monthly Revenue Report');
    const [showProtocolForm, setShowProtocolForm] = useState(false);
    const [protocolName, setProtocolName] = useState('');
    const [protocolFrequency, setProtocolFrequency] = useState('weekly');
    const [localProtocols, setLocalProtocols] = useState<ScheduledReport[]>([]);
const [tankStats, setTankStats] = useState<any[]>([]);
const [aiRecs, setAiRecs] = useState<any[]>([]);
const [supplierName, setSupplierName] = useState('');
const [supplierResult, setSupplierResult] = useState<string>('');
const [supplierLoading, setSupplierLoading] = useState(false);

    const notify = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
        window.dispatchEvent(new CustomEvent('system-toast', { detail: { title, message, type } }));
    };

    const downloadCSV = (filename: string, headers: string[], rows: Record<string, unknown>[]) => {
        const escape = (value: unknown) => {
            const s = String(value === null || value === undefined ? '' : value);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [headers.join(','), ...rows.map(row => headers.map(h => escape(row[h])).join(','))].join('\n');
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

    const handleAddProtocol = () => {
        if (!protocolName.trim()) {
            notify('Protocol Name Required', 'Provide a name for the automated protocol.', 'warning');
            return;
        }
        setLocalProtocols(prev => [...prev, {
            id: `protocol-${Date.now()}`,
            type: protocolName.trim(),
            frequency: protocolFrequency as ScheduledReport['frequency'],
            last_run: 'Not yet run',
            recipients: ['Primary'],
            status: 'active'
        }]);
        setProtocolName('');
        setProtocolFrequency('weekly');
        setShowProtocolForm(false);
        notify('Protocol Registered', `Automated protocol "${protocolName.trim()}" is now active.`, 'success');
    };

    const handleGenerateReport = () => {
        const slug = reportTemplate.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        downloadCSV(`report-${slug}-${new Date().toISOString().slice(0, 10)}.csv`,
            ['metric', 'value'],
            [
                { metric: 'MRR Growth %', value: kpis?.mrrGrowth ?? 0 },
                { metric: 'Annual Run Rate', value: kpis?.arr ?? 0 },
                { metric: 'Churn Rate %', value: kpis?.churnRate ?? 0 },
                { metric: 'Avg ARPU', value: kpis?.arpu ?? 0 },
                { metric: 'System Uptime %', value: kpis?.uptime ?? 0 },
                { metric: 'API Success %', value: kpis?.apiSuccess ?? 0 },
                { metric: 'Monitored Nodes', value: usage?.totalTanks ?? 0 },
                { metric: 'Sensor Readings 30D', value: usage?.readings30d ?? 0 }
            ]);
        notify('Report Generated', `${reportTemplate} compiled from live intelligence.`, 'success');
    };

    const handleExportArchive = () => {
        const rows = [
            ...(scheduled || []).map(s => ({ protocol: s.type, frequency: s.frequency, last_run: s.last_run, status: s.status })),
            ...(localProtocols || []).map(s => ({ protocol: s.type, frequency: s.frequency, last_run: s.last_run, status: s.status }))
        ];
        downloadCSV(`report-archive-${new Date().toISOString().slice(0, 10)}.csv`,
            ['protocol', 'frequency', 'last_run', 'status'],
            rows.length ? rows : [{ protocol: 'No archived reports', frequency: '', last_run: '', status: '' }]);
        notify('Archive Exported', `${rows.length} report record(s) written to CSV.`, 'success');
    };


    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [kpiData, usageData, scheduledData, growthData] = await Promise.all([
                    analyticsService.getBusinessKPIs(),
                    analyticsService.getUsageStats(),
                    analyticsService.getScheduledReports(),
                    analyticsService.getMonthlyGrowthStats()
                ]);
                setKpis(kpiData);
                setUsage(usageData);
                setScheduled(scheduledData);
                setGrowthStats(growthData);
                const tankQuery = supabase.from('tank_analytics_30d').select('*').order('avg_volume', { ascending: false }).limit(8);
                const aiQuery = supabase.from('ai_recommendations').select('*').order('created_at', { ascending: false }).limit(8);
                const [tankRows, aiRows] = await Promise.all([tankQuery, aiQuery]);
                setTankStats((tankRows as any)?.data || []);
                setAiRecs((aiRows as any)?.data || []);
            } catch (error) {
                console.error('Error fetching analytics data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const formatCurrency = (amount: number) => {
        return formatMoney(amount, { currency: 'USD', currencySymbol: '$', locale: 'en' });
    };

    const maxGrowth = useMemo(() => Math.max(...growthStats, 1), [growthStats]);

    const renderIntelligence = () => {
        const stickiness = usage?.totalTanks && usage?.readings30d
            ? Math.min(100, Math.round((usage.readings30d / (usage.totalTanks * 30)) * 100))
            : null;
        return (
        <div className="analytics-intelligence animate-fade-in">
            {/* Business Dashboard Section */}
            <div className="dp-stats-grid">
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob"><FiTrendingUp /></div>
                    <div className="stat-content">
                        <label>MRR Momentum</label>
                        <h3>+{kpis?.mrrGrowth}%</h3>
                        <div className="stat-trend up">Above target</div>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfdf5', color: '#10b981' }}><FiBarChart2 /></div>
                    <div className="stat-content">
                        <label>Annual Run Rate</label>
                        <h3>{formatCurrency(kpis?.arr || 0)}</h3>
                        <div className="stat-trend up">Steady growth</div>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#fff1f2', color: '#f43f5e' }}><FiTarget /></div>
                    <div className="stat-content">
                        <label>Churn Velocity</label>
                        <h3 className="text-rose-600">{kpis?.churnRate}%</h3>
                        <div className="stat-trend down">Low risk</div>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfeff', color: '#06b6d4' }}><FiActivity /></div>
                    <div className="stat-content">
                        <label>Avg ARPU</label>
                        <h3>{formatCurrency(kpis?.arpu || 0)}</h3>
                        <div className="stat-trend up">+4.2%</div>
                    </div>
                </div>
            </div>

            <div className="analytics-dashboard-grid mt-8">
                <div className="dp-intelligence-card">
                    <div className="card-label-row">
                        <h4>Client Network Expansion</h4>
                        <span className="text-[10px] font-black uppercase text-slate-400">{usage?.totalTanks || 0} Nodes</span>
                    </div>
                    <div className="bar-chart-container">
                        {growthStats.map((v, i) => (
                            <div key={i} className="bar-segment" style={{ height: `${(v / maxGrowth) * 100}%` }} data-value={`${v} Nodes`} />
                        ))}
                    </div>
                </div>


                <div className="dp-intelligence-card">
                    <div className="card-label-row">
                        <h4>Engagement Funnel</h4>
                    </div>
                    <div className="funnel-container">
                        <div className="flex items-center justify-center h-40 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                            Engagement funnel metrics are not yet aggregated
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                 <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Stickiness Index</h4></div>
                    <div className="flex gap-4">
                        <div className="flex-1 p-6 bg-slate-50 rounded-3xl">
                            <span className="text-[10px] font-black uppercase opacity-40">DAU/MAU</span>
                            <div className="text-3xl font-black text-purple-600">{stickiness === null ? '—' : `${stickiness}%`}</div>
                        </div>
                        <div className="flex-1 p-6 bg-slate-50 rounded-3xl">
                            <span className="text-[10px] font-black uppercase opacity-40">Retention</span>
                            <div className="text-3xl font-black text-cyan-500">—</div>
                        </div>
                    </div>
                </div>
                <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Regional Distribution</h4></div>
                    <div className="space-y-4">
                        <div className="text-[10px] font-black text-slate-300 uppercase py-8 text-center tracking-widest">
                            No regional telemetry aggregated yet
                        </div>
                    </div>
                </div>
            </div>
        </div>
        );
    };

    const renderUsageAnalytics = () => (
        <div className="usage-analytics animate-fade-in">
            <div className="dp-stats-grid mb-8">
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob"><FiBox /></div>
                    <div className="stat-content">
                        <label>Fuel Volume Monitored</label>
                        <h3>{usage?.totalFuel.toLocaleString()}L</h3>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfeff', color: '#06b6d4' }}><FiActivity /></div>
                    <div className="stat-content">
                        <label>API Requests (30D)</label>
                        <h3>{usage?.apiCalls30d.toLocaleString()}</h3>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#fffbeb', color: '#f59e0b' }}><FiAlertCircle /></div>
                    <div className="stat-content">
                        <label>Critical Incidents</label>
                        <h3>{usage?.alertsTriggered30d}</h3>
                    </div>
                </div>
            </div>

            <div className="dp-intelligence-card">
                <div className="card-label-row">
                    <h4>Feature Adoption Matrix</h4>
                </div>
                <div className="adoption-matrix">
                    {Object.entries(usage?.featureAdoption || {}).map(([feature, adoption]) => (
                        <div key={feature} className="adoption-segment">
                            <div className="adoption-label">
                                <span>{feature}</span>
                                <b>{adoption}%</b>
                            </div>
                            <div className="adoption-bar-bg">
                                <div className="adoption-fill" style={{ width: `${adoption}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderReportingSuite = () => (
        <div className="reporting-suite animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="lg:col-span-1">
                     <div className="dp-intelligence-card h-full">
                        <h4 className="mb-6">Report Compiler</h4>
                        <div className="space-y-4">
                            <div>
                                <label className="info-label">Template</label>
                                <select
                                    className="support-input"
                                    value={reportTemplate}
                                    onChange={(e) => setReportTemplate(e.target.value)}
                                >
                                    <option>Monthly Revenue Report</option>
                                    <option>Regulatory Compliance Report</option>
                                    <option>Operational Fuel Report</option>
                                </select>
                            </div>
                            <button onClick={handleGenerateReport} className="w-full py-4 bg-purple-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-purple-600/20">Launch Generator</button>
                        </div>
                    </div>
                </div>
                <div className="lg:col-span-2">
                     <div className="tdv-transaction-table-container">
                        <div className="table-header-toolbar">
                             <div className="table-title">Automated Protocols</div>
                             <button className="action-circle view" onClick={() => setShowProtocolForm(!showProtocolForm)}><FiPlus /></button>
                        </div>
                        {showProtocolForm && (
                            <div className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 border-b border-slate-100">
                                <div className="flex-1 min-w-[180px]">
                                    <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1.5">Protocol Name</label>
                                    <input
                                        type="text"
                                        value={protocolName}
                                        onChange={(e) => setProtocolName(e.target.value)}
                                        placeholder="e.g. Weekly Revenue Rollup"
                                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-purple-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1.5">Frequency</label>
                                    <select
                                        value={protocolFrequency}
                                        onChange={(e) => setProtocolFrequency(e.target.value)}
                                        className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-purple-500"
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                        <option value="quarterly">Quarterly</option>
                                    </select>
                                </div>
                                <button onClick={handleAddProtocol} className="px-5 py-2.5 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all">
                                    Register Protocol
                                </button>
                            </div>
                        )}
                        <table className="tdv-transaction-table">
                            <thead>
                                <tr><th>Protocol</th><th>Frequency</th><th>Target</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                                {[...scheduled.slice(0, 3), ...localProtocols].map(s => (
                                    <tr key={s.id}>
                                        <td className="font-bold">{s.type}</td>
                                        <td>{s.frequency}</td>
                                        <td className="font-mono text-[9px]">{s.last_run}</td>
                                        <td className="text-emerald-600 text-[9px] font-black uppercase">{s.status}</td>
                                    </tr>
                                ))}
                                {scheduled.length === 0 && localProtocols.length === 0 && (
                                    <tr><td colSpan={4} className="py-16 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">No automated protocols registered</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="tdv-transaction-table-container">
                <table className="tdv-transaction-table">
                    <thead>
                        <tr><th>Archive Identifier</th><th>Classification</th><th>Certified Date</th><th>Magnitude</th><th className="text-right">Action</th></tr>
                    </thead>
                    <tbody>
                        {[...scheduled, ...localProtocols].map(s => (
                            <tr key={s.id}>
                                <td className="font-mono text-[10px] font-black opacity-50">{s.id}</td>
                                <td className="font-bold">{s.type}</td>
                                <td className="font-mono text-[10px]">{s.last_run}</td>
                                <td className="text-[10px] font-black uppercase">{s.frequency}</td>
                                <td className="text-right text-emerald-600 text-[9px] font-black uppercase">{s.status}</td>
                            </tr>
                        ))}
                        {scheduled.length === 0 && localProtocols.length === 0 && (
                            <tr>
                                <td colSpan={5} className="text-center py-20 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                    No Archived Reports Available
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );


    const handleRefreshTankAnalytics = async () => {
        try {
            await supabase.rpc('refresh_tank_analytics');
            notify('Analytics Refreshed', 'tank_analytics_30d rebuilt from the live partitioned readings.', 'success');
            const { data: tankRows } = await supabase.from('tank_analytics_30d').select('*').order('avg_volume', { ascending: false }).limit(8);
            setTankStats((tankRows as any) || []);
        } catch (err: any) {
            notify('Refresh Failed', err.message, 'error');
        }
    };

    const handleSupplierScore = async () => {
        if (!supplierName.trim()) return;
        setSupplierLoading(true);
        setSupplierResult('');
        try {
            const { data, error } = await supabase.rpc('get_supplier_reliability_score', { p_supplier_name: supplierName.trim() });
            if (error) throw error;
            setSupplierResult(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
        } catch (err: any) {
            setSupplierResult(`Error: ${err.message}`);
        } finally {
            setSupplierLoading(false);
        }
    };

    const renderSystemAnalytics = () => (
        <div className="system-analytics animate-fade-in space-y-8">
            <div className="dp-stats-grid mb-2">
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob"><FiBox /></div>
                    <div className="stat-content">
                        <label>Tanks Tracked (30D)</label>
                        <h3>{tankStats.length}</h3>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfeff', color: '#06b6d4' }}><FiActivity /></div>
                    <div className="stat-content">
                        <label>AI Recommendations</label>
                        <h3>{aiRecs.length}</h3>
                    </div>
                </div>
            </div>

            <div className="dp-intelligence-card">
                <div className="card-label-row">
                    <h4>Live Tank Analytics (30d Materialized View)</h4>
                    <button onClick={handleRefreshTankAnalytics} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all">
                        <FiRefreshCw /> Refresh View
                    </button>
                </div>
                <div className="tdv-transaction-table-container mt-4">
                    <table className="tdv-transaction-table">
                        <thead>
                            <tr><th>Station</th><th>Tank</th><th>Avg Vol (L)</th><th>Min</th><th>Max</th><th>Avg Temp</th><th>Readings</th></tr>
                        </thead>
                        <tbody>
                            {tankStats.map((t, i) => (
                                <tr key={i}>
                                    <td className="font-mono text-[10px] opacity-60">{t.station_id?.slice(0, 8)}…</td>
                                    <td className="font-mono text-[10px] opacity-60">{t.tank_id?.slice(0, 8)}…</td>
                                    <td className="font-bold">{Math.round(t.avg_volume ?? 0).toLocaleString()}</td>
                                    <td>{Math.round(t.min_volume ?? 0).toLocaleString()}</td>
                                    <td>{Math.round(t.max_volume ?? 0).toLocaleString()}</td>
                                    <td>{t.avg_temperature?.toFixed(1) ?? '—'}°</td>
                                    <td className="font-bold">{t.reading_count ?? 0}</td>
                                </tr>
                            ))}
                            {tankStats.length === 0 && (
                                <tr><td colSpan={7} className="py-12 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">No tank analytics materialized yet — run Refresh View</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="dp-intelligence-card">
                <div className="card-label-row">
                    <h4>Supplier Reliability Score</h4>
                    <div className="flex items-center gap-3">
                        <input
                            type="text"
                            value={supplierName}
                            onChange={(e) => setSupplierName(e.target.value)}
                            placeholder="e.g. Total Petroleum"
                            className="border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:border-purple-500"
                        />
                        <button onClick={handleSupplierScore} disabled={supplierLoading} className="px-4 py-2 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all">
                            {supplierLoading ? 'Scoring...' : 'Score Supplier'}
                        </button>
                    </div>
                </div>
                {supplierResult && (
                    <pre className="mt-4 p-4 bg-slate-50 border border-slate-100 rounded-2xl overflow-x-auto text-xs font-mono">{supplierResult}</pre>
                )}
            </div>

            <div className="dp-intelligence-card">
                <div className="card-label-row"><h4>AI Recommendation Engine (ai_recommendations)</h4></div>
                <div className="tdv-transaction-table-container mt-4">
                    <table className="tdv-transaction-table">
                        <thead>
                            <tr><th>Type</th><th>Confidence</th><th>Risk</th><th>Predicted 7D</th><th>Savings</th><th>Action</th><th>Accurate</th></tr>
                        </thead>
                        <tbody>
                            {aiRecs.map((r, i) => (
                                <tr key={r.id || i}>
                                    <td className="font-black uppercase text-[10px]">{r.recommendation_type}</td>
                                    <td>{(Number(r.confidence_score) * 100).toFixed(0)}%</td>
                                    <td className={`font-black uppercase text-[10px] ${r.risk_level === 'high' ? 'text-rose-600' : r.risk_level === 'low' ? 'text-emerald-600' : 'text-amber-600'}`}>{r.risk_level}</td>
                                    <td>{r.predicted_price_7day ? `${r.currency || ''}${r.predicted_price_7day}` : '—'}</td>
                                    <td>{r.potential_savings ? `${r.currency || ''}${r.potential_savings}` : '—'}</td>
                                    <td className="text-[10px]">{r.user_action || '—'}</td>
                                    <td>{r.was_accurate === null ? '—' : r.was_accurate ? 'Yes' : 'No'}</td>
                                </tr>
                            ))}
                            {aiRecs.length === 0 && (
                                <tr><td colSpan={7} className="py-12 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">No AI recommendations in the pipeline</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    return (
        <Layout>
            <div className="analytics-page">
                <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">intelligence & analytics</h1>
                        <div className="dp-subtitle">Consolidated Platform Performance & Regulatory Reporting</div>
                    </div>
                    
                    <div className="dp-header-actions">
                        <button onClick={handleExportArchive} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                            <FiDownload /> Export Archive
                        </button>
                    </div>
                </header>

                <div className="hw-tabs mb-8">
                    {[
                        { id: 'intelligence', label: 'Business Intelligence' },
                        { id: 'reporting', label: 'Automated Reporting' },
                        { id: 'system', label: 'System Analytics' }
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
                        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Synchronizing Intelligence Engine...</p>
                    </div>
                ) : (
                    <>
                        {activeTab === 'intelligence' && (
                            <div className="space-y-12">
                                {renderIntelligence()}
                                <div className="forensic-divider" />
                                {renderUsageAnalytics()}
                            </div>
                        )}
                        {activeTab === 'reporting' && renderReportingSuite()}
                        {activeTab === 'system' && renderSystemAnalytics()}
                    </>
                )}
            </div>
        </Layout>
    );
};

export default AnalyticsReports;
