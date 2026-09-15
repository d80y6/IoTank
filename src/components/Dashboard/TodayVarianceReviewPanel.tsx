/* eslint-disable react/no-unescaped-entities */
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiInfo, FiUploadCloud, FiCheckCircle } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { AuditService } from '@/services/AuditService';
import { supabase } from '@/config/supabase';
import { LossReview } from '../../types';

interface TodayVarianceReviewPanelProps {
    onClose: () => void;
    // Variance data passed from LossRadar (sourced from ShiftClose data)
    varianceData: {
        pumpSales: number;
        tankDrawdown: number;
        difference: number;
        estimatedValueKes: number;
        dataConfidence: number;
    };
    onReviewComplete: (data: Partial<LossReview>) => void;
}

export const TodayVarianceReviewPanel: React.FC<TodayVarianceReviewPanelProps> = ({ onClose, varianceData, onReviewComplete }) => {
    const [category, setCategory] = useState<LossReview['selectedCause'] | ''>('');
    const [explanation, setExplanation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { currentUser } = useAuth();

    // If difference is greater than 50L (math abs), require explanation
    const requiresExplanation = Math.abs(varianceData.difference) > 50;

    const handleAction = async (action: 'reviewed' | 'escalated') => {
        if (!category) return;
        if (requiresExplanation && explanation.trim().length < 10) return;

        setIsSubmitting(true);
        try {
            // 1. Upload evidence photo if provided
            let photoUrl: string | undefined = undefined;
            if (evidenceFile && currentUser?.stationId) {
                const path = `variance-evidence/${currentUser.stationId}/${Date.now()}_${evidenceFile.name}`;
                const { error: uploadErr } = await supabase.storage
                    .from('forensic-attachments')
                    .upload(path, evidenceFile, { upsert: false });
                if (!uploadErr) {
                    const { data: urlData } = supabase.storage.from('forensic-attachments').getPublicUrl(path);
                    photoUrl = urlData.publicUrl;
                }
            }

            // 2. Persist variance review record to Supabase
            const { error: insertErr } = await supabase.from('loss_reviews').insert({
                station_id: currentUser?.stationId,
                reviewed_by: currentUser?.authUserId,
                variance_liters: varianceData.difference,
                pump_sales: varianceData.pumpSales,
                tank_drawdown: varianceData.tankDrawdown,
                estimated_value_kes: varianceData.estimatedValueKes,
                selected_cause: category,
                explanation: explanation || null,
                action_taken: action,
                photo_url: photoUrl || null,
                date: new Date().toISOString().split('T')[0],
            });

            if (insertErr) throw insertErr;

            // 3. Notify parent and show success toast
            onReviewComplete({
                varianceLiters: varianceData.difference,
                selectedCause: category as LossReview['selectedCause'],
                explanation,
                photoUrl,
                reviewedBy: currentUser?.authUserId || 'unknown',
                timestamp: Date.now(),
            });

            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Forensic Review Archived',
                    message: `${varianceData.difference.toFixed(1)}L variance attributed to "${category}" and saved to the audit ledger.`,
                    type: 'success',
                    attribution: 'LOSS RADAR'
                }
            }));

            await AuditService.log(
                'CALIBRATION',
                'SETTINGS_CHANGED',
                currentUser?.stationId || 'SYSTEM',
                `Variance review finalized: ${varianceData.difference.toFixed(1)}L categorized as "${category}". Explanation: ${explanation || 'None provided.'}`,
                action === 'escalated' ? 'WARNING' : 'INFO',
                { variance: varianceData.difference, category, action, explanation }
            ).catch(() => {});

            onClose();
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Save Failed',
                    message: err?.message || 'Failed to persist variance review. Please try again.',
                    type: 'error',
                    attribution: 'LOSS RADAR'
                }
            }));
        } finally {
            setIsSubmitting(false);
        }
    };

    const modalContent = (
        <>
            {/* Backdrop */}
        <div className="add-tank-modal-overlay animate-in fade-in duration-300" onClick={onClose}>
            <div 
                className="add-tank-modal-content max-w-2xl" 
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header shrink-0 border-b border-slate-100 pb-5 mb-0">
                    <div className="header-text-container">
                        <h2 className="text-xl font-black text-slate-800 tracking-tight">Variance Analysis</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Loss Radar Intelligence</p>
                    </div>
                    <button 
                        className="close-btn" 
                        type="button" 
                        onClick={onClose}
                        title="Close Analysis Panel"
                    >
                        <FiX />
                    </button>
                </div>

                <div className="modal-body overflow-y-auto custom-scrollbar flex-1 pr-1 variance-panel-body">
                    <div className="space-y-8 p-1">
                        {/* Section 1: Auto Breakdown */}
                        <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100 text-slate-500">
                                    <FiInfo size={16} />
                                </div>
                                <span className="text-xs font-black text-slate-800 uppercase tracking-widest">Telemetry Breakdown</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Pump Sales</span>
                                    <span className="text-lg font-black text-slate-700">{(varianceData.pumpSales || 0).toLocaleString()}L</span>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Tank Drawdown</span>
                                    <span className="text-lg font-black text-slate-700">{(varianceData.tankDrawdown || 0).toLocaleString()}L</span>
                                </div>
                                <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100 shadow-sm md:col-span-2 flex justify-between items-center">
                                    <div>
                                        <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest block mb-1">Unexplained Difference</span>
                                        <span className="text-2xl font-black text-rose-700">{(varianceData.difference || 0).toFixed(1)}L</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] font-bold text-rose-400 uppercase block mb-1">Valuation</span>
                                        <span className="text-sm font-black text-rose-800 bg-white/50 px-3 py-1 rounded-full border border-rose-200">
                                            Ksh {(varianceData.estimatedValueKes || 0).toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Section 2: User Analysis */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-50 rounded-lg shadow-sm border border-indigo-100 text-indigo-500">
                                    <FiCheckCircle size={16} />
                                </div>
                                <span className="text-xs font-black text-slate-800 uppercase tracking-widest">Manual Categorization</span>
                            </div>

                            <div className="grid grid-cols-1 gap-6">
                                <div>
                                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                        Suspected Root Cause <span className="text-rose-500">*</span>
                                    </label>
                                    <select
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all appearance-none cursor-pointer"
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value as LossReview['selectedCause'])}
                                        title="Select Suspected Root Cause"
                                    >
                                        <option value="" disabled>Select cause...</option>
                                        <option value="Delivery Adjustment">Delivery Adjustment</option>
                                        <option value="Shift Reconciliation Gap">Shift Reconciliation Gap</option>
                                        <option value="Meter Calibration">Meter Calibration</option>
                                        <option value="Tank Temperature Shift">Tank Temperature Shift</option>
                                        <option value="Suspected Leak">Suspected Leak</option>
                                        <option value="Unknown">Unknown / Investigation Required</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                        Analysis Explanation {requiresExplanation && <span className="text-rose-500">* Required</span>}
                                    </label>
                                    <textarea
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all resize-none h-32"
                                        placeholder="Describe the anomalies observed..."
                                        value={explanation}
                                        onChange={(e) => setExplanation(e.target.value)}
                                    />
                                </div>

                                <div 
                                    className={`p-6 border-2 border-dashed rounded-3xl group hover:border-indigo-400 transition-colors cursor-pointer flex flex-col items-center justify-center gap-3 bg-slate-50/30 ${evidenceFile ? 'border-emerald-400 bg-emerald-50/30' : 'border-slate-200'}`}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        className="hidden"
                                        accept="image/*,.pdf"
                                        title="Upload Evidence"
                                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                                    />
                                    <div className={`p-3 bg-white rounded-2xl shadow-sm border border-slate-100 transition-colors ${evidenceFile ? 'text-emerald-500' : 'text-slate-400 group-hover:text-indigo-500'}`}>
                                        {evidenceFile ? <FiCheckCircle size={24} /> : <FiUploadCloud size={24} />}
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs font-black text-slate-800 uppercase tracking-widest mb-1">
                                            {evidenceFile ? 'Evidence Attached' : 'Attach Evidence'}
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                                            {evidenceFile ? evidenceFile.name : 'Upload receipt or meter log (JPG, PDF)'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="form-actions shrink-0 mt-8 pt-6 border-t border-slate-100 flex gap-4">
                    <button
                        onClick={() => handleAction('escalated')}
                        disabled={isSubmitting || !category}
                        className="flex-1 py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all
                                   bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Escalate Analysis
                    </button>
                    <button
                        onClick={() => handleAction('reviewed')}
                        disabled={isSubmitting || !category || (requiresExplanation && explanation.trim().length < 10)}
                        className="flex-[2] py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all
                                   bg-slate-900 text-white hover:bg-black shadow-lg shadow-slate-200
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Syncing...' : 'Complete Review'}
                    </button>
                </div>
                </div>
            </div>
        </>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(modalContent, document.body);
};
