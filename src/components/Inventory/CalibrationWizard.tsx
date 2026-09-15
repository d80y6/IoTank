import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiCheckCircle, FiInfo, FiRefreshCw, FiTarget, FiZap, FiDatabase } from 'react-icons/fi';
import { supabase } from '@/config/supabase';
import { Tank } from '@/types';
import { AuditService } from '@/services/AuditService';
import { NotificationService } from '@/services/NotificationService';
import { validateUUID } from '@/utils/sanitization';
import './CalibrationWizard.css';

interface CalibrationWizardProps {
    isOpen: boolean;
    onClose: () => void;
    tank: Tank;
    onSuccess?: () => void;
}

export const CalibrationWizard: React.FC<CalibrationWizardProps> = ({ isOpen, onClose, tank, onSuccess }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [measuredLevelMm, setMeasuredLevelMm] = useState<string>('');
    const [calculating, setCalculating] = useState(false);
    const [applying, setApplying] = useState(false);
    
    // Result state
    const [newOffset, setNewOffset] = useState<number | null>(null);

    const [currentRawDistance, setCurrentRawDistance] = useState<number | null>(null);

    // Fetch live raw distance from latest reading via Realtime Subscription
    useEffect(() => {
        if (!isOpen) return;

        const fetchLiveRaw = async () => {
            if (!validateUUID(tank.id)) return;
            const { data } = await supabase
                .from('sensor_readings')
                .select('raw_distance')
                .eq('tank_id', tank.id)
                .order('captured_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            
            if (data) setCurrentRawDistance(data.raw_distance);
        };

        fetchLiveRaw();
        if (!validateUUID(tank.id)) return;

        // Establish real-time forensic handshake for ultra-low latency
        const channel = supabase
            .channel(`raw-telemetry-${tank.id}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'sensor_readings', 
                filter: `tank_id=eq.${tank.id}` 
            }, (payload) => {
                if (payload.new && payload.new.raw_distance) {
                    setCurrentRawDistance(payload.new.raw_distance);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [isOpen, tank.id]);

    if (!isOpen) return null;

    const handleCalculate = async () => {
        if (!measuredLevelMm || !currentRawDistance) return;

        // GUARD: tank.height must exist and be a valid positive number
        if (!tank.height || tank.height <= 0) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Configuration Required',
                    message: 'Tank height is not configured. Set it in Settings before calibrating.',
                    type: 'warning',
                    attribution: 'CALIBRATION WIZARD'
                }
            }));
            return;
        }

        setCalculating(true);
        
        // Forensic Calibration Formula:
        // tank.height is stored in METERS in the database.
        // All calculations are performed in MILLIMETERS (mm).
        //
        // tankHeightMm  = tank height in mm (meters × 1000)
        // actualGapMm   = distance from sensor to fuel surface (measured dead gap)
        //               = tankHeightMm - measuredFuelLevelMm
        // calculatedOffset = rawSensorReading - actualGapMm
        //   (The offset corrects for the sensor's dead zone at the bottom of the tank)
        
        const tankHeightMm = tank.height * 1000; // Convert meters → mm
        const measuredFuelLevelMm = parseFloat(measuredLevelMm);
        const actualGapMm = tankHeightMm - measuredFuelLevelMm;
        const calculatedOffset = currentRawDistance - actualGapMm;
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        setNewOffset(calculatedOffset);
        setCalculating(false);
        setStep(2);
    };

    const handleApply = async () => {
        if (newOffset === null) return;
        setApplying(true);

        try {
            const previousOffset = tank.sensorOffset ?? 0;

            const { error } = await supabase
                .from('tanks')
                .update({
                    sensor_offset: newOffset,
                    last_calibration_date: new Date().toISOString().split('T')[0],
                    updated_at: new Date().toISOString()
                })
                .eq('id', tank.id);

            if (error) throw error;

            // FORENSIC AUDIT: Log calibration event to unified_events for full traceability
            await AuditService.log(
                'CALIBRATION',
                'CALIBRATION_APPLIED',
                tank.stationId || '',
                `Sensor offset calibration applied to tank "${tank.name}". Previous offset: ${previousOffset}mm → New offset: ${newOffset.toFixed(2)}mm.`,
                'INFO',
                {
                    tankId: tank.id,
                    tankName: tank.name,
                    previousOffset,
                    newOffset: parseFloat(newOffset.toFixed(2)),
                    rawDistanceAtCalibration: currentRawDistance,
                    measuredLevelMm: parseFloat(measuredLevelMm),
                    tankHeightMm: tank.height * 1000,
                    calibratedAt: new Date().toISOString()
                }
            );

            NotificationService.show('Calibration Applied', {
                body: `New offset of ${newOffset.toFixed(2)}mm applied to ${tank.name}. Forensic event logged.`,
                icon: '/favicon.ico'
            });

            if (onSuccess) onSuccess();
            setStep(3);
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Calibration Failed',
                    message: err.message || 'An unexpected error occurred. Please retry.',
                    type: 'error',
                    attribution: 'CALIBRATION WIZARD'
                }
            }));
        } finally {
            setApplying(false);
        }
    };

    return createPortal(
        <div className="calibration-wizard-overlay animate-fade-in" onClick={onClose}>
            <div className="calibration-wizard-content" onClick={e => e.stopPropagation()}>
                <header className="cw-header">
                    <div className="cw-title-wrap">
                        <div className="cw-icon-box"><FiTarget /></div>
                        <div>
                            <h2>Forensic Calibration Wizard</h2>
                            <p>Correcting sensor drift for {tank.name}</p>
                        </div>
                    </div>
                    <button className="cw-close" onClick={onClose} title="Close"><FiX /></button>
                </header>

                <div className="cw-stepper">
                    <div className={`cw-step ${step >= 1 ? 'active' : ''}`}>1. Measure</div>
                    <div className="cw-connector"></div>
                    <div className={`cw-step ${step >= 2 ? 'active' : ''}`}>2. Compute</div>
                    <div className="cw-connector"></div>
                    <div className={`cw-step ${step >= 3 ? 'active' : ''}`}>3. Finalize</div>
                </div>

                <main className="cw-main">
                    {step === 1 && (
                        <div className="cw-form animate-slide-up">
                            <div className="cw-info-card">
                                <FiInfo />
                                <p>Physically measure the current fuel level using a dipstick or manual probe before proceeding.</p>
                            </div>

                            <div className="cw-telemetry-status">
                                <div className="status-label">Live Raw Telemetry:</div>
                                <div className="status-value">
                                    {currentRawDistance ? `${currentRawDistance} mm` : <FiRefreshCw className="animate-spin" />}
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Actual Measured Level (mm)</label>
                                <input 
                                    type="number" 
                                    placeholder="e.g. 1450" 
                                    value={measuredLevelMm}
                                    onChange={e => setMeasuredLevelMm(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <button 
                                className="cw-btn-primary" 
                                onClick={handleCalculate}
                                disabled={!measuredLevelMm || !currentRawDistance || calculating}
                            >
                                {calculating ? <FiRefreshCw className="animate-spin" /> : <><FiZap /> Calculate Corrections</>}
                            </button>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="cw-results animate-slide-up">
                            <div className="results-grid">
                                <div className="result-card">
                                    <span className="res-label">Current Offset</span>
                                    <span className="res-value old">{tank.sensorOffset || 0} mm</span>
                                </div>
                                <div className="result-card highlight">
                                    <span className="res-label">New Offset</span>
                                    <span className="res-value new">{newOffset} mm</span>
                                </div>
                            </div>

                            <div className="variance-explanation">
                                <p>The system detected a <strong>{Math.abs((newOffset || 0) - (tank.sensorOffset || 0))}mm</strong> deviation from current configuration.</p>
                                <p className="text-xs text-slate-400 mt-2">Applying this will re-index all future readings for volume accuracy.</p>
                            </div>

                            <div className="cw-actions">
                                <button className="cw-btn-secondary" onClick={() => setStep(1)}>Recalculate</button>
                                <button className="cw-btn-primary" onClick={handleApply} disabled={applying}>
                                    {applying ? <FiRefreshCw className="animate-spin" /> : <><FiCheckCircle /> Apply & Deploy</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="cw-success animate-scale-in">
                            <div className="success-icon"><FiCheckCircle /></div>
                            <h3>Calibration Successful</h3>
                            <p>Hardware offsets have been updated and synced to the cloud ledger.</p>
                            <button className="cw-btn-primary mt-6" onClick={onClose}>Finish</button>
                        </div>
                    )}
                </main>

                <footer className="cw-footer">
                    <div className="cw-security-pill">
                        <FiDatabase /> Secure Forensic Handshake Active
                    </div>
                </footer>
            </div>
        </div>,
        document.body
    );
};
