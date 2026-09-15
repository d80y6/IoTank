import React, { useState } from 'react';
import {
    FiDownload,
    FiTarget,
    FiActivity,
    FiZap,
    FiFileText,
    FiDroplet,
} from 'react-icons/fi';
import {
    MdOutlineEventNote,

    MdOutlineMemory,
    MdOutlineAutoAwesome,
    MdComputer,
    MdLocalGasStation,
    MdOutlineThermostat,
    MdOutlineSignalWifiStatusbarConnectedNoInternet4,
    MdBarChart,
    MdSchedule,
    MdOutlineLocalShipping,
    MdTune,
    MdOutlineWifi,
    MdSystemUpdate,
    MdTimelapse,
    MdPsychology,
    MdInsights,
    MdStar,
    MdSyncProblem,
    MdSecurity,
    MdSettingsSuggest,
    MdDoneAll,
} from 'react-icons/md';
import { format } from 'date-fns';
import { sanitizeIds } from '@/utils/formatUtils';

import {
    useEventLog,
    EventCategory,
    EventSeverity,
    PAGE_SIZE,
} from '@/hooks/useEventLog';
import { useAuth } from '@/hooks/useAuth';
import './EventLogPage.css';

// ── Icon helpers ─────────────────────────────────────────────────────────────

function EventTypeIcon({ type }: { type: string }) {
    const map: Record<string, React.ReactNode> = {
        'Refill Confirmed': <MdLocalGasStation />,
        'Dispense': <FiDroplet />,
        'Dispense Recorded': <FiDroplet />,
        'Temperature Spike': <MdOutlineThermostat />,
        'Temperature Spike Detected': <MdOutlineThermostat />,
        'Level Drop': <MdBarChart />,
        'Rapid Level Drop': <MdBarChart />,
        'Sensor Disconnect': <MdOutlineSignalWifiStatusbarConnectedNoInternet4 />,
        'Sensor Disconnected': <MdOutlineSignalWifiStatusbarConnectedNoInternet4 />,
        'Shift Closed': <MdSchedule />,
        'Delivery Confirmed': <MdOutlineLocalShipping />,
        'Manual Adjustment': <MdTune />,
        'Manual Volume Adjustment': <MdTune />,
        'Node Offline': <MdOutlineWifi />,
        'Node Went Offline': <MdOutlineWifi />,
        'Firmware Update': <MdSystemUpdate />,
        'Firmware Updated': <MdSystemUpdate />,
        'Telemetry Gap': <MdTimelapse />,
        'Telemetry Gap Detected': <MdTimelapse />,
        'Forecast Generated': <MdPsychology />,
        'AI Forecast Generated': <MdPsychology />,
        'Risk Score Updated': <MdInsights />,
        'Recommendation Issued': <MdStar />,
        'AI Recommendation Issued': <MdStar />,
        'Sync Failure': <MdSyncProblem />,
        'Telemetry Sync Failure': <MdSyncProblem />,
        'Relay Trigger': <MdSecurity />,
        'Safety Relay Triggered': <MdSecurity />,
        'Calibration Updated': <MdSettingsSuggest />,
        'Calibration Profile Updated': <MdSettingsSuggest />,
    };
    return <>{map[type] ?? <MdOutlineEventNote />}</>;
}



function SeverityBadge({ severity }: { severity: EventSeverity }) {
    const dots: Record<EventSeverity, string> = {
        INFO: '●',
        WARNING: '▲',
        CRITICAL: '■',
    };
    return (
        <span className={`el-severity-badge el-severity-badge--${severity.toLowerCase()}`} role="status">
            <span className="el-severity-badge-icon" aria-hidden="true">{dots[severity]}</span>
            {severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase()}
        </span>
    );
}



// ── Main Page ─────────────────────────────────────────────────────────────────

