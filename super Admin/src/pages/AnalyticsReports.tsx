import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { analyticsService, BusinessKPIs, UsageStats, ScheduledReport } from '../services/analyticsService';
import { 
    FiBarChart2, FiPieChart, FiTrendingUp, FiTrendingDown, 
    FiActivity, FiFileText, FiCalendar, FiUsers, 
    FiMap, FiTarget, FiZap, FiDownload, FiPlus,
    FiFilter, FiMail, FiClock, FiCheckCircle, FiChevronRight,
    FiBox, FiCpu, FiShield, FiExternalLink, FiAlertCircle
} from 'react-icons/fi';
import './AnalyticsReports.css';

const AnalyticsReports: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'intelligence' | 'reporting'>('intelligence');
    const [kpis, setKpis] = useState<BusinessKPIs | null>(null);
    const [usage, setUsage] = useState<UsageStats | null>(null);
    const [scheduled, setScheduled] = useState<ScheduledReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [growthStats, setGrowthStats] = useState<number[]>(new Array(12).fill(0));


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
            } catch (error) {
                console.error('Error fetching analytics data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-KE', {
            style: 'currency',
            currency: 'KES',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const maxGrowth = useMemo(() => Math.max(...growthStats, 1), [growthStats]);

    const renderIntelligence = () => (
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
                        {/* Dynamic funnel logic would go here. Defaulting to empty state for now. */}
                        <div className="flex items-center justify-center h-40 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                            No Engagement Data Found
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
                            <div className="text-3xl font-black text-purple-600">0%</div>
                        </div>
                        <div className="flex-1 p-6 bg-slate-50 rounded-3xl">
                            <span className="text-[10px] font-black uppercase opacity-40">Retention</span>
                            <div className="text-3xl font-black text-cyan-500">0%</div>
                        </div>
                    </div>
                </div>
                <div className="dp-intelligence-card">
                    <div className="card-label-row"><h4>Regional Distribution</h4></div>
                    <div className="space-y-4">
                        {/* Regional data would be fetched from database. Defaulting to empty state. */}
                        <div className="text-[10px] font-black text-slate-300 uppercase py-8 text-center tracking-widest">
                            Scanning Distribution Hub...
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

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
                                <select className="support-input">
                                    <option>Monthly Revenue Report</option>
                                    <option>Tax Compliance (KRA)</option>
                                </select>
                            </div>
                            <button className="w-full py-4 bg-purple-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-purple-600/20">Launch Generator</button>
                        </div>
                    </div>
                </div>
                <div className="lg:col-span-2">
                     <div className="tdv-transaction-table-container">
                        <div className="table-header-toolbar">
                             <div className="table-title">Automated Protocols</div>
                             <button className="action-circle view"><FiPlus /></button>
                        </div>
                        <table className="tdv-transaction-table">
                            <thead>
                                <tr><th>Protocol</th><th>Frequency</th><th>Target</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                                {scheduled.slice(0, 3).map(s => (
                                    <tr key={s.id}>
                                        <td className="font-bold">{s.type}</td>
                                        <td>{s.frequency}</td>
                                        <td className="font-mono text-[9px]">{s.last_run}</td>
                                        <td className="text-emerald-600 text-[9px] font-black uppercase">Active</td>
                                    </tr>
                                ))}
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
                        <tr>
                            <td colSpan={5} className="text-center py-20 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                No Archived Reports Available
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );


    // Custom helper for icons that might be missing or wrongly named in source
    const FiDollarSign_Fixed = () => <FiBarChart2 />;

    return (
        <Layout>
            <div className="analytics-page">
                <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">intelligence & analytics</h1>
                        <div className="dp-subtitle">Consolidated Platform Performance & KRA Reporting</div>
                    </div>
                    
                    <div className="dp-header-actions">
                        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">
                            <FiDownload /> Export Archive
                        </button>
                    </div>
                </header>

                <div className="hw-tabs mb-8">
                    {[
                        { id: 'intelligence', label: 'Business Intelligence' },
                        { id: 'reporting', label: 'Automated Reporting' }
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
                    </>
                )}
            </div>
        </Layout>
    );
};

export default AnalyticsReports;
