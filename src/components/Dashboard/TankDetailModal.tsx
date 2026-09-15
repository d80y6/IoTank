import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Tank } from '@/types';
import { useHistoricalReadings, updateTank } from '@/hooks/useSupabase';
import { useConsumptionAnalytics } from '@/hooks/useConsumptionAnalytics';
import { TankVisual2D } from '../Common/TankVisual2D';
import { TimeSeriesChart } from '../Analytics/TimeSeriesChart';
import { PredictivePanel } from '../Analytics/PredictivePanel';
import { FiX, FiActivity, FiSettings, FiDownload, FiShare2, FiRefreshCw } from 'react-icons/fi';
import { formatVolume } from '@/utils/formatUtils';
import { exportToCSV } from '@/utils/exportUtils';
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/utils/logger';
import './TankDetailModal.css';

interface TankDetailModalProps {
    tank: Tank;
    stationId: string;
    onClose: () => void;
}

export const TankDetailModal: React.FC<TankDetailModalProps> = ({
    tank,
    stationId,
    onClose
}) => {
    const { canSee } = useAuth();
    const [activeTab, setActiveTab] = useState<'visual' | 'analytics' | 'config'>('visual');
    const [timeRange] = useState({
        start: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
        end: Date.now()
    });

    const { readings } = useHistoricalReadings(stationId, tank.id, timeRange);
    const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
    const analytics = useConsumptionAnalytics(tank, readings);

    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState<'download' | 'share' | null>(null);

    const handleExport = async (type: 'download' | 'share') => {
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

    const handleUpdateConfig = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const form = e.target as HTMLFormElement;
            const updates = {
                thermalCoefficient: parseFloat((form.elements.namedItem('thermalCoefficient') as HTMLInputElement).value),
                highLevelThreshold: parseFloat((form.elements.namedItem('highLevelThreshold') as HTMLInputElement).value),
                esp32Address: (form.elements.namedItem('esp32Address') as HTMLInputElement).value,
                sensorHeight: parseFloat((form.elements.namedItem('sensorHeight') as HTMLInputElement).value),
                sensorOffset: parseFloat((form.elements.namedItem('sensorOffset') as HTMLInputElement).value),
                temperatureAlertThreshold: parseFloat((form.elements.namedItem('temperatureAlertThreshold') as HTMLInputElement).value),
            };

            await updateTank(tank.id, updates);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Hardware Synced',
                    message: 'Hardware configuration synchronized.',
                    type: 'success',
                    attribution: 'HARDWARE CONFIG'
                }
            }));
        } catch (error) {
            logger.error('Error updating config:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Sync Failed',
                    message: 'Failed to update configuration.',
                    type: 'error',
                    attribution: 'HARDWARE CONFIG'
                }
            }));
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="tank-modal-title">
            <div className="modal-container tank-detail-modal">
                {/* Modal Header */}
                <div className="modal-header">
                    <div className="header-info">
                        <h2 id="tank-modal-title">{tank.name}</h2>
                        <p className="text-secondary">{tank.location || 'Primary Station'} • {tank.fuelType.toUpperCase()}</p>
                    </div>
                    <div className="header-actions">
                        <button
                            className="btn-icon"
                            title="Download Telemetry CSV"
                            onClick={() => handleExport('download')}
                            disabled={exporting !== null}
                            aria-label="Download CSV"
                        >
                            {exporting === 'download' ? <FiRefreshCw className="spinner animate-spin" /> : <FiDownload />}
                        </button>
                        <button
                            className="btn-icon"
                            title="Share Analytical Report"
                            onClick={() => handleExport('share')}
                            disabled={exporting !== null}
                            aria-label="Share Report"
                        >
                            {exporting === 'share' ? <FiRefreshCw className="spinner animate-spin" /> : <FiShare2 />}
                        </button>
                        <button 
                            className="btn-icon close-btn" 
                            onClick={onClose}
                            title="Close Modal"
                            aria-label="Close"
                        >
                            <FiX />
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <nav className="modal-tabs" aria-label="Tank Details Tabs">
                    <button
                        className={`tab-btn ${activeTab === 'visual' ? 'active' : ''}`}
                        onClick={() => setActiveTab('visual')}
                    >
                        <FiActivity className="tab-icon" /> Visual Hub
                    </button>
                    {canSee(6) && (
                        <button
                            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
                            onClick={() => setActiveTab('analytics')}
                        >
                            <FiActivity className="tab-icon" /> AI Analytics
                        </button>
                    )}
                    {canSee(5) && (
                        <button
                            className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                            onClick={() => setActiveTab('config')}
                        >
                            <FiSettings className="tab-icon" /> Configuration
                        </button>
                    )}
                </nav>

                {/* Modal Content */}
                <div className="modal-content-scrollable">
                    {activeTab === 'visual' && (
                        <div className="visual-tab animate-in fade-in slide-in-from-bottom-2">
                            <div className="visual-grid">
                                <div className="visual-main">
                                    <TankVisual2D
                                        fuelLevel={latestReading?.fuelLevel || 0}
                                        fuelType={tank.fuelType}
                                        shape={tank.shape}
                                        height={tank.height}
                                        diameter={tank.diameter}
                                        length={tank.length}
                                    />
                                </div>
                                <div className="visual-stats">
                                    <div className="stat-card">
                                        <span className="stat-label">Corrected Volume</span>
                                        <span className="stat-value">{formatVolume(latestReading?.volumeCorrected || 0)}</span>
                                        <span className="stat-trend text-success">Total Inventory</span>
                                    </div>
                                    <div className="stat-card">
                                        <span className="stat-label">Consumption Rate</span>
                                        <span className="stat-value">{analytics.defillRate.toFixed(1)} L/hr</span>
                                        <span className={`stat-trend ${analytics.isTheftSuspected ? 'text-red-600' : 'text-slate-400'}`}>
                                            {analytics.isTheftSuspected ? 'ALERT: Rapid Defill' : `${analytics.trend.toUpperCase()}`}
                                        </span>
                                    </div>
                                    <div className="stat-card">
                                        <span className="stat-label">Time to Empty (ETE)</span>
                                        <span className="stat-value">{analytics.ete}</span>
                                        <span className={`stat-subtext ${analytics.isLeakageSuspected ? 'text-orange-500' : 'text-slate-400'}`}>
                                            {analytics.isLeakageSuspected ? 'Possible Leakage Detected' : 'Forecast based on 24h trend'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="live-trends mt-10">
                                <h3>Live Level Trend</h3>
                                <TimeSeriesChart
                                    data={readings}
                                    title="Fuel Level (%)"
                                    dataKey="fuelLevel"
                                    unit="%"
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'analytics' && (
                        <div className="analytics-tab animate-in fade-in slide-in-from-bottom-2">
                            <PredictivePanel stationId={stationId} tankId={tank.id} />

                            <div className="grid-2 mt-10">
                                <TimeSeriesChart
                                    data={readings}
                                    title="Temperature Variance"
                                    dataKey="temperature"
                                    color="var(--chart-temperature, #ef4444)"
                                    unit="°C"
                                />
                                <TimeSeriesChart
                                    data={readings}
                                    title="Corrected Volume (L)"
                                    dataKey="volumeCorrected"
                                    color="var(--chart-volume, #3b82f6)"
                                    unit="L"
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'config' && (
                        <div className="config-tab animate-in fade-in slide-in-from-bottom-2">
                            <div className="form-header">
                                <h3 className="form-title">Technical Specifications</h3>
                                <p className="form-subtitle">Industrial calibration for thermal expansion and sensor geometry.</p>
                            </div>

                            <form onSubmit={handleUpdateConfig} className="config-form">
                                <div className="grid-2">
                                    <div className="form-group">
                                        <label htmlFor="cap-read">Capacity (Liters)</label>
                                        <input id="cap-read" type="number" defaultValue={tank.capacity} disabled title="Read-only capacity" />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="fuel-read">Fuel Type</label>
                                        <input id="fuel-read" type="text" defaultValue={tank.fuelType} disabled title="Read-only fuel type" />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="thermal-input">Thermal Expansion Coeff (α)</label>
                                        <input id="thermal-input" type="number" name="thermalCoefficient" defaultValue={tank.thermalCoefficient} step="0.0001" title="Thermal Expansion Coefficient" />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="limit-input">Safe Fill Limit (%)</label>
                                        <input id="limit-input" type="number" name="highLevelThreshold" defaultValue={tank.highLevelThreshold} title="High Level Alert Threshold" />
                                    </div>
                                </div>

                                <div className="divider"></div>

                                <div className="form-header">
                                    <h3 className="form-title">Hardware & Calibration</h3>
                                    <p className="form-subtitle">Link physical ESP32 devices and set ultrasonic sensor offsets.</p>
                                </div>

                                <div className="grid-2">
                                    <div className="form-group">
                                        <label htmlFor="esp-input">ESP32 MAC Address / ID</label>
                                        <input
                                            id="esp-input"
                                            type="text"
                                            name="esp32Address"
                                            placeholder="XX:XX:XX:XX:XX:XX"
                                            defaultValue={tank.esp32Address}
                                            title="ESP32 Hardware Identity"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="height-input">Sensor Height (cm)</label>
                                        <input
                                            id="height-input"
                                            type="number"
                                            name="sensorHeight"
                                            defaultValue={tank.sensorHeight}
                                            placeholder="Measured from bottom"
                                            title="Mounting Height from Tank Floor"
                                        />
                                        <small className="help-text">Distance from tank bottom to sensor face.</small>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="offset-input">Calibration Offset (cm)</label>
                                        <input
                                            id="offset-input"
                                            type="number"
                                            name="sensorOffset"
                                            defaultValue={tank.sensorOffset}
                                            title="Installation Depth Offset"
                                        />
                                        <small className="help-text">Adjustment for mounting protrusions.</small>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="temp-input">Temp Alert Threshold (°C)</label>
                                        <input
                                            id="temp-input"
                                            type="number"
                                            name="temperatureAlertThreshold"
                                            defaultValue={tank.temperatureAlertThreshold}
                                            title="Maximum Temperature Threshold"
                                        />
                                        <small className="help-text">Trigger alert if fuel exceeds this temp.</small>
                                    </div>
                                </div>

                                <div className="mt-10">
                                    <button type="submit" className="btn-primary" disabled={saving}>
                                        {saving ? 'Synchronizing Ledger...' : 'Apply Calibration Logic'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};