export const EventLogPage: React.FC = () => {
    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId || '';

    const {
        events,
        total,
        totalPages,
        currentPage,
        setCurrentPage,
        loading,
        filters,
        updateFilter,
        categoryCounts,
        tanks,
        exportCSV,
        acknowledgeAll,
    } = useEventLog(stationId);

    const [isClearing, setIsClearing] = useState(false);

    const handleAcknowledgeAll = async () => {
        setIsClearing(true);
        // Wait for animation sweep
        await new Promise(resolve => setTimeout(resolve, 800));
        await acknowledgeAll();
        setIsClearing(false);
    };

    const startIdx = (currentPage - 1) * PAGE_SIZE + 1;
    const endIdx = Math.min(currentPage * PAGE_SIZE, total);

    // Category strip data
    const categories: { key: EventCategory | 'all'; label: string; icon: React.ReactNode }[] = [
        { key: 'all', label: 'All', icon: <MdOutlineEventNote size={14} /> },
        { key: 'SHIFT', label: 'Shift', icon: <MdSchedule size={14} /> },
        { key: 'DELIVERY', label: 'Delivery', icon: <MdLocalGasStation size={14} /> },
        { key: 'SECURITY', label: 'Security', icon: <MdSecurity size={14} /> },
        { key: 'SYSTEM', label: 'System', icon: <MdOutlineMemory size={14} /> },
        { key: 'AI', label: 'AI', icon: <MdOutlineAutoAwesome size={14} /> },
        { key: 'CALIBRATION', label: 'Calibration', icon: <MdTune size={14} /> },
    ];

    // Pagination page buttons (smart window)
    const pageButtons = () => {
        const pages: (number | '…')[] = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages.push(1);
            if (currentPage > 3) pages.push('…');
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                pages.push(i);
            }
            if (currentPage < totalPages - 2) pages.push('…');
            pages.push(totalPages);
        }
        return pages;
    };

    return (
        <div className="el-page">

            {/* ── Header ─────────────────────────────────────── */}
            <div className="el-header">
                <div className="el-header-top">
                    <div className="el-header-title">
                        <div className="el-header-icon">
                            <MdOutlineEventNote size={24} />
                        </div>
                        <div>
                            <h1>Event Log</h1>
                            <p className="el-page-subtitle">
                                System audit trail — immutable, chronological, audit-ready
                            </p>
                        </div>
                    </div>

                    <div className="el-header-actions">
                        <span className="el-total-badge">
                            <MdOutlineEventNote size={13} />
                            {total.toLocaleString()} events
                        </span>
                        <button 
                            className={`btn-tactical ${isClearing ? 'loading' : ''}`} 
                            onClick={handleAcknowledgeAll} 
                            disabled={isClearing || total === 0}
                            title="Clear all unread forensic entries"
                        >
                            {isClearing ? <FiActivity className="animate-spin" /> : <MdDoneAll size={16} />}
                            {isClearing ? 'Acknowledging...' : 'Mark All Read'}
                        </button>
                        <button className="el-btn-export" onClick={exportCSV}>
                            <FiDownload size={14} />
                            Export CSV
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Category Strip ──────────────────────────────── */}
            <div className="el-category-strip">
                {categories.map(cat => {
                    const count = cat.key === 'all' ? total : (categoryCounts as any)[cat.key.toLowerCase()] || 0;
                    const isActive = filters.category === cat.key;
                    return (
                        <button
                            key={cat.key}
                            className={`el-cat-chip el-cat-chip--${cat.key.toLowerCase()} ${isActive ? 'active' : ''}`}
                            onClick={() => updateFilter('category', cat.key)}
                        >
                            {cat.icon}
                            {cat.label}
                            <span className="el-cat-count">{count}</span>
                        </button>
                    );
                })}
            </div>

            {/* ── Filter Bar ──────────────────────────────────── */}
            <div className="el-filter-bar">
                <div className="el-filter-grid">
                    {/* Severity */}
                    <div className="el-filter-item">
                        <div className="el-filter-label">
                             <FiTarget size={12} />
                             <span>Severity</span>
                        </div>
                        <div className="el-select-wrapper">
                            <select
                                className="el-filter-select"
                                value={filters.severity}
                                onChange={e => updateFilter('severity', e.target.value as EventSeverity | 'all')}
                                title="Filter by Severity"
                            >
                                <option value="all">All Severities</option>
                                <option value="info">Info</option>
                                <option value="warning">Warning</option>
                                <option value="critical">Critical</option>
                            </select>
                        </div>
                    </div>

                    {/* Tank */}
                    <div className="el-filter-item">
                        <div className="el-filter-label">
                             <MdLocalGasStation size={12} />
                             <span>Tank Selection</span>
                        </div>
                        <div className="el-select-wrapper">
                            <select
                                className="el-filter-select"
                                value={filters.tankId}
                                onChange={e => updateFilter('tankId', e.target.value)}
                                title="Filter by Tank"
                            >
                                <option value="">All Tanks</option>
                                {tanks.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Triggered By */}
                    <div className="el-filter-item">
                        <div className="el-filter-label">
                             <FiActivity size={12} />
                             <span>Event Source</span>
                        </div>
                        <div className="el-select-wrapper">
                            <select
                                className="el-filter-select"
                                value={filters.triggeredBy}
                                onChange={e => updateFilter('triggeredBy', e.target.value as 'all' | 'system' | 'user' | 'ai')}
                                title="Filter by Event Source"
                            >
                                <option value="all">All Sources</option>
                                <option value="system">System</option>
                                <option value="user">User</option>
                                <option value="ai">AI</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Audit & Event Timeline Section ──────────────── */}
            <section className="el-timeline-section">
                <div className="el-section-header">
                    <FiActivity />
                    <h2>Audit & Event Timeline</h2>
                </div>

                <div className="el-table-container">
                    <table className="el-table">
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Action Type</th>
                                <th>Actor</th>
                                <th>Alert Level</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="el-table-loading">
                                        <div className="el-loading-spinner"></div>
                                        <span>Synchronizing audit trail...</span>
                                    </td>
                                </tr>
                            ) : events.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="el-table-empty">
                                        <div className="el-empty-state">
                                            <span className="el-empty-icon">📋</span>
                                            <p>No events match your current filters</p>
                                            <small>Try adjusting the time range or search query</small>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                events.map((ev) => (
                                    <tr key={ev.id} className={isClearing ? 'neural-sweep-exit' : ''}>
                                        <td className="el-td-ts">
                                            <div className="ts-date">{format(ev.timestamp, 'dd MMM')}</div>
                                            <div className="ts-time">{format(ev.timestamp, 'HH:mm:ss')}</div>
                                        </td>
                                        <td className="el-td-type">
                                            <div className="type-badge">
                                                <div className="type-icon">
                                                    <EventTypeIcon type={ev.type} />
                                                </div>
                                                <span className="type-label">{sanitizeIds(ev.title)}</span>
                                            </div>
                                        </td>
                                        <td className="el-td-actor">
                                            <div className="actor-tag">
                                                <MdComputer size={14} />
                                                <span>{ev.triggeredByName}</span>
                                            </div>
                                        </td>
                                        <td className="el-td-severity">
                                            <SeverityBadge severity={ev.severity} />
                                        </td>
                                        <td className="el-td-details">
                                            {sanitizeIds(ev.description)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* ── Pagination ──────────────────────────────────── */}
            {total > 0 && (
                <div className="el-pagination">
                    <p className="el-pagination-info">
                        Showing <strong>{startIdx}–{endIdx}</strong> of <strong>{total}</strong> events
                    </p>
                    <div className="el-pagination-controls">
                        <button
                            className="el-page-btn"
                            onClick={() => setCurrentPage(p => p - 1)}
                            disabled={currentPage === 1}
                            aria-label="Previous page"
                        >
                            ‹
                        </button>
                        {pageButtons().map((p, i) =>
                            p === '…'
                                ? <span key={`ell-${i}`} className="pagination-ellipsis" aria-hidden="true">…</span>
                                : (
                                    <button
                                        key={p}
                                        className={`el-page-btn ${currentPage === p ? 'active' : ''}`}
                                        onClick={() => setCurrentPage(p as number)}
                                        aria-label={`Go to page ${p}`}
                                        aria-current={currentPage === p ? 'page' : undefined}
                                    >
                                        {p}
                                    </button>
                                )
                        )}
                        <button
                            className="el-page-btn"
                            onClick={() => setCurrentPage(p => p + 1)}
                            disabled={currentPage === totalPages}
                            title="Next page"
                        >
                            ›
                        </button>
                    </div>
                </div>
            )}

            <footer className="el-info-footer">
                <div className="el-info-header">
                    <FiFileText />
                    <h2>About Historical Data</h2>
                </div>
                <p className="el-info-description">
                    This page displays fuel volume trends over time. Use the time range selector to view different periods.
                    Events such as refills, alerts, and anomalies are highlighted on the timeline below the chart.
                </p>
                <div className="el-info-grid">
                    <div className="el-info-item">
                        <h3><FiTarget /> Interactive Chart</h3>
                        <p>Hover over data points to see exact values and timestamps captured by the ESP32 sensors.</p>
                    </div>
                    <div className="el-info-item">
                        <h3><FiActivity /> Event Timeline</h3>
                        <p>View refills, low-fuel alerts, and AI-detected anomalies in a sequential audit trail.</p>
                    </div>
                    <div className="el-info-item">
                        <h3><FiDownload /> Export Options</h3>
                        <p>Download historical data as CSV for spreadsheets or generate a professional PDF report.</p>
                    </div>
                    <div className="el-info-item">
                        <h3><FiZap /> Zoom & Pan</h3>
                        <p>Click and drag on the chart to inspect high-frequency data windows (Planned).</p>
                    </div>
                </div>
            </footer>
        </div>
    );
};
