import React, { useState, useMemo, useEffect } from 'react';
import { Tank, TankReading } from '@/types';
import { useLatestReading, useHistoricalReadings } from '@/hooks/useSupabase';
import { useConsumptionAnalytics } from '@/hooks/useConsumptionAnalytics';
import { formatVolume, formatTemperature } from '@/utils/formatUtils';
import { getFuelStatus } from '@/utils/dashboardUtils';
import { 
    FiActivity, FiClock, FiRefreshCw, 
    FiThermometer, FiAlertCircle, FiTrash2, FiShield, FiLock, FiX, FiWifi, FiShoppingCart 
} from 'react-icons/fi';

import { useNavigate } from 'react-router-dom';
import { AuditService } from '@/services/AuditService';
import { useAuth } from '@/hooks/useAuth';
import { deleteTank } from '@/hooks/useSupabase';
import { logger } from '@/utils/logger';

import '../Common/DesignSystemCards.css';
import './TankCard.css';

interface TankCardProps {
    tank: Tank;
    stationId: string;
    initialReading?: TankReading;
}

export const TankCard: React.FC<TankCardProps> = React.memo(({ tank, stationId, initialReading }) => {
    const navigate = useNavigate();
    const isGhost = tank.id === 'ghost-tank';
    const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const { verifySettingsPassword } = useAuth();
    
    // Accurate Real-Time Formatting for Offline Detection & Status Badges
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(interval);
    }, []);

    // [PRICE CALIBRATION NUDGE]: Recurring 20min nudge for unconfigured / newly created tanks
    const retailPrice = (tank as any).metadata?.retailPrice;
    const isPriceNotSet = !isGhost && (!retailPrice || retailPrice <= 0);
    const storageKey = useMemo(() => `iotank_last_price_nudge_${tank.id}`, [tank.id]);

    useEffect(() => {
        if (!isPriceNotSet) return;

        const showNudge = () => {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Asset Value Calibration Required',
                    message: `Tank "${tank.name}" has no retail price configured. Please calibrate its retail price in Settings to enable real-time financial tracking.`,
                    type: 'warning',
                    persistent: true,
                    attribution: 'GOVERNANCE CORE',
                    actions: [
                        {
                            label: 'Calibrate Now',
                            primary: true,
                            onClick: () => {
                                navigate(`/settings?tab=inventory&tankId=${tank.id}`);
                            }
                        }
                    ]
                }
            }));
            localStorage.setItem(storageKey, Date.now().toString());
        };

        const checkNudge = () => {
            const lastNudge = localStorage.getItem(storageKey);
            const nowTime = Date.now();
            const intervalMs = 20 * 60 * 1000; // 20 minutes

            if (!lastNudge || (nowTime - parseInt(lastNudge)) >= intervalMs) {
                showNudge();
            }
        };

        // Run nudge check 3 seconds after mounting to allow initial dashboard render to settle
        const initialTimeout = setTimeout(checkNudge, 3000);

        // Periodically verify elapsed time every 30 seconds
        const periodicInterval = setInterval(checkNudge, 30000);

        return () => {
            clearTimeout(initialTimeout);
            clearInterval(periodicInterval);
        };
    }, [isPriceNotSet, tank.id, tank.name, navigate, storageKey]);

    const formatTime = (timestamp: number) => {
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);

        if (minutes <= 5) return `Live Sync`;
        if (minutes < 60) return `${minutes}m ago`;
        
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours < 24) {
            return `${hours}h ${mins}m ago`;
        }
        
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h ago`;
    };

    // 1. Fetch live updates with HIGH PRIORITY. 
    // We enable this for all cards to ensure the "Last Updated" tag is always current.
    // The overhead is minimal for ~20 tanks and critical for real-time perception.
    const { reading: liveReading } = useLatestReading(stationId, tank.id, true);
    
    // Prioritize live reading from subscription, fall back to passed in initial reading
    const reading = liveReading || initialReading;

    const [isSyncing, setIsSyncing] = useState(false);
    const currency = 'Ksh';

    // 2. Fetch 24h historical data only when needed (e.g. hovered or detailed view)
    const timeRange = useMemo(() => ({
        start: Date.now() - (24 * 60 * 60 * 1000),
        end: Date.now()
    }), []);

    const { readings } = useHistoricalReadings(stationId, tank.id, timeRange, 100, 'hour', showDetailedAnalytics);
    const analytics = useConsumptionAnalytics(tank, readings);


    const handleCardClick = () => {
        if (!isGhost) {
            navigate(`/inventory?tankId=${tank.id}`);
        }
    };

    const handleSync = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsSyncing(true);
        setShowDetailedAnalytics(true);
        
        setTimeout(async () => {
            setIsSyncing(false);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Telemetry Sync',
                    message: `Real-time synchronization established for ${tank.name}. Monitoring active.`,
                    type: 'success',
                    attribution: 'DATA CORE'
                }
            }));
            
            await AuditService.log(
                'SYSTEM', 
                'DEVICE_COMMAND', 
                stationId, 
                `Manual telemetry handshake established: ${tank.name} synchronized with cloud logic.`,
                'INFO',
                { tankId: tank.id, tankName: tank.name }
            ).catch(() => {});
        }, 1000);
    };

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsDeleting(true);
        setDeleteError(null);

        try {
            // 1. Verify Password
            await verifySettingsPassword(deletePassword);

            // 2. Execute Deletion
            await deleteTank(tank.id);

            // 3. Success Toast
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Asset Purged',
                    message: `Tank ${tank.name} and all historical data permanently removed.`,
                    type: 'success',
                    attribution: 'GOVERNANCE CORE'
                }
            }));

            // 4. Close and Refresh (UI will handle the disappearance via useTanks invalidation)
            setShowDeleteModal(false);
        } catch (err: any) {
            logger.error("Deletion Failed:", err);
            setDeleteError(err.message || "Authorization failed. Please verify password.");
        } finally {
            setIsDeleting(false);
        }
    };

    // Calculate dynamic percentage: (Volume / Capacity) * 100
    const currentVolume = reading ? (reading.volumeCorrected || reading.volume || 0) : (tank.currentVolume || 0);
    const tankCapacity = tank.capacity || 1; // Prevent division by zero
    const calculatedPercentage = Number(Math.min(100, Math.max(0, (currentVolume / tankCapacity) * 100)).toFixed(1));

    // Determine status based on fuel level
    const hasData = !!reading || typeof tank.currentVolume === 'number';
    const status = hasData ? getFuelStatus(calculatedPercentage) : 
                  isGhost ? { label: 'Hardware Pending', className: 'status-offline', severity: 'info' as const } :
                  { label: tank.lastReading ? `Last Sync: ${formatTime(tank.lastReading)}` : 'Offline', className: 'status-offline', severity: 'ok' as const };

    // Calculate gauge rotation (0-180 degrees)
    const gaugeRotation = hasData ? (calculatedPercentage / 100) * 180 : 0;


    // Asset value configuration link
    const handleConfigurePrice = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigate(`/settings?tab=inventory&tankId=${tank.id}`);
    };

    // Calculated Asset Value logic
    const getAssetValue = () => {
        if (!reading && !tank.currentVolume) return '0.00';
        const retailPrice = (tank as any).metadata?.retailPrice;
        
        if (!retailPrice || retailPrice <= 0) {
            return (
                <button 
                    className="text-amber-500 hover:text-amber-600 font-extrabold text-[10px] underline underline-offset-2 animate-pulse"
                    onClick={handleConfigurePrice}
                    title="Price not set. Click to configure."
                >
                    N/A (SET PRICE)
                </button>
            );
        }

        const volume = reading ? (reading.volumeCorrected || reading.volume || 0) : (tank.currentVolume || 0);
        return (volume * retailPrice).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    return (
        <div 
            className={`tank-card ds-card ds-card-panel live-command-center hover:shadow-lg transition-all duration-300 !p-0 overflow-hidden flex flex-col ${isGhost ? 'opacity-90' : ''}`}
            onMouseEnter={() => setShowDetailedAnalytics(true)}
        >
            <div className="p-4 flex flex-col flex-1">
                <div className="tank-card-header-v2 flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <h3 className="tank-name">{tank.name}</h3>
                            {!isGhost && (
                                <div className="node-signal-container">
                                    {(() => {
                                        const isOffline = !reading || !reading.timestamp || (Date.now() - reading.timestamp) > 60 * 60 * 1000;
                                        const signalValue = isOffline ? 'Offline' : (reading.signalQuality || 'Fair');
                                        const scoreMap: Record<string, number> = { 'Excellent': 4, 'Good': 3, 'Fair': 2, 'Weak': 1, 'Unusable': 0 };
                                        const bars = typeof signalValue === 'number' ? Math.round(signalValue / 25) : (scoreMap[String(signalValue)] || 0);
                                        const signalState = isOffline ? 'offline' : 
                                                           (bars >= 3 ? 'optimal' : (bars >= 2 ? 'fair' : 'critical'));
                                        
                                        return (
                                            <div className={`node-signal-capsule state-${signalState}`}>
                                                <span className="status-label">{isOffline ? 'OFFLINE' : 'ONLINE'}</span>
                                                <div className="flex items-center gap-2 border-l border-white/20 pl-2">
                                                    <FiWifi size={14} className="signal-icon" />
                                                    <div className="signal-bars-enhanced">
                                                        {[1, 2, 3, 4].map(num => (
                                                            <div key={num} className={`bar-enhanced bar-step-${num} ${bars >= num ? 'filled' : ''}`} />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={`status-badge ${status.className}`}>
                        {status.label}
                    </div>
                </div>

                <div className="command-center-grid">
                    <div className="gauge-section relative flex flex-col items-center">
                        <svg className="fuel-gauge" viewBox="0 0 200 110">
                            <path
                                d="M 20 100 A 80 80 0 0 1 180 100"
                                fill="none"
                                stroke="var(--color-border)"
                                strokeWidth="10"
                                strokeLinecap="round"
                            />
                            {(reading || tank.currentVolume) && (
                                <path
                                    d="M 20 100 A 80 80 0 0 1 180 100"
                                    fill="none"
                                    stroke={
                                        calculatedPercentage >= 98
                                            ? '#ef4444' // Danger (Overfill)
                                            : calculatedPercentage >= 95
                                                ? '#f97316' // Warning (High)
                                                : calculatedPercentage <= 5
                                                    ? '#be123c' // Critical (Low-Low)
                                                    : calculatedPercentage <= 20
                                                        ? '#f59e0b' // Caution (Reorder)
                                                        : '#3b82f6' // Info (Nominal)
                                    }
                                    strokeWidth="10"
                                    strokeLinecap="round"
                                    strokeDasharray={`${(gaugeRotation / 180) * 251} 251`}
                                    className="gauge-arc"
                                />
                            )}
                            <text x="100" y="78" textAnchor="middle" className="gauge-value">
                                {hasData ? `${Math.round(calculatedPercentage)}%` : (isGhost ? '0%' : '0%')}
                            </text>
                        </svg>
                        
                        <div className="volume-placeholder-frame">
                            <button 
                                className={`volume-action-btn status-sync-${status.className}`}
                                onClick={handleCardClick}
                                disabled={isGhost}
                                title="Click to view detailed analytics"
                            >
                                {hasData ? formatVolume(reading ? (reading.volumeCorrected || reading.volume || 0) : (tank.currentVolume || 0)) : (isGhost ? '0 L' : '0 L')}
                            </button>
                        </div>
                    </div>

                    <div className="metrics-grid">
                        <div className={`metric-box ${
                            isGhost ? '' :
                            analytics.timeToOrderHrs === null ? '' :
                            (analytics.timeToOrderHrs < 0 ? 'metric-critical border-red-500 bg-red-50/10' :
                             analytics.timeToOrderHrs <= 24 ? 'metric-warning' : '')
                        }`}>
                            <div className="flex items-center gap-1.5">
                                <FiShoppingCart className={`text-secondary text-[10px] ${(!isGhost && analytics.timeToOrderHrs !== null && analytics.timeToOrderHrs <= 24) ? 'animate-pulse text-amber-500' : ''}`} />
                                <span className="metric-label">Reorder Point</span>
                            </div>
                            {(() => {
                                if (isGhost || analytics.timeToOrderHrs === null) {
                                    return <span className="metric-value text-slate-400">Stable</span>;
                                }
                                const daysRemaining = analytics.timeToOrderHrs / 24;
                                if (daysRemaining < 0) {
                                    const absDays = Math.abs(daysRemaining);
                                    const displayValue = absDays < 0.1 ? 'Overdue' : `${absDays.toFixed(1)} Days`;
                                    return (
                                        <div className="flex flex-col">
                                            <span className="metric-value text-rose-600 font-extrabold flex items-center gap-1">
                                                {displayValue}
                                            </span>
                                            <span className="text-[7.5px] font-black text-rose-500 uppercase tracking-tight leading-none mt-0.5 animate-pulse">
                                                Late! Fuel will arrive late
                                            </span>
                                        </div>
                                    );
                                }
                                return (
                                    <span className={`metric-value ${daysRemaining <= 1 ? 'text-amber-500 font-bold' : 'text-slate-600'}`}>
                                        {daysRemaining.toFixed(1)} Days
                                    </span>
                                );
                            })()}
                        </div>
                        <div className="metric-box">
                            <div className="flex items-center gap-1.5">
                                <FiAlertCircle className="text-secondary text-[10px]" />
                                <span className="metric-label">Leak Risk</span>
                            </div>
                            <span className={`metric-value ${(tank.leakProbability || 0) > 30 ? 'text-danger' :
                                (tank.leakProbability || 0) > 10 ? 'text-warning' : 'text-success'
                                }`}>
                                {isGhost ? '0%' : `${tank.leakProbability || 0}%`}
                            </span>
                        </div>
                        <div className="metric-box clickable" onClick={handleConfigurePrice}>
                            <div className="flex items-center gap-1.5">
                                <FiActivity className="text-secondary text-[10px]" />
                                <span className="metric-label">Value ({currency})</span>
                            </div>
                            <span className="metric-value">
                                {getAssetValue()}
                            </span>
                        </div>
                        <div className={`metric-box ${status.severity === 'critical' ? 'metric-critical' : status.severity === 'warning' ? 'metric-warning' : ''}`}>
                            <div className="flex items-center gap-1.5">
                                <FiClock className="text-secondary text-[10px]" />
                                <span className="metric-label">Until Empty</span>
                            </div>
                            <span className="metric-value">
                                {reading ? (analytics.ete !== 'Calculating...' && analytics.ete !== 'Stable' ? analytics.ete : '--') : (isGhost ? '0h' : '--')}
                            </span>
                        </div>
                        <div className="metric-box">
                            <div className="flex items-center gap-1.5">
                                <FiThermometer className="text-secondary text-[10px]" />
                                <span className="metric-label">Temp</span>
                            </div>
                            <span className="metric-value">
                                {reading?.temperature ? formatTemperature(reading.temperature) : (isGhost ? '0°C' : '--°C')}
                            </span>
                        </div>
                        <div className="metric-box">
                            <span className="metric-label">Dispense Rate</span>
                            <span className="metric-value">
                                {isGhost ? '0.0 L/hr' : `${analytics.defillRate.toFixed(1)} L/hr`}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="command-footer">
                    <div className="last-update">
                        <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Sensor Connection</span>
                        <div className="flex items-center gap-2 mt-1">
                            {(() => {
                                const timeStr = reading ? formatTime(reading.timestamp) : (tank.lastReading ? formatTime(tank.lastReading) : (isGhost ? 'Waiting...' : 'Never'));
                                const isLive = timeStr === 'Live Sync';
                                return (
                                    <span className={`last-update-tag ${isLive ? 'text-emerald-400 font-bold' : ''}`}>
                                        {timeStr}
                                    </span>
                                );
                            })()}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button 
                            className="view-details-btn-premium"
                            onClick={handleCardClick}
                            disabled={isGhost}
                            title="Interactive Analytics"
                        >
                            <FiActivity size={14} />
                            View Details
                        </button>

                        <button
                            className={`force-sync-btn-modern ${isSyncing ? 'syncing' : ''}`}
                            onClick={handleSync}
                            disabled={isSyncing || isGhost}
                            title={isGhost ? "Hardware Needed" : "Force Telemetry Refresh"}
                        >
                            <div className="btn-glow" />
                            <FiRefreshCw className="sync-icon" />
                            <span className="btn-text">SYNC</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* ── SECURE DELETION MODAL ─────────────────────────────────────── */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
                    <div className="glass-panel max-w-md w-full !p-8 border border-rose-500/30 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3 text-rose-500">
                                <FiShield className="text-2xl" />
                                <h3 className="text-xl font-black uppercase tracking-tighter">Secure Purge Protocol</h3>
                            </div>
                            <button onClick={() => setShowDeleteModal(false)} className="text-secondary hover:text-white" title="Close">
                                <FiX size={20} />
                            </button>
                        </div>

                        <div className="bg-rose-500/10 border-l-4 border-rose-500 p-4 mb-6">
                            <p className="text-sm text-rose-200 leading-relaxed">
                                <strong className="text-rose-500 uppercase">Warning:</strong> You are about to permanently delete 
                                <span className="font-bold text-white px-1">{tank.name}</span> 
                                and all its historical telemetry data from the governance database. This action is <strong className="underline">irreversible</strong>.
                            </p>
                        </div>

                        <form onSubmit={handleDelete} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Administrator Clearance</label>
                                <div className="relative">
                                    <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
                                    <input 
                                        type="password"
                                        placeholder="Enter Settings Password"
                                        className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:border-rose-500 outline-none transition-all"
                                        value={deletePassword}
                                        onChange={(e) => setDeletePassword(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                                {deleteError && (
                                    <p className="text-xs text-rose-500 font-bold mt-2 animate-pulse">{deleteError}</p>
                                )}
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button 
                                    type="button"
                                    onClick={() => setShowDeleteModal(false)}
                                    className="flex-1 py-3 font-bold text-secondary hover:text-white transition-colors"
                                >
                                    ABORT
                                </button>
                                <button 
                                    type="submit"
                                    disabled={isDeleting || !deletePassword}
                                    className="flex-[2] bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black py-3 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-900/20"
                                >
                                    {isDeleting ? (
                                        <>
                                            <FiRefreshCw className="animate-spin" />
                                            PURGING...
                                        </>
                                    ) : (
                                        <>
                                            <FiTrash2 />
                                            CONFIRM PURGE
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
});

// Fix for react/display-name linter violation
TankCard.displayName = 'TankCard';
