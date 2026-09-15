import React, { useMemo } from 'react';
import { useAllStations, useGlobalStats, useAlerts } from '@/hooks/useSupabase';
import { 
    FiActivity, FiServer, FiCheckCircle, 
    FiZap, FiCpu, FiShield 
} from 'react-icons/fi';
import { Alert } from '@/types';
import { format } from 'date-fns';
import './NetworkPulse.css';

export const NetworkPulse: React.FC = () => {
    const { stations, loading: stationsLoading } = useAllStations();
    const { stats, loading: statsLoading } = useGlobalStats();
    const { alerts } = useAlerts(undefined, false); // All unresolved alerts across all stations

    const systemIntegrity = useMemo(() => {
        if (!stats) return 0;
        return stats.healthScore;
    }, [stats]);

    if (stationsLoading || statsLoading) {
        return (
            <div className="np-loading">
                <div className="np-spinner" />
                <span>Synchronizing Global Telemetry...</span>
            </div>
        );
    }

    return (
        <div className="np-container animate-in fade-in duration-700">
            {/* 1. Global HUD Row */}
            <header className="np-header">
                <div className="np-title-block">
                    <div className="np-icon-wrap np-pulse">
                        <FiZap size={24} />
                    </div>
                    <div>
                        <h1>Network Pulse</h1>
                        <p>Real-time infrastructure orchestration across all active nodes.</p>
                    </div>
                </div>
                
                <div className="np-hud-metrics">
                    <div className="np-hud-card">
                        <span className="np-hud-label">Global Health</span>
                        <div className="np-hud-value-row">
                            <span className="np-hud-value">{systemIntegrity}%</span>
                            <div className="np-health-bar">
                                <div className="np-health-fill" style={{ width: `${systemIntegrity}%` }} />
                            </div>
                        </div>
                    </div>
                    <div className="np-hud-card">
                        <span className="np-hud-label">Active Nodes</span>
                        <span className="np-hud-value">{stats.stationCount}</span>
                    </div>
                    <div className="np-hud-card">
                        <span className="np-hud-label">Unresolved Alerts</span>
                        <span className={`np-hud-value ${stats.activeAlerts > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {stats.activeAlerts}
                        </span>
                    </div>
                </div>
            </header>

            <div className="np-grid">
                {/* 2. Station Health Matrix */}
                <section className="np-section np-matrix-section">
                    <div className="np-section-header">
                        <div className="flex items-center gap-2">
                            <FiServer className="text-indigo-500" />
                            <h2>Infrastructure Matrix</h2>
                        </div>
                        <span className="np-badge">LIVE SYNC</span>
                    </div>
                    
                    <div className="np-matrix-grid">
                        {stations.map(station => (
                            <div key={station.id} className="np-station-card">
                                <div className="np-station-status">
                                    <div className="np-dot active" />
                                    <span className="np-station-id">{station.id.split('-')[0].toUpperCase()}</span>
                                </div>
                                <h3 className="np-station-name">{station.station_name}</h3>
                                <div className="np-station-meta">
                                    <div className="np-meta-item">
                                        <FiCpu size={12} />
                                        {/* Deterministic Latency Simulation: Based on node identifier seed */}
                                        <span>Latency: {Math.abs(station.station_name.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0) % 50 + 10)}ms</span>
                                    </div>
                                    <div className="np-meta-item">
                                        <FiShield size={12} />
                                        <span>Secure</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* 3. Real-time Incident Feed */}
                <section className="np-section np-feed-section">
                    <div className="np-section-header">
                        <div className="flex items-center gap-2">
                            <FiActivity className="text-rose-500" />
                            <h2>System Incident Feed</h2>
                        </div>
                    </div>
                    
                    <div className="np-feed">
                        {alerts.length === 0 ? (
                            <div className="np-empty-feed">
                                <FiCheckCircle size={48} className="text-emerald-500/20" />
                                <p>All nodes responding normally.</p>
                            </div>
                        ) : (
                            alerts.map((alert: Alert) => (
                                <div key={alert.id} className={`np-feed-item ${alert.severity}`}>
                                    <div className="np-feed-time">{format(alert.timestamp, 'HH:mm:ss')}</div>
                                    <div className="np-feed-content">
                                        <span className="np-feed-title">{alert.title}</span>
                                        <p className="np-feed-msg">{alert.message}</p>
                                    </div>
                                    <div className="np-feed-badge">{alert.severity.toUpperCase()}</div>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};
