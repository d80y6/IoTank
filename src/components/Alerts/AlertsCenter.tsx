import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    FiSettings, FiCheckCircle, FiInfo, 
    FiShield, FiActivity, FiCheck, FiZap, FiAlertTriangle, FiAlertOctagon, FiSliders, FiBell, FiMail
} from 'react-icons/fi';
import './AlertsCenter.css';
import { useAlerts, resolveAlert, useTanks } from '@/hooks/useSupabase';
import { useAuth } from '@/hooks/useAuth';
import { AuditService } from '@/services/AuditService';
import { NotificationService } from '../../services/NotificationService';
import { Alert, AlertSeverityLabel } from '@/types';
import { getSeverityClass } from '../../services/AlertScoringEngine';
import { SkeletonDashboard, SkeletonTable } from '../Common/SkeletonLoader';
import { resolveAllAlerts, propagateStationThresholds } from '@/hooks/useSupabase';
import { sanitizeIds } from '@/utils/formatUtils';
import { logger } from '@/utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'mission' | 'thresholds' | 'preferences';
type SeverityFilter = 'ALL' | AlertSeverityLabel | 'RESOLVED';

// ── Helpers ───────────────────────────────────────────────────────────────────
function getAlertAge(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${diffHrs}h ${mins}m`;
}

function getAlertSeverityLabel(alert: Alert): AlertSeverityLabel {
    if (alert.severityLabel) return alert.severityLabel;
    if (alert.score != null) {
        if (alert.score >= 90) return 'CRITICAL';
        if (alert.score >= 70) return 'HIGH';
        if (alert.score >= 40) return 'WATCH';
        return 'INFO';
    }
    if (alert.severity === 'critical') return 'CRITICAL';
    if (alert.severity === 'warning') return 'HIGH';
    return 'INFO';
}

// ── Sub-Components ─────────────────────────────────────────────────────────────

const RiskIndexCards: React.FC<{ activeAlerts: Alert[] }> = ({ activeAlerts }) => {
    const fuelRiskCount = activeAlerts.filter(a => ['leak_detected', 'theft_detected', 'low_level', 'overfill'].includes(a.type)).length;
    const systemRiskCount = activeAlerts.filter(a => ['telemetry_gap', 'sensor_failure', 'connectivity_lost'].includes(a.type)).length;
    const complianceCount = activeAlerts.filter(a => a.severity === 'info').length;

    return (
        <div className="risk-index-grid">
            <div className="risk-card-premium fuel">
                <div className="label-stack">
                    <label>Fuel Inventory Risk</label>
                    <h3>{fuelRiskCount > 0 ? `${fuelRiskCount} Active Vectors` : 'Nominal State'}</h3>
                </div>
                <div className="risk-icon-box">
                    <FiZap />
                </div>
            </div>
            <div className="risk-card-premium system">
                <div className="label-stack">
                    <label>System Integrity</label>
                    <h3>{systemRiskCount > 0 ? `${systemRiskCount} Neural Gaps` : 'Maximum Uptime'}</h3>
                </div>
                <div className="risk-icon-box">
                    <FiActivity />
                </div>
            </div>
            <div className="risk-card-premium compliance">
                <div className="label-stack">
                    <label>Governance & Audit</label>
                    <h3>{complianceCount > 0 ? `${complianceCount} Advisory Items` : 'Full Compliance'}</h3>
                </div>
                <div className="risk-icon-box">
                    <FiShield />
                </div>
            </div>
        </div>
    );
};

const EscalationLadder: React.FC<{ activeAlerts: Alert[] }> = ({ activeAlerts }) => {
    const counts = {
        CRITICAL: activeAlerts.filter(a => getAlertSeverityLabel(a) === 'CRITICAL').length,
        HIGH: activeAlerts.filter(a => getAlertSeverityLabel(a) === 'HIGH').length,
        WATCH: activeAlerts.filter(a => getAlertSeverityLabel(a) === 'WATCH').length,
        INFO: activeAlerts.filter(a => getAlertSeverityLabel(a) === 'INFO').length,
    };
    
    const total = activeAlerts.length || 1;
    const getWidth = (count: number) => (count / total) * 100;

    return (
        <div className="escalation-ladder-container">
            <div className="ladder-header">
                <h4>Escalation Ladder</h4>
                <div className="ladder-legend">
                    <div className="legend-item"><span className="dot critical" /> Critical</div>
                    <div className="legend-item"><span className="dot high" /> High</div>
                    <div className="legend-item"><span className="dot watch" /> Watch</div>
                    <div className="legend-item"><span className="dot info" /> Info</div>
                </div>
            </div>
            <div className="ladder-bar">
                <div className="ladder-segment critical" style={{ width: `${getWidth(counts.CRITICAL)}%` }} />
                <div className="ladder-segment high" style={{ width: `${getWidth(counts.HIGH)}%` }} />
                <div className="ladder-segment watch" style={{ width: `${getWidth(counts.WATCH)}%` }} />
                <div className="ladder-segment info" style={{ width: `${getWidth(counts.INFO)}%` }} />
            </div>
        </div>
    );
};

const RiskTrendViz: React.FC<{ activeAlerts: Alert[] }> = ({ activeAlerts }) => {
    return (
        <div className="risk-trend-viz">
            <div className="label-stack">
                <label>Real-time Pulse</label>
            </div>
            <div className="viz-pulse-stack">
                {[...Array(8)].map((_, i) => (
                    <div 
                        key={i} 
                        className="viz-bar active" 
                        style={{ 
                            animationDelay: `${i * 0.1}s`, 
                            height: `${40 + ((activeAlerts.length * (i + 1)) % 60)}%` 
                        }} 
                    />
                ))}
            </div>
        </div>
    );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const AlertsCenter: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<Tab>('mission');
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
    const [isLoading, setIsLoading] = useState(true);
    const [notificationsActive, setNotificationsActive] = useState(NotificationService.isEnabled());

    const handleToggleNotifications = async () => {
        if (notificationsActive) {
            NotificationService.disable();
            setNotificationsActive(false);
        } else {
            const granted = await NotificationService.requestPermission();
            if (granted && currentUser?.authUserId) {
                await NotificationService.subscribeToPush(currentUser.authUserId);
            }
            setNotificationsActive(granted);
        }
    };





    // Preference states
    const [emailEnabled, setEmailEnabled] = useState(true);
    const [escalationDelay, setEscalationDelay] = useState('2h');

    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId || '';

    const { alerts: rawActiveAlerts, loading: activeLoading } = useAlerts(stationId, false);
    const { tanks, loading: tanksLoading } = useTanks(stationId);

    const [isPropagating, setIsPropagating] = useState(false);

    const handlePropagateLogic = async () => {
        if (!stationId) return;
        setIsPropagating(true);
        try {
            await propagateStationThresholds(stationId);
            // Invalidate tanks query to show updated values if they were visible
            // Note: useTanks hook will automatically refetch due to realtime subscription or query invalidation
            // but we can add a toast or similar if we had a toast provider here.
            // For now, the Audit log is enough for the backend.
        } catch (err) {
            logger.error('Failed to propagate logic:', err);
        } finally {
            setIsPropagating(false);
        }
    };

    useEffect(() => {
        setIsLoading(true);
        const timer = setTimeout(() => setIsLoading(false), 800);
        return () => clearTimeout(timer);
    }, [tanks, tanksLoading]);
    






    const activeAlerts = useMemo(() => {
        return rawActiveAlerts.map((a: Alert) => ({
            ...a,
            severityLabel: a.severityLabel ?? getAlertSeverityLabel(a),
        }));
    }, [rawActiveAlerts]);

    const filteredActive = useMemo(() => {
        if (severityFilter === 'ALL') return activeAlerts;
        return activeAlerts.filter((a: Alert) => getAlertSeverityLabel(a) === severityFilter);
    }, [activeAlerts, severityFilter]);

    // Removed filteredHistory as it's not used in current tabs

    const handleResolve = async (id: string) => { 
        await resolveAlert(id, currentUser?.authUserId || 'SYSTEM'); 
        
        const alert = activeAlerts.find((a: Alert) => a.id === id);
        await AuditService.log(
            'SYSTEM',
            'ALERT_RESOLVED',
            stationId,
            `Operator resolved ${alert?.type || 'system'} alert: ${alert?.title || id}`,
            'INFO',
            { alertId: id, alertType: alert?.type }
        );
    };

    const [isClearing, setIsClearing] = useState(false);

    const handleResolveAll = async () => {
        if (!stationId) return;
        setIsClearing(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 800));
            await resolveAllAlerts(stationId, currentUser?.authUserId || 'SYSTEM');
            await AuditService.log(
                'SYSTEM',
                'ALERTS_BULK_RESOLVED',
                stationId,
                `Operator resolved all active alert vectors.`,
                'INFO'
            );
        } catch (err) {
            logger.error('Error resolving all alerts:', err);
        } finally {
            setIsClearing(false);
        }
    };

    const handleInvestigate = (alert: Alert) => { 
        if (alert.rootCauseLink) {
            const { type, id } = alert.rootCauseLink;
            let path = '/';
            if (type === 'tank') path = `/tanks/${id}`;
            else if (type === 'delivery') path = `/deliveries/${id}`;
            else if (type === 'shift') path = `/shifts/${id}`;
            navigate(path);
        }
    };



    return (
        <div className="alerts-hud-container">
            <aside className="hud-neural-sidebar">
                <div className="hud-brand-stack">
                    <h1 className="hud-brand-title">
                        Risk <span className="amethyst-glimmer">Command HUD</span>
                    </h1>
                    <div className="hud-status-line">
                        <span className="live-pulse-dot" /> Operational Intelligence v2.5
                    </div>
                </div>

                <div className="neural-stats-scroller">
                    <div className="sidebar-group">
                        <label className="sidebar-label">Neural Integrity</label>
                        <RiskIndexCards activeAlerts={activeAlerts} />
                    </div>

                    <div className="sidebar-group">
                        <label className="sidebar-label">Criticality Spread</label>
                        <EscalationLadder activeAlerts={activeAlerts} />
                    </div>

                    <div className="sidebar-meta-block">
                        <div className="meta-item">
                            <FiActivity size={12} />
                            <span>System Status: <strong>ONLINE</strong></span>
                        </div>
                        <div className="meta-item">
                            <FiZap size={12} />
                            <span>Neural Latency: <strong>42ms</strong></span>
                        </div>
                    </div>
                </div>
            </aside>

            <main className="hud-content-area">
                <header className="hud-top-navigation">
                    <nav className="tactical-tabs">
                        <button className={`tactical-tab ${activeTab === 'mission' ? 'active' : ''}`} onClick={() => setActiveTab('mission')}>
                            <FiActivity /> Mission Control
                            {rawActiveAlerts.length > 0 && <span className="tab-count">{rawActiveAlerts.length}</span>}
                        </button>

                        <button className={`tactical-tab ${activeTab === 'thresholds' ? 'active' : ''}`} onClick={() => setActiveTab('thresholds')}>
                            <FiSliders /> Calibration
                        </button>
                        <button className={`tactical-tab ${activeTab === 'preferences' ? 'active' : ''}`} onClick={() => setActiveTab('preferences')}>
                            <FiSettings /> Dispatch
                        </button>
                    </nav>

                        {activeTab === 'mission' && rawActiveAlerts.length > 0 && (
                            <div className="hud-top-actions">
                                <RiskTrendViz activeAlerts={activeAlerts} />
                                <button 
                                    className={`tactical-btn-premium danger ${isClearing ? 'loading' : ''}`} 
                                    onClick={handleResolveAll} 
                                    disabled={isClearing}
                                    title="Resolve all active mission vectors"
                                >
                                    {isClearing ? <FiActivity className="animate-spin" /> : <FiCheckCircle />}
                                    {isClearing ? 'Clearing Sensors...' : 'Acknowledge All'}
                                </button>
                            </div>
                        )}
                        {activeTab === 'thresholds' && (
                            <button 
                                className={`tactical-btn-primary btn-sm ${isPropagating ? 'loading' : ''}`} 
                                onClick={handlePropagateLogic}
                                disabled={isPropagating}
                                title="Propagate threshold logic to all tanks" 
                                aria-label="Propagate Logic"
                            >
                                {isPropagating ? <FiActivity className="animate-spin" /> : <FiCheckCircle />}
                                {isPropagating ? 'Propagating...' : 'Propagate Logic'}
                            </button>
                        )}
                </header>

                <div className="hud-view-viewport">
                    {(isLoading || activeLoading) ? (
                        <div className="hud-loader-container">
                            <SkeletonDashboard />
                        </div>
                    ) : (
                        <div className="view-pane-wrapper">
                            {activeTab === 'mission' && (
                                <div className="mission-dashboard-container animate-hud-in">
                                    <div className="mission-scroll-area scrollable-hud">
                                        <section className="dashboard-section">
                                            <div className="section-header-compact">
                                                <h3 className="section-title">Active Vectors <span className="dim">/ Intelligence Stream</span></h3>
                                                <div className="filter-reel">
                                                    {(['ALL', 'CRITICAL', 'HIGH', 'WATCH', 'INFO'] as SeverityFilter[]).map(f => (
                                                        <button 
                                                            key={f} 
                                                            className={`filter-reel-chip ${severityFilter === f ? 'active' : ''}`} 
                                                            data-severity={f.toLowerCase()}
                                                            onClick={() => setSeverityFilter(f)}
                                                            title={`Filter by ${f} severity`}
                                                            aria-label={`Filter by ${f} severity`}
                                                        >
                                                            {f}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="intelligence-table-wrapper">
                                                <table className="intelligence-stream-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Threat Vector</th>
                                                            <th>Intelligence Signature</th>
                                                            <th>Severity</th>
                                                            <th>Age</th>
                                                            <th>Actions</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {filteredActive.length === 0 ? (
                                                            <tr>
                                                                <td colSpan={5} className="empty-stream-state">
                                                                    <div className="empty-tactical-state unified">
                                                                        <div className="secure-haven-graphic">
                                                                            <div className="shield-ring outer"></div>
                                                                            <div className="shield-ring inner"></div>
                                                                            <FiShield className="empty-icon-glow" />
                                                                        </div>
                                                                        <h3 className="empty-state-title">Operational Perimeter Secure</h3>
                                                                        <p className="empty-state-desc">Zero immediate threats or anomalies detected within the current telemetry window.</p>
                                                                        <div className="scan-line-v2"></div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            filteredActive.map((alert: Alert) => {
                                                                const label = alert.severityLabel ?? getAlertSeverityLabel(alert);
                                                                const cssClass = getSeverityClass(label);
                                                                const age = getAlertAge(alert.timestamp);
                                                                
                                                                return (
                                                                    <tr key={alert.id} className={`stream-row ${cssClass} ${label === 'CRITICAL' ? 'premium-glow-critical' : ''} ${isClearing ? 'stream-row-sweep' : ''}`}>
                                                                        <td>
                                                                            <div className="vector-identity">
                                                                                <div className="vector-icon-slot">
                                                                                    {label === 'CRITICAL' ? <FiAlertOctagon /> : label === 'HIGH' ? <FiAlertTriangle /> : <FiInfo />}
                                                                                </div>
                                                                                <span className="vector-title">{sanitizeIds(alert.title ?? alert.message)}</span>
                                                                            </div>
                                                                        </td>
                                                                        <td><span className="signature-pill">{alert.type.replace(/[-_]/g, ' ')}</span></td>
                                                                        <td>
                                                                            <span className={`severity-tag ${cssClass}`}>
                                                                                {alert.score != null && <span className="score-hint">{alert.score}</span>}
                                                                                {label}
                                                                            </span>
                                                                        </td>
                                                                        <td className="age-cell">{age} ago</td>
                                                                        <td>
                                                                            <div className="stream-action-group">
                                                                                <button className="stream-btn investigate" onClick={() => handleInvestigate(alert)} title="Investigate Root Cause">
                                                                                    <FiZap />
                                                                                </button>
                                                                                <button className="stream-btn resolve" onClick={() => handleResolve(alert.id)} title="Resolve Vector">
                                                                                    <FiCheck />
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </section>
                                    </div>
                                </div>
                            )}



                            {activeTab === 'thresholds' && (
                                <div className="view-pane flex-column animate-hud-in scrollable-hud">
                                    <div className="hud-glass-card-compact border-none">
                                        <header className="pane-header-compact">
                                            <div className="calibration-header-ui">
                                                <div className="heading-accent-line" />
                                                <h2 className="card-title">Neural Detection Calibration</h2>
                                                <div className="subtitle-wrapper">
                                                    <span className="card-subtitle">Safety Compliance & Engine Policies</span>
                                                    <span className="stable-lock-pill">STABLE / HARDCODED</span>
                                                </div>
                                            </div>
                                        </header>



                                        <div className="dashboard-separator" />

                                        {/* SECTION 1: STANDARDIZED THRESHOLD CALCULATIONS */}
                                        <div className="calibration-module-header mt-4">
                                            <h4 className="module-title"><FiShield /> Standardized Detection Engine Thresholds</h4>
                                            <p className="policy-disclaimer mb-6">
                                                * These thresholds are deterministic and hardcoded into the detection neural matrix to ensure safety compliance. 
                                                Automated alerts are triggered based on the specific holographic volume calculations shown below.
                                            </p>
                                        </div>

                                        <div className="calibration-scroller-grid">
                                            {tanksLoading ? <SkeletonTable /> : (
                                                tanks.map((tank: import('@/types').Tank) => {
                                                    const capacity = tank.capacity || 0;
                                                    return (
                                                        <div key={tank.id} className="tank-logic-card">
                                                            <div className="tank-card-meta">
                                                                <h4 className="tank-name">{tank.name}</h4>
                                                                <span className="fuel-tag">{tank.fuelType.toUpperCase()} ({capacity}L)</span>
                                                            </div>
                                                            
                                                            <div className="standard-threshold-grid">
                                                                <div className="threshold-row-item critical">
                                                                    <div className="level-info">
                                                                        <label>High-High / 98%</label>
                                                                        <span className="tier-name">Critical Overfill</span>
                                                                    </div>
                                                                    <span className="vol-value">{Math.round(capacity * 0.98).toLocaleString()}L</span>
                                                                </div>

                                                                <div className="threshold-row-item high">
                                                                    <div className="level-info">
                                                                        <label>High / 95%</label>
                                                                        <span className="tier-name">Operator Warning</span>
                                                                    </div>
                                                                    <span className="vol-value">{Math.round(capacity * 0.95).toLocaleString()}L</span>
                                                                </div>

                                                                <div className="threshold-row-item info">
                                                                    <div className="level-info">
                                                                        <label>Info / 50%</label>
                                                                        <span className="tier-name">Mid-point Check</span>
                                                                    </div>
                                                                    <span className="vol-value">{Math.round(capacity * 0.50).toLocaleString()}L</span>
                                                                </div>

                                                                <div className="threshold-row-item low">
                                                                    <div className="level-info">
                                                                        <label>Low / 20%</label>
                                                                        <span className="tier-name">Reorder</span>
                                                                    </div>
                                                                    <span className="vol-value">{Math.round(capacity * 0.20).toLocaleString()}L</span>
                                                                </div>

                                                                <div className="threshold-row-item critical-low">
                                                                    <div className="level-info">
                                                                        <label>Critical Low / 5%</label>
                                                                        <span className="tier-name">Emergency Stop</span>
                                                                    </div>
                                                                    <span className="vol-value">{Math.round(capacity * 0.05).toLocaleString()}L</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'preferences' && (
                                <div className="view-pane flex-column animate-hud-in">
                                    <div className="hud-glass-card-compact border-none">
                                        <header className="pane-header-compact">
                                            <h2 className="card-title">Dispatch Orchestration</h2>
                                        </header>

                                        <div className="dispatch-layout">
                                            <div className="dispatch-section">
                                                <h4 className="dispatch-subtitle">Primary Channels</h4>
                                                <div className="tactical-toggle-row">
                                                    <div className="toggle-info">
                                                        <div className="toggle-label"><FiBell /> Native Push Services</div>
                                                        <p>Biological bypass for real-time tactical pulses.</p>
                                                    </div>
                                                    <button 
                                                        className={`tactical-switch ${notificationsActive ? 'active' : ''}`} 
                                                        onClick={handleToggleNotifications} 
                                                        title="Toggle native push notifications" 
                                                        aria-label="Toggle native push notifications"
                                                    >
                                                        <div className="switch-knob" />
                                                    </button>
                                                </div>
                                                <div className="tactical-toggle-row">
                                                    <div className="toggle-info">
                                                        <div className="toggle-label"><FiMail /> Email Intelligence</div>
                                                        <p>Forensic summaries delivered to mission control.</p>
                                                    </div>
                                                    <button className={`tactical-switch ${emailEnabled ? 'active' : ''}`} onClick={() => setEmailEnabled(!emailEnabled)} title="Toggle email intelligence notifications" aria-label="Toggle email intelligence notifications">
                                                        <div className="switch-knob" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="dispatch-section">
                                                <h4 className="dispatch-subtitle">Escalation Logic</h4>
                                                <div className="select-group-tactical">
                                                    <label>Chain of Command Delay</label>
                                                    <select 
                                                        value={escalationDelay} 
                                                        onChange={e => setEscalationDelay(e.target.value)} 
                                                        className="select-tactical w-full"
                                                        title="Escalation Delay Period"
                                                    >
                                                        <option value="1h">1 hour (High Priority)</option>
                                                        <option value="2h">2 hours (Operational)</option>
                                                        <option value="4h">4 hours (Deep Maintenance)</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

