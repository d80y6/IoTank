import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/config/supabase';
import {
    FiCheck, FiX, FiTruck, FiAlertCircle, FiDatabase,
    FiThermometer, FiClock, FiActivity, FiShield
} from 'react-icons/fi';
import { Alert } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { NotificationService } from '@/services/NotificationService';
import { validateUUID } from '@/utils/sanitization';
import { logger } from '@/utils/logger';
import '../Inventory/AddTankModal.css';
import './RefillVerificationModal.css';

interface RefillVerificationModalProps {
    alert: Alert;
    stationId: string;
    onClose: () => void;
}

// ── Temperature Volume Correction (ASTM D1250-like, simplified for diesel/petrol) ─
// VCF = 1 - β × ΔT   where β ≈ 0.00085 /°C for diesel, 0.00095 for petrol
function calcTempCorrectedVolume(observedVolume: number, tempC: number, fuelType: string = 'diesel'): number {
    const beta = fuelType.toLowerCase().includes('petrol') || fuelType.toLowerCase().includes('gasoline') ? 0.00095 : 0.00085;
    const referenceTemp = 15; // 15°C standard (ASTM)
    const vcf = 1 - beta * (tempC - referenceTemp);
    return observedVolume * vcf;
}

export const RefillVerificationModal: React.FC<RefillVerificationModalProps> = ({ alert: alertProp, stationId, onClose }) => {
    const { currentUser } = useAuth();
    const meta = alertProp.metadata || {};

    // ── ATG Sensing Values (Auto-brought from the alert metadata) ─────────────
    const atgStartVolume: number = meta.startVolume ?? 0;
    const atgEndVolume: number  = meta.endVolume   ?? meta.currVol ?? 0;
    const atgDeliveredVolume: number = meta.deliveredVolume ?? meta.volumeIncrease ?? (atgEndVolume - atgStartVolume);
    const atgEndTemperature: number | null = meta.endTemperature ?? null;

    const startTimestamp: number | null = meta.startTimestamp ?? null;
    const endTimestamp:   number | null = meta.endTimestamp   ?? null;

    const isUnauthorized = alertProp.type === 'unauthorized_refill';

    const durationMin = (startTimestamp && endTimestamp)
        ? Math.round((endTimestamp - startTimestamp) / 60000)
        : null;

    // ── Temperature-corrected delivered volume ────────────────────────────────
    const tempCorrectedVolume = (atgEndTemperature !== null && atgDeliveredVolume > 0)
        ? calcTempCorrectedVolume(atgDeliveredVolume, atgEndTemperature)
        : null;

    // ── Form State ────────────────────────────────────────────────────────────
    const [invoiceVolume, setInvoiceVolume] = useState<number>(atgDeliveredVolume);
    const [supplier, setSupplier]           = useState('');
    const [bolNumber, setBolNumber]         = useState('');
    const [totalCost, setTotalCost]         = useState<number | ''>('');
    const [notes, setNotes]                 = useState('');
    const [processing, setProcessing]       = useState(false);

    // Variance against ATG Corrected reading
    const variance     = invoiceVolume - atgDeliveredVolume;
    const variancePcnt = atgDeliveredVolume > 0 ? (variance / atgDeliveredVolume) * 100 : 0;
    const isVarianceHigh = Math.abs(variance) > 50;

    const unitPrice = (invoiceVolume > 0 && typeof totalCost === 'number') ? (totalCost / invoiceVolume) : 0;

    const formatTs = (ts: number | null) => ts
        ? new Date(ts).toLocaleString('en-KE', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
        : '--';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentUser) return;

        if (!validateUUID(alertProp.tankId || '')) {
            NotificationService.show('Invalid Tank', { body: 'Placeholder tanks cannot be reconciled to cloud storage.' });
            return;
        }

        setProcessing(true);
        try {
            const deliveryPayload = {
                station_id: stationId,
                tank_id: alertProp.tankId,
                auth_user_id: currentUser.authUserId,
                delivery_date: endTimestamp ? new Date(endTimestamp).toISOString() : new Date().toISOString(),
                supplier_name: supplier || 'DSRS_LOCAL_OFFLOAD',
                bol_number: bolNumber || `ATG-AUTO-${Date.now().toString().slice(-6)}`,
                bol_claimed_volume: invoiceVolume,
                actual_received_volume: invoiceVolume,
                tank_before_volume: atgStartVolume,
                tank_after_volume: atgEndVolume,
                actual_temperature: atgEndTemperature ?? 25.0,
                verification_status: isVarianceHigh ? 'flagged' : 'verified_ok',
                metadata: {
                    atg_measured_volume: atgDeliveredVolume,
                    temp_corrected_volume: tempCorrectedVolume,
                    temperature_at_end: atgEndTemperature,
                    variance,
                    variance_percentage: variancePcnt,
                    unit_price: unitPrice,
                    total_cost: totalCost,
                    source: 'AUTOMATED_REFILL_DETECTION',
                    alert_id: alertProp.id,
                    shift_status: isUnauthorized ? 'CLOSED' : 'OPEN',
                    refill_duration_min: durationMin,
                    operator_notes: notes || null,
                }
            };

            const { error: deliveryError } = await supabase
                .from('deliveries')
                .insert([deliveryPayload]);
            if (deliveryError) throw deliveryError;

            // Resolve the alert — only permitted fields
            const { error: alertError } = await supabase
                .from('alerts')
                .update({ is_resolved: true })
                .eq('id', alertProp.id);
            if (alertError) throw alertError;

            NotificationService.show('Refill Synchronized', {
                body: `Inventory reconciled. ATG: ${atgDeliveredVolume.toFixed(1)}L | Waybill: ${invoiceVolume}L | Variance: ${variance.toFixed(1)}L`,
                type: 'success'
            } as any);

            onClose();
        } catch (error: any) {
            logger.error('Reconciliation error:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Sync Error',
                    message: error.message,
                    type: 'error',
                    attribution: 'RECONCILIATION ENGINE'
                }
            }));
        } finally {
            setProcessing(false);
        }
    };

    return createPortal(
        <div className="add-tank-modal-overlay animate-in fade-in duration-300" onClick={onClose}>
            <div className="add-tank-modal-content max-w-xl" onClick={e => e.stopPropagation()}>

                {/* ── HEADER ─────────────────────────────────────────────────── */}
                <div className={`modal-header ${isUnauthorized ? 'rv-header-unauthorized' : 'rv-header-authorized'}`}>
                    <div className="header-text-container">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="rv-header-icon-wrap">
                                {isUnauthorized ? <FiShield size={18} /> : <FiTruck size={18} />}
                            </div>
                            <div>
                                <h2>
                                    {isUnauthorized ? 'Forensic Security Reconciliation' : 'Refill Reconciliation'}
                                </h2>
                                <p>{isUnauthorized ? 'Out-of-hours delivery requires immediate verification' : 'Automatic delivery verification and inventory sync'}</p>
                            </div>
                        </div>
                        <div className="modal-header-badges">
                            {isUnauthorized
                                ? <><span className="modal-badge rose">Security Protocol Active</span><span className="modal-badge amber">Shift Closed</span></>
                                : <><span className="modal-badge cyan">ATG Verified</span><span className="modal-badge blue">Incoming</span></>
                            }
                        </div>
                    </div>
                    <button className="close-btn" type="button" onClick={onClose} title="Close"><FiX size={18} /></button>
                </div>

                <form onSubmit={handleSubmit} className="add-tank-form">
                    <div className="max-h-[70vh] overflow-y-auto px-1 pr-3 space-y-3">

                        {/* ── SECURITY BREACH BANNER ────────────────────────── */}
                        {isUnauthorized && (
                            <div className="rv-breach-banner">
                                <FiAlertCircle size={16} className="animate-pulse flex-shrink-0" />
                                <p>
                                    <strong>SECURITY BREACH:</strong> Unscheduled out-of-hours delivery detected while shift was <strong>CLOSED</strong>. All details must be reconciled forensically.
                                </p>
                            </div>
                        )}

                        {/* ── ATG SENSING REPORT ───────────────────────────── */}
                        <div className="atm-section blue">
                            <div className="atm-section-header">
                                <div className="atm-section-icon"><FiDatabase size={13} /></div>
                                <span className="atm-section-title">ATG Sensing Report — System Verified</span>
                            </div>
                            <div className="atm-section-body">
                                {/* Big ATG delta */}
                                <div className="rv-atg-delta-row">
                                    <div>
                                        <div className="rv-atg-big-value">+{atgDeliveredVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
                                        <div className="rv-atg-big-label">Measured Cubic Litres (ATG)</div>
                                    </div>
                                    <div className="rv-atg-forensics-grid">
                                        <div className="rv-forensic-chip">
                                            <span className="rv-fc-label">START (t₀)</span>
                                            <span className="rv-fc-value">{atgStartVolume.toLocaleString()}L</span>
                                            {startTimestamp && <span className="rv-fc-time">{formatTs(startTimestamp)}</span>}
                                        </div>
                                        <div className="rv-forensic-chip">
                                            <span className="rv-fc-label">END (t₁)</span>
                                            <span className="rv-fc-value">{atgEndVolume.toLocaleString()}L</span>
                                            {endTimestamp && <span className="rv-fc-time">{formatTs(endTimestamp)}</span>}
                                        </div>
                                    </div>
                                </div>

                                {/* Temp + Duration row */}
                                <div className="rv-meta-strip">
                                    {atgEndTemperature !== null && (
                                        <div className="rv-meta-chip">
                                            <FiThermometer size={11} />
                                            <span>Temp at end: <strong>{atgEndTemperature}°C</strong></span>
                                        </div>
                                    )}
                                    {durationMin !== null && (
                                        <div className="rv-meta-chip">
                                            <FiClock size={11} />
                                            <span>Duration: <strong>{durationMin} min</strong></span>
                                        </div>
                                    )}
                                    {tempCorrectedVolume !== null && (
                                        <div className="rv-meta-chip rv-meta-chip--corrected">
                                            <FiActivity size={11} />
                                            <span>Temp-corrected (15°C ref): <strong>{tempCorrectedVolume.toFixed(1)}L</strong></span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ── VERIFICATION DATA ─────────────────────────────── */}
                        <div className="atm-section slate">
                            <div className="atm-section-header">
                                <div className="atm-section-icon"><FiTruck size={13} /></div>
                                <span className="atm-section-title">Verification Data — Waybill / Invoice</span>
                            </div>
                            <div className="atm-section-body atm-grid atm-grid-2">
                                <div className="form-group atm-col-2">
                                    <label>Waybill / Invoice Volume (L)</label>
                                    <div className="rv-input-with-unit">
                                        <input
                                            type="number"
                                            value={invoiceVolume}
                                            onChange={e => setInvoiceVolume(Number(e.target.value))}
                                            required
                                            className="!font-black !text-indigo-700"
                                        />
                                        <span className="rv-unit-badge">L</span>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Supplier</label>
                                    <input
                                        type="text"
                                        value={supplier}
                                        onChange={e => setSupplier(e.target.value)}
                                        placeholder="e.g. Shell / TotalEnergies"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>BOL / Invoice #</label>
                                    <input
                                        type="text"
                                        value={bolNumber}
                                        onChange={e => setBolNumber(e.target.value)}
                                        placeholder="INV-XXXXX"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Total Cost / Stock Value (KES)</label>
                                    <div className="rv-input-with-prefix">
                                        <span className="rv-prefix-badge">KSh</span>
                                        <input
                                            type="number"
                                            value={totalCost}
                                            onChange={e => setTotalCost(e.target.value ? Number(e.target.value) : '')}
                                            required
                                            min="1"
                                            step="0.01"
                                            placeholder="Total Invoice Amount"
                                            className="!pl-14 !font-black text-emerald-700"
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Derived Unit Price (KES/L)</label>
                                    <input
                                        readOnly
                                        value={`KSh ${unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                        className="bg-slate-50 font-black text-slate-500 !border-slate-200 cursor-default"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* ── VARIANCE SUMMARY ──────────────────────────────── */}
                        <div className={`rv-variance-card ${isVarianceHigh ? 'rv-variance-danger' : 'rv-variance-ok'}`}>
                            <div className="flex items-center gap-2">
                                {isVarianceHigh ? <FiAlertCircle size={16} /> : <FiCheck size={16} />}
                                <span className="rv-variance-label">
                                    Net Variance: {variance > 0 ? '+' : ''}{variance.toFixed(1)}L
                                    ({variancePcnt > 0 ? '+' : ''}{variancePcnt.toFixed(2)}%)
                                </span>
                            </div>
                            <p className="rv-variance-hint">
                                {isVarianceHigh
                                    ? 'Critical deviation detected. Review invoice volume against ATG measurement.'
                                    : 'Variance within acceptable forensic tolerance (±50L).'}
                            </p>
                            {tempCorrectedVolume !== null && (
                                <p className="rv-variance-corrected">
                                    ↳ Temperature-corrected loss/gain: {(invoiceVolume - tempCorrectedVolume).toFixed(1)}L at {atgEndTemperature}°C vs 15°C reference
                                </p>
                            )}
                        </div>

                        {/* ── OPERATOR NOTES ────────────────────────────────── */}
                        <div className="form-group">
                            <label className="text-slate-500 text-[10px] font-black uppercase tracking-wider">Reconciliation Notes (Optional)</label>
                            <textarea
                                className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 placeholder:text-slate-400 resize-none"
                                rows={2}
                                placeholder="Enter forensic remarks or variance explanation..."
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* ── ACTIONS ───────────────────────────────────────────── */}
                    <div className="form-actions pt-4 pb-2 border-t border-slate-100">
                        <button type="button" className="btn-danger" onClick={onClose}>Discard Event</button>
                        <button type="submit" disabled={processing} className="btn-submit">
                            {processing
                                ? <><div className="rv-spinner-sm" /> Processing...</>
                                : <><FiCheck size={16} /> Finalize &amp; Sync</>
                            }
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
};
