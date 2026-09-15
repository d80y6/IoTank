import React, { useState } from 'react';
import { Tank, TankReading } from '@/types';
import { useHistoricalReadings } from '@/hooks/useSupabase';
import { useConsumptionAnalytics } from '@/hooks/useConsumptionAnalytics';
import { TankVisual2D } from '../Common/TankVisual2D';
import { FiActivity, FiDownload, FiShare2, FiRefreshCw, FiChevronDown } from 'react-icons/fi';
import { formatVolume } from '@/utils/formatUtils';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Area } from 'recharts';

import { exportToCSV } from '@/utils/exportUtils';
import { SensorHealthSection } from './SensorHealthSection';
import { PredictivePanel } from '../Analytics/PredictivePanel';
import { WetstockReconciliation } from '../Analytics/WetstockReconciliation';
import { CalibrationWizard } from './CalibrationWizard';
import { useActiveShift } from '@/hooks/useShifts';
import { useShiftStatus } from '@/hooks/useShiftStatus';
import { useModals } from '@/contexts/ModalContext';
import { Toast } from '../Common/Toast';
import './TankDetailsView.css';

interface TankDetailsViewProps {
    tank: Tank;
    stationId: string;
    tanks: Tank[];
    transactions: any[];
}

export const TankDetailsView: React.FC<TankDetailsViewProps> = ({
    tank,
    stationId,
    tanks,
    transactions,
}) => {
    const [timeDomain, setTimeDomain] = useState<'shift' | 'week' | 'month'>('week');
    const [intelligenceType, setIntelligenceType] = useState('Historical Level Intelligence');
    const [showIntelligenceDropdown, setShowIntelligenceDropdown] = useState(false);
    const { status: shiftStatus, openedAt } = useShiftStatus();
    const { activeShift } = useActiveShift(stationId);
    const { openModal } = useModals();
    const [toast, setToast] = useState<{ 
        message: string, 
        type: 'info' | 'warning' | 'success' | 'error',
        actionLabel?: string,
        onAction?: () => void
    } | null>(null);
    const [isCalibrationWizardOpen, setIsCalibrationWizardOpen] = useState(false);
    const isGhost = tank.id === 'ghost-tank';

    const fillPercent = tank.capacity ? Math.round(((tank.currentVolume || 0) / tank.capacity) * 10000) / 100 : 0;

    // Status classification with expanded Amethyst logic
    let statusLabel = tank.currentState ? tank.currentState.replace('_', ' ').toUpperCase() : 'NORMAL';
    let statusClass = 'status-normal';

    if (isGhost) {
        statusLabel = 'HARDWARE LINK PENDING';
        statusClass = 'status-low';
    } else if (tank.currentState === 'leak_suspicion' || (tank.leakProbability || 0) > 50) {
        statusLabel = 'LEAK SUSPICION';
        statusClass = 'status-critical';
    } else if (tank.currentState === 'delivery') {
        statusLabel = 'DELIVERY IN PROGRESS';
        statusClass = 'status-delivery';
    } else if (tank.currentState === 'dispensing') {
        statusLabel = 'DISPENSING';
        statusClass = 'status-dispensing';
    } else if (fillPercent < 15) {
        statusLabel = 'CRITICAL LOW LEVEL';
        statusClass = 'status-critical';
    } else if (fillPercent < 30) {
        statusLabel = 'LOW LEVEL WARNING';
        statusClass = 'status-low';
    }

    const timeRange = React.useMemo(() => {
        const now = Date.now();
        switch (timeDomain) {
            case 'week': return { start: now - 7 * 24 * 60 * 60 * 1000, end: now };
            case 'month': return { start: now - 30 * 24 * 60 * 60 * 1000, end: now };
            case 'shift':
            default: return { start: openedAt || (now - 8 * 60 * 60 * 1000), end: now };
        }
    }, [timeDomain, openedAt]);

    const { readings } = useHistoricalReadings(stationId, tank.id, timeRange);
    
    // Continuity logic: If sensor is disconnected, show a straight line to current time
    const chartReadings = React.useMemo(() => {
        if (readings.length === 0) return [];
        const latest = readings[readings.length - 1];
        const now = Date.now();
        // If latest reading is more than 5 minutes old, extend to 'now'
        if (now - latest.timestamp > 300000) {
            return [...readings, { ...latest, timestamp: now }];
        }
        return readings;
    }, [readings]);

    const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
    const analytics = useConsumptionAnalytics(tank, readings);

    const [exporting, setExporting] = useState<'download' | 'share' | null>(null);


    const handleExport = async (type: 'download' | 'share') => {
        if (shiftStatus !== 'open') {
            setToast({
                message: 'No active shift found. Please start a shift first.',
                type: 'warning',
                actionLabel: 'Start New Shift',
                onAction: () => openModal('shift-open')
            });
            return;
        }
        setExporting(type);
        if (type === 'download') {
            exportToCSV(readings, `${tank.name}_Telemetry_${new Date().toISOString().split('T')[0]}`);
        } else {
            await new Promise(resolve => setTimeout(resolve, 800));
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Report Shared',
                    message: 'Report shared with authorized site personnel.',
                    type: 'success',
                    attribution: 'REPORT EXPORT'
                }
            }));
        }
        setExporting(null);
    };



    return (
        <div className="tank-details-view animate-fade-in">
            {/* Header Area */}
            <div className="tdv-header">
                <div>
                    <div className="flex items-center gap-3">
                        <h2>{tank.name}</h2>
                        <span className="badge-fuel-type">{tank.fuelType}</span>
                    </div>
                    <div className="telemetry-meta flex items-center gap-4 mt-2">
                        <div className={`status-pill ${statusClass}`}>
                            <span className="dot"></span>
                            {statusLabel}
                        </div>
                        <div className={`sync-status flex items-center gap-2.5 text-xs font-medium ${!tank.lastReading ? 'sync-waiting' : 'text-slate-400'}`}>
                            <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-white border border-slate-100 shadow-sm">
                                {tank.lastReading ? <FiActivity size={12} className="text-purple-500" /> : <FiRefreshCw size={12} className="sync-spinner text-purple-600" />}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="opacity-40">Sync</span>
                                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                <span className={!tank.lastReading ? 'text-purple-600' : ''}>
                                    {tank.lastReading ? new Date(tank.lastReading).toLocaleTimeString() : 'Establishing Link...'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="header-actions">
                    <button
                        className="btn-icon"
                        title="Download Data"
                        onClick={() => handleExport('download')}
                        disabled={exporting !== null}
                    >
                        {exporting === 'download' ? <FiRefreshCw className="animate-spin" /> : <FiDownload />}
                    </button>
                    <button
                        className="btn-icon"
                        title="Share Report"
                        onClick={() => handleExport('share')}
                        disabled={exporting !== null}
                    >
                        {exporting === 'share' ? <FiRefreshCw className="animate-spin" /> : <FiShare2 />}
                    </button>
                </div>
            </div>



            <div className="tdv-content">
                <div className="visual-tab">
                        <div className="visual-grid">
                            <div className="visual-main">
                                <TankVisual2D
                                    fuelLevel={fillPercent}
                                    fuelType={tank.fuelType}
                                    shape={tank.shape}
                                    height={tank.height}
                                    diameter={tank.diameter}
                                    length={tank.length}
                                />
                            </div>
                            <div className="visual-right-col">
                                <div className="visual-stats">
                                    <div className="stat-card">
                                        <span className="stat-label">Corrected Inventory</span>
                                        <span className="stat-value">{isGhost ? '0 L' : formatVolume(tank.currentVolume || latestReading?.volumeCorrected || 0)}</span>
                                        <div className="flex justify-between border-t border-slate-100 mt-3 pt-3">
                                            <div className="mini-metric">
                                                <span className="mini-label">Capacity</span>
                                                <span className="mini-value">{isGhost ? '0' : tank.capacity.toLocaleString()} L</span>
                                            </div>
                                            <div className="mini-metric text-right">
                                                <span className="mini-label">Empty Space</span>
                                                <span className="mini-value text-primary">{isGhost ? '0' : Math.round(tank.capacity - (tank.currentVolume || 0)).toLocaleString()} L</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="stat-card">
                                        <span className="stat-label">Dispense Rate</span>
                                        <span className="stat-value">{isGhost ? '0.0' : analytics.defillRate.toFixed(2)} L/hr</span>
                                        <span className={`stat-trend ${analytics.isTheftSuspected ? 'text-red-500' : 'text-gray-400'}`}>
                                            {isGhost ? '—' : (analytics.isTheftSuspected ? 'Rapid loss detected' : `Trend: ${analytics.trend.charAt(0).toUpperCase() + analytics.trend.slice(1)}`)}
                                        </span>
                                    </div>
                                    <div className="stat-card">
                                        <span className="stat-label">Integrity Index (CSLD)</span>
                                        <span className={`stat-value ${!isGhost && (tank.leakProbability || 0) > 20 ? 'text-red-500' : 'text-emerald-500'}`}>
                                            {isGhost ? '0%' : `${parseFloat((tank.leakProbability || 0).toFixed(2))}%`}
                                        </span>
                                        <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div 
                                                className={`progress-bar-fill-dynamic ${!isGhost && (tank.leakProbability || 0) > 20 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                                                ref={(el) => { if (el) el.style.width = `${isGhost ? 0 : (tank.leakProbability || 0)}%`; }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                                <SensorHealthSection 
                                    latestReading={latestReading} 
                                    onCalibrate={() => setIsCalibrationWizardOpen(true)}
                                />
                            </div>
                        </div>


                        {/* Historical Level Trend */}
                        <div className="live-trends mt-4">
                            <div className="flex justify-between items-center mb-6">
                                <div className="intelligence-selector-container">
                                    <button 
                                        className="intelligence-dropdown-trigger flex items-center gap-2"
                                        onClick={() => setShowIntelligenceDropdown(!showIntelligenceDropdown)}
                                    >
                                        <h3>{intelligenceType}</h3>
                                        <FiChevronDown className={`transition-transform ${showIntelligenceDropdown ? 'rotate-180' : ''}`} />
                                    </button>
                                    
                                    {showIntelligenceDropdown && (
                                        <div className="intelligence-menu animate-fade-in">
                                            {['Historical Level Intelligence', 'Predictive Analysis', 'Leak Diagnostics'].map((type) => (
                                                <div 
                                                    key={type}
                                                    className={`intelligence-option ${intelligenceType === type ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setIntelligenceType(type);
                                                        setShowIntelligenceDropdown(false);
                                                    }}
                                                >
                                                    {type}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="time-domain-toggles flex gap-1 bg-slate-100 p-1 rounded-lg shadow-inner">
                                    {[
                                        { id: 'shift', label: 'Shift' },
                                        { id: 'week', label: '7 Days' },
                                        { id: 'month', label: '30 Days' }
                                    ].map((d) => (
                                        <button
                                            key={d.id}
                                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${timeDomain === d.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                            onClick={() => setTimeDomain(d.id as any)}
                                        >
                                            {d.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Intelligence Content Area */}
                            <div className="intelligence-content-area min-h-[400px]">
                                {intelligenceType === 'Historical Level Intelligence' && (
                                    <div className="live-trends-chart-container">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart
                                                data={chartReadings}
                                                margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
                                            >
                                                <defs>
                                                    <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.1} />
                                                        <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.03)" vertical={false} />
                                                <XAxis
                                                    dataKey="timestamp"
                                                    tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    stroke="var(--color-text-disabled)"
                                                    fontSize={10}
                                                    tickLine={false}
                                                    axisLine={false}
                                                    dy={10}
                                                />
                                                <YAxis
                                                    stroke="var(--color-text-disabled)"
                                                    fontSize={10}
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tickFormatter={(val) => `${val.toLocaleString()}L`}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        background: 'rgba(255, 255, 255, 0.95)',
                                                        border: 'none',
                                                        borderRadius: '12px',
                                                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                                                        fontSize: '12px',
                                                        fontWeight: '600'
                                                    }}
                                                    formatter={(value: number) => [`${value.toLocaleString()} L`, 'Volume']}
                                                    labelFormatter={(label) => new Date(label).toLocaleString()}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="volumeCorrected"
                                                    stroke="none"
                                                    fill="url(#colorVolume)"
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="volumeCorrected"
                                                    stroke="#7c3aed"
                                                    strokeWidth={3}
                                                    dot={false}
                                                    activeDot={{ r: 6, strokeWidth: 0, fill: '#7c3aed' }}
                                                    animationDuration={1500}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {intelligenceType === 'Predictive Analysis' && (
                                    <div className="animate-fade-in p-4">
                                        <PredictivePanel stationId={stationId} tankId={tank.id} />
                                    </div>
                                )}

                                {intelligenceType === 'Leak Diagnostics' && (
                                    <div className="animate-fade-in p-4 space-y-6">
                                        <WetstockReconciliation 
                                            tanks={tanks} 
                                            transactions={transactions} 
                                            currency="Ksh" 
                                            activeShift={activeShift}
                                        />
                                        <div className="h-px bg-slate-100 my-8" />
                                    </div>
                                )}
                            </div>
                        </div>


                            {/* Historical Telemetry Section (Volume vs Time) */}
                            <div className="tdv-section-card mt-6">
                                <div className="section-header flex items-center justify-between p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="section-icon-box">
                                            <FiActivity className="text-primary" />
                                        </div>
                                        <h3 className="section-title">Historical Telemetry</h3>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                        Last {readings.length} data points
                                    </div>
                                </div>
                                <div className="table-responsive">
                                    <table className="tdv-transaction-table">
                                        <thead>
                                            <tr>
                                                <th>Timestamp</th>
                                                <th>Volume (L)</th>
                                                <th>Temperature</th>
                                                <th>Level %</th>
                                                <th>Var (L)</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {readings.slice(0, 10).reverse().map((reading: TankReading) => (
                                                <tr key={reading.timestamp}>
                                                    <td className="font-mono text-xs">{new Date(reading.timestamp).toLocaleString()}</td>
                                                    <td className="font-medium">{reading.volumeCorrected?.toLocaleString() || reading.volume?.toLocaleString()} L</td>
                                                    <td>{reading.temperature.toFixed(2)}°C</td>
                                                    <td>
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div 
                                                                    className={`progress-bar-fill-dynamic ${reading.fuelLevel < 20 ? 'bg-red-500' : 'bg-primary'}`} 
                                                                    ref={(el) => { if (el) el.style.width = `${Math.min(reading.fuelLevel, 100).toFixed(2)}%`; }}
                                                                ></div>
                                                            </div>
                                                            {parseFloat(reading.fuelLevel.toFixed(2))}%
                                                        </div>
                                                    </td>
                                                    <td className={Math.abs(reading.volumeCorrected - reading.volume) > 5 ? 'text-red-500 font-medium' : 'text-slate-400'}>
                                                        {(reading.volumeCorrected - (reading.volume || 0)).toFixed(2)}
                                                    </td>
                                                    <td>
                                                        <span className={`status-pill ${reading.fuelLevel < 20 ? 'status-critical' : 'status-normal'}`}>
                                                            <span className="dot"></span>
                                                            {reading.fuelLevel < 20 ? 'LOW' : 'STABLE'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {readings.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="text-center py-8 text-slate-400 font-medium">No historical telemetry available for this period.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                    </div>
                </div>
            {toast && (
                <Toast 
                    message={toast.message} 
                    type={toast.type} 
                    actionLabel={toast.actionLabel}
                    onAction={toast.onAction}
                    onClose={() => setToast(null)} 
                />
            )}
            {isCalibrationWizardOpen && (
                <CalibrationWizard 
                    isOpen={isCalibrationWizardOpen}
                    onClose={() => setIsCalibrationWizardOpen(false)}
                    tank={tank}
                />
            )}
        </div>
    );
};
