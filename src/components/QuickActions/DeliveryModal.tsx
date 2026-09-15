import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTanks, useLatestReading, resolveAlert, updateTank } from '@/hooks/useSupabase';
import { useAuth } from '@/hooks/useAuth';
import { AuditService } from '@/services/AuditService';
import { supabase } from '@/config/supabase';
import { validateUUID } from '@/utils/sanitization';
import { FiX, FiInfo, FiDroplet, FiCheckCircle, FiFileText, FiActivity, FiUploadCloud, FiChevronDown } from 'react-icons/fi';
import '../Inventory/AddTankModal.css'; // Inheriting the premium layout and purple palette
import './QuickActions.css';
import { NotificationService } from '@/services/NotificationService';
import { EmailDispatchService } from '@/services/EmailDispatchService';
import { SignaturePad } from '../Common/SignaturePad';
import { useModals } from '@/contexts/ModalContext';
import { logger } from '@/utils/logger';


interface DeliveryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: (message: string) => void;
}

export const DeliveryModal: React.FC<DeliveryModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId || '';
    const { tanks } = useTanks(stationId);
    const { activeModal, modalData } = useModals();

    const [isHibernating, setIsHibernating] = useState(false);
    const [formData, setFormData] = useState({
        tankId: '',
        supplier: '',
        invoiceNumber: '',
        expectedVolume: '',
        existingVolume: '',
        totalVolume: '',
        temperature: '', // Delivered Fuel Temp
        timestamp: new Date().toISOString().slice(0, 16),
        varianceReason: '',
        // Testing fields
        visualCheck: '',
        waterContaminationType: 'height' as 'percentage' | 'height',
        waterContaminationValue: '',
        density: '',
        existingTemp: '',
        deliveryPrice: '',
        deliveryPriceType: 'total' as 'per_litre' | 'total'
    });
    const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
    const [uploadingInvoice, setUploadingInvoice] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState<1 | 2>(1);
    const [signature, setSignature] = useState('');


    const { reading: latestReading } = useLatestReading(stationId, formData.tankId);

    useEffect(() => {
        if (isOpen) {
            setFormData(prev => ({
                ...prev,
                timestamp: new Date().toISOString().slice(0, 16)
            }));

            if (activeModal === 'refill_verification' && modalData) {
                const metadata = modalData.metadata || {};
                const alertStartTime = metadata.startTime || modalData.created_at;

                setFormData(prev => ({
                    ...prev,
                    tankId: modalData.tank_id || prev.tankId,
                    existingVolume: String(metadata.startVolume || ''),
                    totalVolume: String(metadata.endVolume || ''),
                    expectedVolume: String(metadata.deliveredVolume || ''),
                    varianceReason: 'System automated detection',
                    timestamp: alertStartTime ? new Date(alertStartTime).toISOString().slice(0, 16) : prev.timestamp
                }));
            }
        } else {
            // Reset to step 1 when closed
            setStep(1);
        }
    }, [isOpen, activeModal, modalData]);

    // Auto-fetch existing temperature
    useEffect(() => {
        if (latestReading?.temperature && !formData.existingTemp) {
            setFormData(prev => ({ ...prev, existingTemp: String(latestReading.temperature) }));
        }
    }, [latestReading, formData.tankId]);

    // Temp Gradient Calculation (Against EPRA 15°C Standard)
    const tempGradient = formData.temperature 
        ? (Number(formData.temperature) - 15).toFixed(2)
        : '0.00';

    if (!isOpen) return null;

    const executeSubmission = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!currentUser?.stationId) {
            NotificationService.show('Submission Failed', { body: 'Organization context missing.' });
            return;
        }

        if (!validateUUID(formData.tankId)) {
            NotificationService.show('Invalid Tank', { body: 'Selected tank is not valid for cloud synchronization.' });
            return;
        }

        setSubmitting(true);
        try {
            let invoiceUrl = null;
            if (invoiceFile) {
                setUploadingInvoice(true);
                const fileExt = invoiceFile.name.split('.').pop();
                const fileName = `${Math.random()}.${fileExt}`;
                const filePath = `deliveries/invoices/${stationId}/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('uploads')
                    .upload(filePath, invoiceFile);

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage
                    .from('uploads')
                    .getPublicUrl(filePath);

                invoiceUrl = publicUrl;
                setUploadingInvoice(false);
            }

            // Calculate final price per litre based on selection
            const enteredPriceVal = Number(formData.deliveryPrice) || 0;
            const finalPricePerLitre = formData.deliveryPriceType === 'total'
                ? (Number(formData.expectedVolume) > 0 ? (enteredPriceVal / Number(formData.expectedVolume)) : 0)
                : enteredPriceVal;

            const actualVolumeMeasured = Number(formData.totalVolume) - Number(formData.existingVolume);

            const payload = {
                station_id: currentUser.stationId,
                tank_id: formData.tankId,
                auth_user_id: currentUser.authUserId, 
                delivery_date: new Date(formData.timestamp).toISOString(),
                supplier_name: formData.supplier.trim(),
                bol_number: formData.invoiceNumber.trim() || null,
                bol_claimed_volume: Number(formData.expectedVolume),
                bol_temperature: formData.temperature ? Number(formData.temperature) : null,
                bol_photo_url: invoiceUrl,
                tank_before_volume: Number(formData.existingVolume),
                tank_after_volume: Number(formData.totalVolume),
                actual_received_volume: actualVolumeMeasured, 
                actual_temperature: formData.temperature ? Number(formData.temperature) : null,
                verification_status: 'verified_ok',
                metadata: {
                    variance: variance,
                    variance_percentage: variancePcnt,
                    variance_reason: formData.varianceReason || null,
                    visual_check: formData.visualCheck,
                    water_contamination: {
                        type: formData.waterContaminationType,
                        value: formData.waterContaminationValue
                    },
                    density_api: formData.density,
                    temp_gradient: tempGradient,
                    existing_temp_at_delivery: formData.existingTemp,
                    witness_signature: signature || null,
                    witness_name: currentUser.displayName || currentUser.email,
                    delivery_price: finalPricePerLitre,
                    delivery_price_type: formData.deliveryPriceType,
                    entered_delivery_price: enteredPriceVal
                }
            };

            const { data: deliveryData, error } = await supabase.from('deliveries').insert([payload]).select().single();
            if (error) throw error;

            // Sync delivery price to tank metadata dynamically
            if (selectedTank) {
                const currentMetadata = selectedTank.metadata || {};
                await updateTank(formData.tankId, {
                    metadata: {
                        ...currentMetadata,
                        deliveryPrice: finalPricePerLitre.toFixed(2)
                    }
                } as any);
            }

            // 1. Success Notification & Toast (Local)
            NotificationService.show('Delivery Successfully Recorded', {
                body: `Forensic intake for ${formData.expectedVolume}L of ${selectedTank?.fuelType} from ${formData.supplier} has been verified and logged.`,
                icon: '/favicon.ico'
            });

            if (onSuccess) {
                onSuccess(`Inbound delivery reconciliation for ${formData.supplier} completed.`);
            }

            // 2. Persistent Systems (Run in background or caught separately)
            try {
                // [AUTO-RESOLUTION]: If this modal was opened via an automated refill alert, resolve it now
                if (activeModal === 'refill_verification' && modalData?.id) {
                    resolveAlert(modalData.id, currentUser.authUserId).catch(err => {
                        logger.warn('[DeliveryModal] Failed to auto-resolve refill alert:', err);
                    });
                }

                // Generate Formal Report
                if (deliveryData) {
                    const reportPayload = {
                        station_id: currentUser.stationId,
                        delivery_id: deliveryData.id,
                        name: `Delivery Verification - ${formData.supplier.trim()}`,
                        report_type: 'delivery_verification',
                        report_data: {
                            delivery_id: deliveryData.id,
                            tank_name: selectedTank?.name || 'Unknown',
                            bol_number: formData.invoiceNumber,
                            variance: variance,
                            variance_percentage: variancePcnt,
                            quality_status: {
                                visual: formData.visualCheck || 'OK',
                                water: Number(formData.waterContaminationValue) > 0 ? 'Contaminated' : 'OK',
                                thermal_gradient: tempGradient
                            },
                            timestamp: new Date().toISOString(),
                            operator: currentUser.displayName
                        },
                    };
                    await supabase.from('reports').insert([reportPayload]);
                }

                // Forensic System Log
                await AuditService.log(
                    'DELIVERY',
                    'DELIVERY_RECORDED',
                    stationId,
                    `Forensic Intake Verified: Stock replenishment recorded from [${formData.supplier}]. Waybill Vol: ${formData.expectedVolume}L to Tank [${selectedTank?.name}]. Reconciliation Variance: ${variance}L.`,
                    Math.abs(variance) > 50 ? 'WARNING' : 'INFO',
                    { 
                        deliveryId: deliveryData?.id, 
                        tankId: formData.tankId, 
                        supplier: formData.supplier,
                        expectedVolume: formData.expectedVolume,
                        actualVolume: formData.totalVolume,
                        variance,
                        capturedBy: currentUser?.email 
                    }
                );

                // Dispatch Automated Verification Email
                EmailDispatchService.sendSecurityAlert({
                    to: currentUser.email,
                    type: 'REFILL',
                    siteName: 'IoTank Platform',
                    details: {
                        timestamp: new Date().toISOString(),
                        description: `Delivery Verification Confirmed: ${formData.expectedVolume}L of ${selectedTank?.fuelType || 'Fuel'} from ${formData.supplier} added to Tank ${selectedTank?.name}. Waybill: ${formData.invoiceNumber}. Variance Check: ${variance}L. Thermal Gradient: ${tempGradient}°C.`,
                        operator: currentUser.displayName || currentUser.email,
                        varianceValue: variance
                    }
                }).catch(err => logger.warn('[DeliveryModal] Failed to dispatch delivery email:', err));

            } catch (auxErr) {
                logger.warn('[DeliveryModal] Background reporting delay:', auxErr);
            }

            onClose();
        } catch (err: any) {
             logger.error('[DeliveryModal] Verification Error:', err);
             NotificationService.show('Verification Failed', { body: err.message || 'System error. Please check your connection.' });
        } finally {
            setSubmitting(false);
            setUploadingInvoice(false);
        }
    };

    const triggerHibernate = () => {
        setIsHibernating(true);
        setTimeout(() => setIsHibernating(false), 800);
    };

    const handleNextStep = (e: React.FormEvent) => {
        e.preventDefault();
        if (showVariance) {
            setStep(2);
        } else {
            executeSubmission();
        }
    };

    const selectedTank = tanks.find((t: import('@/types').Tank) => t.id === formData.tankId);

    // Variance Computation
    const existing = Number(formData.existingVolume) || 0;
    const expected = Number(formData.expectedVolume) || 0;
    const total = Number(formData.totalVolume) || 0;

    const expectedFinal = existing + expected;
    let variance = 0;
    let variancePcnt = 0;
    let showVariance = false;

    if (expectedFinal > 0 && formData.totalVolume !== '') {
        showVariance = true;
        variance = total - expectedFinal;
        variancePcnt = (variance / expectedFinal) * 100;
    }

    // ── Thermal Variance Explanation (DISPLAY ONLY — no values are altered) ──
    // The ESP32 sensor measures actual physical volume in the tank at the
    // ambient delivery temperature. The BOL figure is typically stated at 15°C
    // (the standard reference temperature). When delivered fuel is warmer than
    // 15°C it occupies more volume; the tanker measured a warm volume, but by
    // the time it enters the cooler tank it contracts. This explains a large
    // portion of any apparent "shortage" without implying theft or error.
    //
    // Expansion coefficients (ASTM D1250 / EPRA standard):
    //   Diesel / HFO : ~0.00085 per °C
    //   Petrol / PMS  : ~0.00100 per °C
    const fuelType = (selectedTank?.fuelType || '').toLowerCase();
    const EXPANSION_COEFF = fuelType.includes('petrol') || fuelType.includes('pms') || fuelType.includes('gasoline')
        ? 0.00100  // Petrol
        : 0.00085; // Diesel / default
    const REF_TEMP = 15; // °C  (industry standard reference temperature)

    const deliveryTemp = formData.temperature ? Number(formData.temperature) : null;
    let thermallyExplainedLiters: number | null = null;
    let thermalExplanation = '';
    if (deliveryTemp !== null && expected > 0 && variance < 0) {
        // Thermal shrinkage: volume the BOL fuel "lost" when cooled from
        // deliveryTemp → REF_TEMP after entering the tank.
        const tempDelta = deliveryTemp - REF_TEMP;
        thermallyExplainedLiters = expected * EXPANSION_COEFF * tempDelta;
        const remaining = variance - (-Math.abs(thermallyExplainedLiters));
        if (thermallyExplainedLiters > 0) {
            const pctExplained = Math.min(100, (thermallyExplainedLiters / Math.abs(variance)) * 100);
            thermalExplanation = `At ${deliveryTemp}°C delivery temp, thermal contraction accounts for ~${thermallyExplainedLiters.toFixed(0)}L (${pctExplained.toFixed(0)}% of variance). Unexplained residual: ${remaining.toFixed(0)}L.`;
        }
    }

    return createPortal(
        <div className="add-tank-modal-overlay animate-in fade-in duration-300" onClick={triggerHibernate}>
            <div className="add-tank-modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="header-text-container">
                        <h2>New Fuel Delivery {selectedTank && `- ${selectedTank.name}`}</h2>
                        <p>Log incoming fuel stock for inventory reconciliation.</p>
                        <div className="modal-header-badges">
                            <span className="modal-badge blue">Delivery</span>
                            <span className="modal-badge cyan">INCOMING</span>
                        </div>
                    </div>
                    <button className={`close-btn ${isHibernating ? 'hibernate' : ''}`} type="button" onClick={onClose} title="Close Modal" aria-label="Close Modal"><FiX size={18} /></button>
                </div>

                <form onSubmit={step === 1 ? handleNextStep : executeSubmission} className="add-tank-form">
                    {step === 1 ? (
                        <div className="max-h-[70vh] overflow-y-auto px-1 pr-3">
                            <div className="atm-section">
                                <div className="atm-section-header">
                                    <div className="atm-section-icon"><FiInfo size={14} /></div>
                                    <span className="atm-section-title">Logistics & Identity</span>
                                </div>

                                <div className="atm-section-body atm-grid atm-grid-2">
                                    <div className="form-group atm-col-2">
                                        <label>Target Tank</label>
                                        <select required title="Target Tank" aria-label="Target Tank" value={formData.tankId} onChange={e => {
                                            const newTankId = e.target.value;
                                            const tank = tanks.find((t: import('@/types').Tank) => t.id === newTankId);
                                            setFormData({
                                                ...formData,
                                                tankId: newTankId,
                                                existingVolume: tank?.currentVolume ? String(tank.currentVolume) : '',
                                                existingTemp: '' // Will be updated by useEffect
                                            });
                                        }}>
                                            <option value="">Select Target Storage...</option>
                                            {tanks.map((t: import('@/types').Tank) => (
                                                <option key={t.id} value={t.id}>{t.name} ({t.fuelType})</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label>Supplier Name</label>
                                        <input required placeholder="e.g. Shell / TotalEnergies" value={formData.supplier} onChange={e => setFormData({ ...formData, supplier: e.target.value })} />
                                    </div>

                                    <div className="form-group">
                                        <label>Fuel Type (Pre-filled)</label>
                                        <input readOnly value={selectedTank?.fuelType || ''} className="bg-slate-50 cursor-not-allowed" placeholder="Select tank first..." />
                                    </div>

                                    <div className="form-group">
                                        <label>BOL / Delivery Note Number</label>
                                        <input required placeholder="BOL-YYYY-MM-DD-XXXX" value={formData.invoiceNumber} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })} />
                                    </div>

                                    <div className="form-group">
                                        <label>Expected Volume (from BOL) (L)</label>
                                        <input required type="number" placeholder="10000" value={formData.expectedVolume} onChange={e => setFormData({ ...formData, expectedVolume: e.target.value })} />
                                    </div>

                                    <div className="form-group">
                                        <label>Price of Stock Received</label>
                                        <div className="flex relative">
                                            <input
                                                required
                                                type="number"
                                                step="0.01"
                                                className="flex-1 rounded-r-none border-r-0"
                                                placeholder={formData.deliveryPriceType === 'total' ? "e.g. 1750000" : "e.g. 175.50"}
                                                value={formData.deliveryPrice}
                                                onChange={e => setFormData({ ...formData, deliveryPrice: e.target.value })}
                                            />
                                            <select
                                                title="Price Input Type"
                                                aria-label="Price Input Type"
                                                className="w-28 rounded-l-none bg-slate-50 border-l border-slate-200 appearance-none pr-8 text-xs font-semibold text-slate-600"
                                                value={formData.deliveryPriceType}
                                                onChange={e => setFormData({ ...formData, deliveryPriceType: e.target.value as any })}
                                            >
                                                <option value="per_litre">Ksh/Litre</option>
                                                <option value="total">Stock Value</option>
                                            </select>
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                <FiChevronDown size={14} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="atm-section">
                                <div className="atm-section-header">
                                    <div className="atm-section-icon"><FiDroplet size={14} /></div>
                                    <span className="atm-section-title">Quantities & Timing</span>
                                </div>

                                <div className="atm-section-body atm-grid atm-grid-2">
                                    <div className="form-group">
                                        <label>Existing Volume (L)</label>
                                        <input required type="number" placeholder="ESP32 Measured" value={formData.existingVolume} onChange={e => setFormData({ ...formData, existingVolume: e.target.value })} />
                                    </div>

                                    <div className="form-group">
                                        <label>Total Volume (After Delivery) (L)</label>
                                        <input type="number" placeholder="9500.0" value={formData.totalVolume} onChange={e => setFormData({ ...formData, totalVolume: e.target.value })} />
                                    </div>

                                    <div className="form-group">
                                        <label>Delivered Fuel Temp (°C)</label>
                                        <input type="number" placeholder="25.0" value={formData.temperature} onChange={e => setFormData({ ...formData, temperature: e.target.value })} />
                                    </div>

                                    <div className="form-group">
                                        <label>Delivery Timestamp</label>
                                        <input type="datetime-local" title="Delivery Timestamp" aria-label="Delivery Timestamp" placeholder="Delivery Timestamp" value={formData.timestamp} onChange={e => setFormData({ ...formData, timestamp: e.target.value })} />
                                    </div>
                                </div>
                            </div>

                            {/* New Quality & Testing Section */}
                            <div className="atm-section">
                                <div className="atm-section-header">
                                    <div className="atm-section-icon bg-blue-500 text-white"><FiActivity size={14} /></div>
                                    <span className="atm-section-title text-blue-700">Quality & Testing Control</span>
                                </div>

                                <div className="atm-section-body atm-grid atm-grid-2">
                                    <div className="form-group">
                                        <label className="flex items-center gap-1.5">
                                            Visual Check
                                            <FiInfo className="text-emerald-400 cursor-help" size={12} title="Pour sample into clean glass container and inspect against light source." />
                                        </label>
                                        <select
                                            title="Visual Check" aria-label="Visual Check"
                                            value={formData.visualCheck}
                                            onChange={e => setFormData({ ...formData, visualCheck: e.target.value })}
                                            className="w-full border-emerald-100 focus:border-emerald-500 focus:ring-emerald-50"
                                        >
                                            <option value="">Select Observation...</option>
                                            <option value="Clear & Bright">Clear & Bright: Sparkling and free of haze</option>
                                            <option value="Cloudy/Hazy">Cloudy/Hazy: Water contamination</option>
                                            <option value="Darker Color">Darker Color: Indicates degradation</option>
                                            <option value="Sediment">Sediment: Debris or Tanker rust</option>
                                        </select>
                                    </div>

                                    <div className="form-group">
                                        <label>Water & Contamination</label>
                                        <div className="flex relative">
                                            <input
                                                type="number"
                                                className="flex-1 rounded-r-none border-r-0"
                                                placeholder={formData.waterContaminationType === 'percentage' ? "0.00" : "0.0"}
                                                value={formData.waterContaminationValue}
                                                onChange={e => setFormData({ ...formData, waterContaminationValue: e.target.value })}
                                            />
                                            <select
                                                title="Water Contamination Type" aria-label="Water Contamination Type"
                                                className="w-20 rounded-l-none bg-slate-50 border-l border-slate-200 appearance-none pr-8"
                                                value={formData.waterContaminationType}
                                                onChange={e => setFormData({ ...formData, waterContaminationType: e.target.value as any })}
                                            >
                                                <option value="height">mm</option>
                                                <option value="percentage">%</option>
                                            </select>
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                <FiChevronDown size={14} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label>Density / API Gravity</label>
                                        <input
                                            type="number"
                                            placeholder="0.832"
                                            value={formData.density}
                                            onChange={e => setFormData({ ...formData, density: e.target.value })}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="text-emerald-700">Temperature Gradient</label>
                                        <input
                                            readOnly
                                            placeholder="0.00"
                                            value={tempGradient !== '0.00' ? `${tempGradient}°C` : ''}
                                            className="bg-emerald-50/50 font-mono font-bold text-emerald-600 border-emerald-100"
                                        />
                                    </div>
                                </div>
                            </div>


                            {/* Invoice Upload Section */}
                            <div className="atm-section mb-4">
                                <div className="atm-section-header">
                                    <div className="atm-section-icon bg-cyan-500 text-white"><FiFileText size={14} /></div>
                                    <span className="atm-section-title text-cyan-700">Digital Documentation</span>
                                </div>
                                <div className="atm-section-body">
                                    <div
                                        className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${invoiceFile ? 'border-emerald-300 bg-emerald-50/30' : 'border-indigo-100 hover:border-indigo-400 bg-indigo-50/10'}`}
                                        onClick={() => document.getElementById('invoice-upload')?.click()}
                                    >
                                        <input
                                            id="invoice-upload"
                                            title="Upload Invoice" aria-label="Upload Invoice" placeholder="Upload Invoice"
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={e => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    if (file.size > 5 * 1024 * 1024) {
                                                        window.dispatchEvent(new CustomEvent('system-toast', {
                                                            detail: {
                                                                title: 'File Too Large',
                                                                message: 'File size limit exceeded (Max 5MB)',
                                                                type: 'error',
                                                                attribution: 'UPLOAD MANAGER'
                                                            }
                                                        }));
                                                        return;
                                                    }
                                                    setInvoiceFile(file);
                                                }
                                            }}
                                        />
                                        <div className="flex flex-col items-center gap-2">
                                            {invoiceFile ? (
                                                <>
                                                    <FiCheckCircle className="text-emerald-500" size={32} />
                                                    <span className="text-sm font-bold text-emerald-700">{invoiceFile.name}</span>
                                                    <button type="button" className="text-[10px] text-red-500 font-bold uppercase underline" onClick={(e) => { e.stopPropagation(); setInvoiceFile(null); }}>Remove</button>
                                                </>
                                            ) : (
                                                <>
                                                    <FiUploadCloud className="text-indigo-400" size={32} />
                                                    <span className="text-sm font-bold text-indigo-700">Scan or Upload Invoice Image</span>
                                                    <span className="text-[10px] text-indigo-400 uppercase font-black tracking-widest leading-none mt-1">Maximum 5MB</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="tm-verification-card">
                                <FiCheckCircle size={18} />
                                <p>
                                    System will automatically verify the volume delta using ESP32 telemetry after confirmation.
                                </p>
                            </div>

                            <div className="form-actions pt-4 pb-2">
                                <button type="button" className="btn-danger" onClick={onClose}>Cancel</button>
                                <button type="submit" className="btn-submit" disabled={uploadingInvoice || submitting}>
                                    {submitting ? 'Authenticating...' : 'Confirm Delivery'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="variance-popup animate-in slide-in-from-bottom-4 duration-300">
                            <div className="text-center mb-4">
                                <h3 className="text-xl font-bold text-slate-800">Reconciliation Variance Check</h3>
                                <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                                    Below is the analytical summary of the delivery metrics for final verification.
                                </p>
                            </div>

                            <div className="tm-disclosure-grid">
                                {/* Volume Variance */}
                                <div className={`tm-disclosure-chip ${Math.abs(variance) > 50 ? 'critical' : Math.abs(variance) > 10 ? 'warning' : ''}`}>
                                    <span className="tm-chip-label">Volume Discrepancy</span>
                                    <span className="tm-chip-value">
                                        {variance > 0 ? '+' : ''}{variance.toLocaleString()}L ({variance > 0 ? '+' : ''}{variancePcnt.toFixed(2)}%)
                                    </span>
                                    <div className={`tm-chip-status ${Math.abs(variance) <= 10 ? 'ok' : Math.abs(variance) > 50 ? 'critical' : 'issue'}`}>
                                        {Math.abs(variance) <= 10 ? 'Status: OK' : Math.abs(variance) > 50 ? 'Status: Critical' : 'Status: Variance Detected'}
                                    </div>
                                </div>

                                {/* Visual Check */}
                                <div className={`tm-disclosure-chip ${formData.visualCheck !== 'Clear & Bright' && formData.visualCheck !== '' ? 'warning' : ''}`}>
                                    <span className="tm-chip-label">Visual Check</span>
                                    <span className="tm-chip-value">{formData.visualCheck || 'Not Recorded'}</span>
                                    <div className={`tm-chip-status ${formData.visualCheck === 'Clear & Bright' ? 'ok' : 'issue'}`}>
                                        {formData.visualCheck === 'Clear & Bright' ? 'Status: OK' : 'Status: Review Required'}
                                    </div>
                                </div>

                                {/* Water & Contamination */}
                                <div className={`tm-disclosure-chip ${(Number(formData.waterContaminationValue) > 0) ? 'critical' : ''}`}>
                                    <span className="tm-chip-label">Water & Contamination</span>
                                    <span className="tm-chip-value">
                                        {Number(formData.waterContaminationValue) > 0 ? `${formData.waterContaminationValue}${formData.waterContaminationType === 'percentage' ? '%' : 'mm'}` : '0.00'}
                                    </span>
                                    <div className={`tm-chip-status ${Number(formData.waterContaminationValue) <= 0 ? 'ok' : 'critical'}`}>
                                        {Number(formData.waterContaminationValue) <= 0 ? 'Status: OK' : 'Status: Contaminated'}
                                    </div>
                                </div>

                                {/* Temp Gradient */}
                                <div className={`tm-disclosure-chip ${Math.abs(Number(tempGradient)) > 5 ? 'warning' : ''}`}>
                                    <span className="tm-chip-label">Temperature Gradient</span>
                                    <span className="tm-chip-value">{tempGradient}°C</span>
                                    <div className={`tm-chip-status ${Math.abs(Number(tempGradient)) <= 5 ? 'ok' : 'issue'}`}>
                                        {Math.abs(Number(tempGradient)) <= 5 ? 'Status: OK' : 'Status: High Gradient'}
                                    </div>
                                </div>

                                {/* Thermal Variance Explanation — display only, no values changed */}
                                {thermallyExplainedLiters !== null && thermallyExplainedLiters > 0 && variance < 0 && (
                                    <div className="tm-disclosure-chip" style={{ gridColumn: '1 / -1', background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', border: '1.5px solid #93c5fd' }}>
                                        <span className="tm-chip-label" style={{ color: '#1d4ed8', fontWeight: 700 }}>
                                            🌡️ Thermal Variance Analysis
                                        </span>
                                        <span className="tm-chip-value" style={{ color: '#1e40af', fontSize: '0.8rem', fontWeight: 500, lineHeight: 1.5 }}>
                                            {thermalExplanation}
                                        </span>
                                        <div className="tm-chip-status" style={{ background: '#dbeafe', color: '#1d4ed8', borderColor: '#93c5fd' }}>
                                            ℹ️ Thermal Explanation — No system value altered
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="form-group max-w-md mx-auto mt-6">
                                <label className="text-slate-700">Analytical Remarks / Reason for Variance</label>
                                <textarea
                                    className="w-full border-2 border-slate-200 rounded-lg p-3 text-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 placeholder:text-slate-400"
                                    rows={3}
                                    placeholder="Enter forensic remarks or reconciliation notes..."
                                    value={formData.varianceReason}
                                    onChange={e => setFormData({ ...formData, varianceReason: e.target.value })}
                                />
                            </div>

                            <div className="form-group max-w-md mx-auto mt-6">
                                <SignaturePad 
                                    onSave={setSignature} 
                                    onClear={() => setSignature('')} 
                                />
                            </div>


                            <div className="tm-verification-card max-w-[448px] mx-auto my-[10px] mt-[20px]">
                                <FiCheckCircle size={18} />
                                <p>
                                    System will automatically verify the volume delta using ESP32 telemetry after confirmation.
                                </p>
                            </div>

                            <div className="form-actions pt-6 pb-2 justify-center border-t-0 bg-transparent">
                                <button type="button" className="btn-danger" onClick={() => setStep(1)}>Go Back</button>
                                <button type="submit" className="btn-submit" disabled={submitting}>
                                    {submitting ? 'Saving...' : 'Confirm Delivery'}
                                </button>
                            </div>
                        </div>
                    )}
                </form>
            </div>
        </div>,
        document.body
    );
};
