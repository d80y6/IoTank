/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { 
    FiTrendingUp, FiAlertTriangle, FiDownload, 
    FiShield, FiActivity, FiTarget, 
    FiDollarSign, FiDroplet, FiPercent 
} from 'react-icons/fi';
import { PageHeader } from '../Common/PageHeader';
import { WetstockReconciliation } from './WetstockReconciliation';
import { LazyComponent } from '../Common/LazyComponent';

import { useActiveShift } from '@/hooks/useShifts';
import { useAuth } from '@/hooks/useAuth';
import { useTanks, useTankAnalytics30d } from '@/hooks/useSupabase';
import { validateUUID } from '@/utils/sanitization';
import { useTransactions } from '@/hooks/useTransactions';
import { useShiftStatus } from '@/hooks/useShiftStatus';
import { Tank, FuelTransaction } from '@/types';
import {
    ResponsiveContainer, AreaChart, Area,
    XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid
} from 'recharts';
import { format, subDays } from 'date-fns';
import { getStrategicRecommendations } from '@/utils/reportingLogic';
import '../Common/DesignSystemCards.css';
import './AnalyticsPage.css';

export const AnalyticsPage: React.FC = () => {
    const { currentUser } = useAuth();
    
    // Forensic UUID validation to prevent RPC signature mismatches (PGRST202)
    const isValidStation = currentUser?.stationId && validateUUID(currentUser.stationId);
    
    // Default to a system GUID if not authenticated to prevent hook crashes and signature errors
    const stationId = isValidStation ? currentUser.stationId : '00000000-0000-0000-0000-000000000000';

    // ─── High Performance Analytics Fetching ──────────────────────
    const { analytics: analyticsData } = useTankAnalytics30d(stationId);
    const { tanks } = useTanks(stationId);
    const { transactions } = useTransactions(stationId);
    const { activeShift } = useActiveShift(stationId);
    const { status: shiftStatus, openedAt, closedAt } = useShiftStatus();

    // ─── Shift-Scoped Filtering ──────────────────────
    const shiftTransactions = transactions.filter((tx: FuelTransaction) => {
        const txTime = new Date(tx.timestamp).getTime();
        if (shiftStatus === 'open') {
            return openedAt ? txTime >= openedAt : false;
        } else {
            return (openedAt && closedAt) ? (txTime >= openedAt && txTime <= closedAt) : false;
        }
    });

    // Aggregate stats from the materialized view data
    const analytics = (analyticsData as any)?.summary || [];
    const stats = analytics.reduce((acc: any, tank: any) => {
        acc.totalVolume += tank.total_volume; 
        acc.avgDaily += tank.avg_daily;
        return acc;
    }, { totalVolume: 0, avgDaily: 0, totalSale: 0, totalPurchase: 0, totalProfit: 0, litersSold: 0 });

    // Financial Stats scoped to Shift
    shiftTransactions.forEach((tx: FuelTransaction) => {
        if (tx.type === 'sale') {
            stats.totalSale += tx.amount * (tx.metadata?.pricePerLiter || 0);
            stats.litersSold += tx.amount;
        }
        if (tx.type === 'purchase') stats.totalPurchase += tx.amount * (tx.metadata?.pricePerLiter || 0);
    });

    stats.totalProfit = stats.totalSale - stats.totalPurchase;
    const marginPercent = stats.totalSale > 0 ? (stats.totalProfit / stats.totalSale) * 100 : 0;
    // const revenuePerLitre = stats.litersSold > 0 ? stats.totalSale / stats.litersSold : 0;

    // [ONE TRUTH]: Calculate Overall Station Variance matching the WRe module
    const snapshots = (activeShift as any)?.metadata?.tank_snapshots || {};
    const totalOpening = tanks.reduce((sum: number, t: import('@/types').Tank) => {
        const snap = snapshots[t.id]?.opening_volume;
        return sum + (snap !== undefined ? snap : (t.currentVolume || 0));
    }, 0);

    const totalMeasured = tanks.reduce((sum: number, t: Tank) => sum + (t.currentVolume || 0), 0);
    const totalDeliveries = shiftTransactions.filter((tx: FuelTransaction) => tx.type === 'delivery').reduce((sum: number, tx: FuelTransaction) => sum + tx.amount, 0);
    const totalSales = shiftTransactions.filter((tx: FuelTransaction) => tx.type === 'sale').reduce((sum: number, tx: FuelTransaction) => sum + tx.amount, 0);
    const totalExpected = totalOpening + totalDeliveries - totalSales;
    const totalVariance = totalMeasured - totalExpected;
    const totalVariancePct = totalExpected > 0 ? (totalVariance / totalExpected) * 100 : 0;
    // const inventoryTurnover = totalOpening > 0 ? (totalSales / totalOpening) : 0;

    // --- Predictive Intelligence ---
    const thirtyDaysAgo = subDays(new Date(), 30);
    const recentSales = transactions.filter((tx: FuelTransaction) => tx.type === 'sale' && new Date(tx.timestamp) >= thirtyDaysAgo);
    const totalRecentSales = recentSales.reduce((sum: number, tx: FuelTransaction) => sum + tx.amount, 0);
    const avgDailySales = totalRecentSales / 30;
    const daysOfCover = avgDailySales > 0 ? totalMeasured / avgDailySales : 99;

    const recommendations = getStrategicRecommendations(totalVariancePct, daysOfCover, 0);

    const chartData = shiftTransactions
        .filter((t: FuelTransaction) => t.timestamp && t.type === 'sale')
        .slice(0, 12)
        .reverse()
        .map((t: FuelTransaction) => ({
            name: format(t.timestamp, 'HH:mm'),
            sales: t.amount,
        }));

    const displayData = chartData.length > 0 ? chartData : [
        { name: 'No Data', sales: 0 }
    ];

    const lastUpdated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="analytics-page-container">
            <PageHeader
                title="Intelligence Hub"
                description="Advanced telemetry analysis and predictive fuel modeling"
                action={
                    <div className="acp-header-action-wrap">
                        <div className="acp-header-meta-info">
                            <span>Data Window: {shiftStatus === 'open' ? 'Live Shift' : 'Last Closed Shift'}</span>
                            <span className="acp-header-meta-dot"></span>
                            <span>Updated: {lastUpdated}</span>
                        </div>
                        <button className="btn-premium-action">
                            <FiDownload size={14} /> Generate Report
                        </button>
                    </div>
                }
            />

            {/* ── KPI Summary Strip ───────────────────────────────────────── */}
            <div className="acp-kpi-grid">
                <div className="acp-kpi-card">
                    <div className="acp-kpi-icon green"><FiDollarSign /></div>
                    <div className="acp-kpi-body">
                        <span className="acp-kpi-label">Shift Revenue</span>
                        <span className="acp-kpi-value">Ksh {stats.totalSale.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <span className="acp-kpi-sub opacity-60">Based on {shiftTransactions.length} operations</span>
                    </div>
                </div>
                <div className="acp-kpi-card">
                    <div className="acp-kpi-icon blue"><FiDroplet /></div>
                    <div className="acp-kpi-body">
                        <span className="acp-kpi-label">Fuel Sold (L)</span>
                        <span className="acp-kpi-value">{stats.litersSold.toLocaleString()} L</span>
                        <span className="acp-kpi-sub opacity-60">Volumetric Drawdown</span>
                    </div>
                </div>
                <div className="acp-kpi-card">
                    <div className="acp-kpi-icon purple"><FiPercent /></div>
                    <div className="acp-kpi-body">
                        <span className="acp-kpi-label">Margin %</span>
                        <span className="acp-kpi-value">{marginPercent.toFixed(1)}%</span>
                        <span className="acp-kpi-sub acp-metric-trend-accent">Target: Opti-Max</span>
                    </div>
                </div>
                <div className="acp-kpi-card">
                    <div className={`acp-kpi-icon ${Math.abs(totalVariancePct) > 0.5 ? 'red' : 'cyan'}`}><FiShield /></div>
                    <div className="acp-kpi-body">
                        <span className="acp-kpi-label">Variance</span>
                        <span className="acp-kpi-value">{totalVariancePct.toFixed(2)}%</span>
                        <span className="acp-kpi-sub">{Math.abs(totalVariancePct) <= 0.5 ? 'Synchronized' : 'Drift Detected'}</span>
                    </div>
                </div>
            </div>


            {/* ── Main Grid ────────────────────────────────────── */}
            <div className="acp-grid">

                {/* Left Column */}
                <div className="acp-main">

                    {/* Operational Performance Hub */}
                    <div className="acp-card">
                        <div className="acp-card-header">
                            <div className="acp-card-title">
                                <div className="acp-section-icon acp-icon-accent-purple"><FiActivity /></div>
                                <h3>Operational Performance</h3>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4">
                            {/* Wetstock Reconciliation Sub-card */}
                            <div className="acp-hub-card">
                                <LazyComponent minHeight="400px">
                                    <WetstockReconciliation
                                        tanks={tanks}
                                        transactions={shiftTransactions}
                                        currency="Ksh"
                                        activeShift={activeShift}
                                    />
                                </LazyComponent>
                            </div>

                            {/* 30-Day Tank Performance */}
                            <div className="acp-hub-card bg-slate-50/50 p-4 rounded-xl border border-slate-100 mt-4">
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">30-Day Tank Drawdown</h4>
                                {analytics.length === 0 ? (
                                    <div className="text-sm text-slate-400">Not enough data to calculate trends.</div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {analytics.map((t: any, i: number) => (
                                            <div key={i} className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm flex flex-col gap-1">
                                                <div className="text-sm font-black text-slate-800">{t.tank_name}</div>
                                                <div className="flex justify-between items-center text-xs text-slate-500">
                                                    <span>Total Vol:</span>
                                                    <span className="font-bold text-slate-700">{t.total_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })} L</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-slate-500">
                                                    <span>Daily Avg:</span>
                                                    <span className="font-bold text-slate-700">{t.avg_daily.toLocaleString(undefined, { maximumFractionDigits: 1 })} L/day</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>

                    {/* Demand Forecast */}
                    <div className="acp-card">
                        <div className="acp-card-header">
                            <div className="acp-card-title">
                                <div className="acp-section-icon acp-icon-accent-amber"><FiTarget /></div>
                                <h3>Demand Forecast</h3>
                            </div>
                            <div className="acp-toggle">
                                <button className="active">Tank View</button>
                                <button>Fleet View</button>
                            </div>
                        </div>

                        <div className="acp-forecast-tiles !mb-3 !gap-2">
                            <div className="acp-tile !p-2">
                                <div className="acp-tile-label">7-Day Forecast</div>
                                <div className="flex justify-between items-end">
                                    <span className="acp-tile-val !text-sm">{Math.round(avgDailySales * 7).toLocaleString()} L</span>
                                    <div className="acp-tile-spark">
                                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                            <AreaChart data={displayData.slice(-7)}>
                                                <Area type="monotone" dataKey="sales" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.25} strokeWidth={1.5} isAnimationActive={false} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                            <div className="acp-tile !p-2">
                                <div className="acp-tile-label">30-Day Projection</div>
                                <span className="acp-tile-val !text-sm">{Math.round(avgDailySales * 30).toLocaleString()} L</span>
                            </div>
                            <div className="acp-tile !p-2">
                                <div className="acp-tile-label">Model Confidence</div>
                                <span className={`acp-tile-val !text-sm ${transactions.length > 20 ? 'success' : 'amber'}`}>
                                    {transactions.length > 20 ? 'High' : 'Evolving'}
                                </span>
                            </div>
                            <div className="acp-tile border-l-[3px] border-[#f59e0b] !p-2">
                                <div className="acp-tile-label">Days of Cover</div>
                                <span className="acp-tile-val amber !text-sm">{daysOfCover.toFixed(1)} Days</span>
                            </div>
                        </div>

                        <div className="acp-chart-wrap" style={{ height: '240px', minHeight: '240px', background: 'rgba(248, 250, 252, 0.5)' }}>
                            <LazyComponent minHeight="240px">
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                                    <AreaChart data={displayData}>
                                        <defs>
                                            <linearGradient id="gradForecast" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                                                <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }} />
                                        <RechartsTooltip
                                            contentStyle={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: '8px', color: 'var(--color-text-primary)' }}
                                            itemStyle={{ color: '#3b82f6' }}
                                        />
                                        <Area type="monotone" dataKey="sales" stroke="#7c3aed" strokeWidth={2.5} fillOpacity={1} fill="url(#gradForecast)" animationDuration={1500} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </LazyComponent>
                        </div>
                    </div>


                    {/* Risk & Variance Analysis */}
                    <div className="acp-card">
                        <div className="acp-card-header">
                            <div className="acp-card-title">
                                <div className="acp-section-icon acp-icon-accent-purple"><FiShield /></div>
                                <h3>Risk &amp; Variance Analysis</h3>
                            </div>
                        </div>

                        {/* Variance Hero */}
                        <div className="acp-variance-hero">
                            <div className="acp-variance-hero-top">
                                <div>
                                    <div className="acp-variance-hero-label">Primary Analytics Metric</div>
                                    <h4 className="acp-variance-hero-title">Inventory Variance %</h4>
                                </div>
                                <div className="text-right">
                                    <div className="acp-variance-number">{totalVariancePct.toFixed(2)}%</div>
                                    <span className="acp-variance-status">{Math.abs(totalVariancePct) < 0.5 ? 'Stable' : 'Critical'}</span>
                                </div>
                            </div>
                             <div className="acp-progress-bar">
                                 <div 
                                    className="acp-progress-fill acp-progress-purple" 
                                    style={{ width: `${Math.min(100, Math.max(5, 50 + totalVariancePct * 20))}%` }}
                                 ></div>
                             </div>
                            <div className="acp-variance-note">Critical Threshold: ±0.5% &nbsp;|&nbsp; Monitoring live flow signatures</div>
                        </div>

                        <div className="acp-two-col">
                            <div className="acp-metric-list">
                                <div className="acp-metric-row">
                                    <span className="acp-metric-name">Volume Drift</span>
                                    <div className="text-right">
                                        <div className={`acp-metric-val ${Math.abs(totalVariancePct) > 0.5 ? 'text-danger' : 'text-success'}`}>
                                            {totalVariancePct > 0 ? '+' : ''}{totalVariancePct.toFixed(2)}%
                                        </div>
                                        <span className={`acp-metric-badge ${Math.abs(totalVariancePct) > 0.5 ? 'badge-amber' : 'badge-green'}`}>
                                            {Math.abs(totalVariancePct) > 0.5 ? 'Drifted' : 'Stable'}
                                        </span>
                                    </div>
                                </div>
                                <div className="acp-metric-row">
                                    <span className="acp-metric-name">Absolute Delta</span>
                                    <span className="acp-metric-val">{Math.abs(totalVariance).toFixed(1)} L</span>
                                </div>
                                <div className="acp-metric-row">
                                    <span className="acp-metric-name">Active Nodes</span>
                                    <span className="acp-metric-val acp-icon-trend-up">
                                        {tanks.length > 0 ? ((tanks.filter((t: any) => t.isActive).length / tanks.length) * 100).toFixed(1) : 100}%
                                    </span>
                                </div>
                            </div>
                            <div>
                                <div className="acp-col-label">Forensic Anomalies</div>
                                <div className="acp-drawdown-list">
                                    {Math.abs(totalVariancePct) > 1.0 ? (
                                        <div className="acp-drawdown-item border-l-2 border-amber-500 bg-amber-50/50">
                                            <div className="flex items-center gap-2">
                                                <FiAlertTriangle className="text-amber-500" />
                                                <span className="acp-metric-name !font-semibold !normal-case text-amber-900">Drift Anomaly Detected</span>
                                            </div>
                                            <span className="acp-drawdown-time text-amber-700/60">Live</span>
                                        </div>
                                    ) : (
                                        <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-500 flex items-center gap-2">
                                            <FiShield className="text-emerald-500" /> No severe flow anomalies detected.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Sidebar */}
                <aside className="acp-sidebar">


                    {/* Decision Zone: Strategic Recommendations */}
                    <div className="acp-card">
                        <div className="acp-rec-meta-wrap">
                            <FiTrendingUp className="acp-icon-trend-up" /> Strategic Recommendations
                        </div>
                        <div className="acp-rec-list">
                            {recommendations.map(rec => (
                                <div key={rec.id} className={`acp-rec-item ${rec.priority}`}>
                                    <div className="flex-1">
                                        <div className="acp-rec-top">
                                            <span className="acp-rec-priority">
                                                {rec.priority === 'critical' && '🔴 Critical'}
                                                {rec.priority === 'watch' && '🟡 Watch'}
                                                {rec.priority === 'optimize' && '🟢 Optimize'}
                                            </span>
                                            <div className="acp-rec-scores">
                                                <span className="acp-rec-risk-score">Risk Score: {rec.riskScore}/100</span>
                                                <span className="acp-rec-confidence">Confidence: {rec.confidence}%</span>
                                            </div>
                                        </div>
                                        <p className="acp-rec-title">{rec.title}</p>
                                        <p className="acp-rec-desc">{rec.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>


                </aside>
            </div>



        </div>
    );
};

export default AnalyticsPage;

