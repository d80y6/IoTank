import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
    FiUsers, FiActivity, FiAlertCircle, FiTrendingUp, FiSettings,
    FiArrowRight, FiShield, FiClock, FiMapPin, FiDatabase,
    FiCpu, FiGrid, FiGlobe, FiServer, FiHardDrive, FiMessageSquare,
    FiCheckCircle, FiPieChart, FiDollarSign, FiZap,
    FiUserPlus, FiEdit3, FiBell, FiRefreshCw, FiSend,
    FiLifeBuoy, FiAlertTriangle, FiCommand, FiCheck, FiLock,
    FiCloud, FiDownload, FiBarChart2, FiCpu as FiEngine, FiTarget
} from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { dashboardService } from '../services/dashboardService';
import { hardwareService, Device } from '../services/hardwareService';
import { supabase } from '../config/supabase';
import type { DashboardStats } from '../services/dashboardService';
import TacticalMap from './TacticalMap';
import './Dashboard.css';

const Dashboard = () => {
    const { systemUser } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const [statsData, devicesData] = await Promise.all([
                dashboardService.getPlatformStats(),
                hardwareService.getDevices()
            ]);
            setStats(statsData);
            setDevices(devicesData);
        } catch (err) {
            
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        // ── REALTIME PLATFORM SYNC ──────────────────────────────────────────
        // Subscribe to critical table changes for immediate dashboard refresh
        const channel = supabase
            .channel('dashboard_realtime_sync')
            .on(
                'postgres_changes', 
                { event: '*', schema: 'public', table: 'devices' }, 
                () => {
                    fetchData();
                }
            )
            .on(
                'postgres_changes', 
                { event: '*', schema: 'public', table: 'tanks' }, 
                () => {
                    fetchData();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);


    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-KE', {
            style: 'currency',
            currency: 'KES',
            maximumFractionDigits: 0
        }).format(val);
    };

    if (loading) {
        return (
            <Layout>
                <div className="p-8 flex items-center justify-center min-h-[60vh]">
                    <div className="advanced-loader">
                        <div className="loader-pulse"></div>
                        <div className="loader-ring"></div>
                        <div className="loader-ring"></div>
                        <div className="loader-ring"></div>
                    </div>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="dashboard-container">
                
                {/* 1. Tactical Command Header */}
                <div className="mission-control-hero glass-panel">
                    <div className="ornament ornament-tl">SYS_MOD::ADMIN_V2.5</div>
                    <div className="hero-content">
                        <p className="hero-subtitle">Satellite Mission Control</p>
                        <h1>Platform Command</h1>
                    </div>

                    <div className="header-stats">
                        <div className="header-stat-item">
                            <p className="header-stat-label">System Uptime</p>
                            <p className="header-stat-val">{stats?.health?.uptime || 'Loading...'}</p>
                        </div>
                        <div className="header-stat-item">
                            <p className="header-stat-label">Signal Latency</p>
                            <p className="header-stat-val">{stats?.health?.queryLatency || '...'}</p>
                        </div>
                    </div>
                </div>

                {/* 2. Infrastructure Pulse - High Density */}
                <div className="infra-stack-section">
                    <h2 className="dashboard-section-title"><FiCpu /> Infrastructure Pulse</h2>
                    <div className="stats-grid">
                        <div className="glass-panel compact-stat-card success">
                            <div className="ornament ornament-tr">DB_S::OK</div>
                            <div className="stat-header">
                                <span className="stat-label">Cloud Database</span>
                                <FiDatabase size={14} className="text-emerald-500" />
                            </div>
                            <div className="stat-val-group">
                                <span className="stat-value">{stats?.health?.apiStatus?.supabase === 'green' ? 'SECURE' : 'DEGRADED'}</span>
                                <div className="stat-footer">
                                    <span>{stats?.health?.dbSize && stats.health.dbSize !== '0' ? stats.health.dbSize : 'Calculating...'}</span>
                                    <FiCheckCircle size={10} className="text-emerald-500" />
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel compact-stat-card primary">
                            <div className="ornament ornament-tr">MSG_G::STABLE</div>
                            <div className="stat-header">
                                <span className="stat-label">Comms Gateway</span>
                                <FiMessageSquare size={14} className="text-indigo-500" />
                            </div>
                            <div className="stat-val-group">
                                <span className="stat-value">{stats?.health?.apiStatus?.twilio === 'green' ? 'STABLE' : 'UNSTABLE'}</span>
                                <div className="stat-footer">
                                    <span>{stats?.health?.apiStatus?.twilio === 'green' ? 'Twilio Active' : 'API Error'}</span>
                                    <FiActivity size={10} className={stats?.health?.apiStatus?.twilio === 'green' ? "text-indigo-400" : "text-rose-500"} />
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel compact-stat-card warning">
                            <div className="ornament ornament-tr">AI_F::NOMINAL</div>
                            <div className="stat-header">
                                <span className="stat-label">Neural Engine</span>
                                <FiEngine size={14} className="text-amber-500" />
                            </div>
                            <div className="stat-val-group">
                                <span className="stat-value">{stats?.health?.alertRate ? 'NOMINAL' : 'STANDBY'}</span>
                                <div className="stat-footer">
                                    <span>{stats?.health?.alertRate || '0%'} Reliability</span>
                                    <FiZap size={10} className="text-amber-500" />
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel compact-stat-card success">
                            <div className="stat-header">
                                <span className="stat-label">Data Ingestion</span>
                                <FiDownload size={14} className="text-emerald-500" />
                            </div>
                            <div className="stat-val-group">
                                <span className="stat-value">{stats?.health?.dataIngestionRate && stats.health.dataIngestionRate !== '0' ? stats.health.dataIngestionRate : '0 /sec'}</span>
                                <div className="stat-footer">
                                    <span>REQ / MINUTE</span>
                                    <span className="status-indicator status-online"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Tactical Matrix: Map & Actions */}
                <div className="ops-matrix-grid">
                    <div className="tactical-map-wrapper">
                        <TacticalMap stationCount={stats?.health?.totalStations || 0} devices={devices} />
                    </div>


                    <div className="command-sidebar">
                        <div className="glass-panel p-6 h-full">
                            <h2 className="dashboard-section-title mb-6"><FiCommand /> Command Hub</h2>
                            <div className="command-blade">
                                {[
                                    { title: 'Approve Registrations', count: stats?.support?.pendingRequests, icon: <FiUserPlus />, path: '/registrations', color: 'indigo' },
                                    { title: 'Emergency Protocols', count: stats?.support?.urgentTickets, icon: <FiAlertTriangle />, color: 'rose', path: '/support' },
                                    { title: 'Network Broadcast', icon: <FiGlobe />, path: '/announcements', color: 'slate' },
                                    { title: 'Security Audit', icon: <FiShield />, path: '/security-events', color: 'emerald' }
                                ].map((cmd, i) => (
                                    <button key={i} onClick={() => navigate(cmd.path)} className="blade-btn">
                                        <div className="blade-icon">
                                            {cmd.icon}
                                        </div>
                                        <div className="blade-text">
                                            <h4>{cmd.title}</h4>
                                            <p>{cmd.count !== undefined ? `${cmd.count} Pending Requests` : 'System Ready'}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. Financial & Growth Reach */}
                <div className="growth-section">
                    <h2 className="dashboard-section-title"><FiBarChart2 /> Growth Metrics</h2>
                    <div className="stats-grid">
                        <div className="glass-panel compact-stat-card">
                            <span className="stat-label">Active Operators</span>
                            <span className="stat-value">{stats?.health?.totalUsers || 0}</span>
                            <div className="stat-footer">
                                <span className="text-emerald-500 font-bold">{stats?.health?.totalOperators || 0} Admins</span>
                                <span>Global Nodes</span>
                            </div>
                        </div>

                        <div className="glass-panel compact-stat-card">
                            <span className="stat-label">IoT Deployment</span>
                            <span className="stat-value">{stats?.health?.espDevices?.total || 0}</span>
                            <div className="stat-footer">
                                <span className="text-indigo-500 font-bold">{stats?.health?.espDevices?.online || 0} ONLINE</span>
                                <span>Hardware Fleet</span>
                            </div>
                        </div>

                        <div className="glass-panel compact-stat-card primary">
                            <span className="stat-label">Revenue Flow (MRR)</span>
                            <span className="stat-value">{formatCurrency(stats?.financial?.mrr || 0)}</span>
                            <div className="stat-footer">
                                <span>ARR: {formatCurrency(stats?.financial?.arr || 0)}</span>
                            </div>
                        </div>

                        <div className="glass-panel compact-stat-card danger">
                            <span className="stat-label">Risk Exposure</span>
                            <span className="stat-value">{formatCurrency(stats?.financial?.outstandingDebt || 0)}</span>
                            <div className="stat-footer">
                                <span className="text-rose-600 font-black">CRITICAL RISK</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 5. Live Logs & Support */}
                <div className="ops-matrix-grid">
                    <div className="glass-panel audit-container">
                        <div className="ornament ornament-tr">LIVE_FEED::READY</div>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="dashboard-section-title m-0"><FiActivity /> System Registry</h2>
                        </div>
                        <div className="audit-scroll custom-scrollbar">
                            {(stats?.recentActivity || []).map((event: any, i: number) => (
                                <div key={i} className="audit-entry">
                                    <FiTarget className="audit-icon" />
                                    <div className="audit-content">
                                        <p>{event.text}</p>
                                        <div className="audit-meta">TIME: {event.time} | UID_IDENT: {event.id.slice(-8).toUpperCase()}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="support-overview flex flex-col gap-4">
                        <div className="glass-panel compact-stat-card warning">
                            <span className="stat-label">Support incidents</span>
                            <span className="stat-value text-rose-600">{stats?.support?.urgentTickets || 0}</span>
                            <div className="stat-footer">
                                <span className="text-rose-500">Urgent Triaging</span>
                            </div>
                        </div>
                        <div className="glass-panel compact-stat-card">
                            <span className="stat-label">Open Support Queue</span>
                            <span className="stat-value">{stats?.support?.openTickets || 0}</span>
                            <div className="stat-footer">
                                <span>Active Sessions</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default Dashboard;


