import React from 'react';
import { FiActivity, FiZap, FiShield, FiAlertCircle, FiWifi } from 'react-icons/fi';
import { TankReading } from '@/types';

interface SensorHealthSectionProps {
    latestReading: TankReading | null;
    onCalibrate?: () => void;
}

interface MetricCardProps {
    label: string;
    value: string | number;
    unit?: string;
    badge: string;
    badgeColor: 'green' | 'amber' | 'purple' | 'blue';
    icon: React.ReactNode;
    bar?: number; // 0-100
    barColor?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit, badge, badgeColor, icon, bar, barColor }) => {
    const badgeCls = {
        green:  'bg-emerald-50 text-emerald-600 border-emerald-100',
        amber:  'bg-amber-50 text-amber-600 border-amber-100',
        purple: 'bg-violet-50 text-violet-600 border-violet-100',
        blue:   'bg-sky-50 text-sky-600 border-sky-100',
    }[badgeColor];

    const dotCls = {
        green:  'bg-emerald-400',
        amber:  'bg-amber-400',
        purple: 'bg-violet-400',
        blue:   'bg-sky-400',
    }[badgeColor];

    return (
        <div className="sh-metric-card">
            {/* Header row */}
            <div className="sh-metric-header">
                <div className="sh-metric-icon">
                    {icon}
                </div>
                <span className={`sh-metric-badge ${badgeCls}`}>
                    <span className={`sh-badge-dot ${dotCls}`}></span>
                    {badge}
                </span>
            </div>

            {/* Value */}
            <div className="sh-metric-value-row">
                <span className="sh-metric-value">{value}</span>
                {unit && <span className="sh-metric-unit">{unit}</span>}
            </div>

            {/* Label */}
            <div className="sh-metric-label">{label}</div>

            {/* Optional progress bar */}
            {bar !== undefined && (
                <div className="sh-metric-bar-track">
                    <div
                        className="sh-metric-bar-fill"
                        style={{ width: `${Math.min(bar, 100)}%`, background: barColor || '#10b981' }}
                    />
                </div>
            )}
        </div>
    );
};

export const SensorHealthSection: React.FC<SensorHealthSectionProps> = ({ latestReading, onCalibrate }) => {
    const health = latestReading?.metadata;
    const drift = health?.sensorDrift ?? 0.4;
    const signal = health?.echoSignalStrength ?? 92;
    const noise = health?.noiseLevel ?? 12;

    return (
        <div className="sh-card">
            {/* Card Header */}
            <div className="sh-card-header">
                <div className="sh-card-title-group">
                    <div className="sh-card-icon-wrap">
                        <FiShield size={14} />
                    </div>
                    <div>
                        <div className="sh-card-title">Sensor Health Diagnostics</div>
                        <div className="sh-card-subtitle">Real-time telemetry verification</div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors border border-slate-200 flex items-center gap-2"
                        onClick={onCalibrate}
                    >
                        <FiZap size={10} className="text-amber-500" />
                        Run Calibration
                    </button>
                    <div className="sh-live-pill">
                        <span className="sh-live-dot"></span>
                        Active
                    </div>
                </div>
            </div>

            {/* 4-column metrics grid */}
            <div className="sh-metrics-grid">
                <MetricCard
                    label="Echo Signal Strength"
                    value={signal}
                    unit="%"
                    badge="Optimal"
                    badgeColor="green"
                    icon={<FiActivity size={13} />}
                    bar={signal}
                    barColor="linear-gradient(90deg,#10b981,#34d399)"
                />
                <MetricCard
                    label="Sensor Noise Level"
                    value={noise}
                    unit="dB"
                    badge="Signal-to-Noise"
                    badgeColor="purple"
                    icon={<FiZap size={13} />}
                />
                <MetricCard
                    label="Estimated Sensor Drift"
                    value={drift}
                    unit="%"
                    badge={drift > 2 ? 'Recalibrate' : 'Stable'}
                    badgeColor={drift > 2 ? 'amber' : 'green'}
                    icon={<FiWifi size={13} />}
                />
                <MetricCard
                    label="Telemetry Integrity"
                    value={signal}
                    unit="%"
                    badge="LIVE SIGNAL"
                    badgeColor="blue"
                    icon={<FiShield size={13} />}
                    bar={signal}
                    barColor="linear-gradient(90deg,#7c3aed,#a855f7)"
                />
            </div>

            {/* Alert strip */}
            {drift > 5 && (
                <div className="sh-alert-strip">
                    <FiAlertCircle size={15} className="sh-alert-icon" />
                    <p><strong>Drift Warning:</strong> Sensor accuracy has deviated by {drift}%. Recalibration recommended.</p>
                </div>
            )}
        </div>
    );
};
