import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiInfo, FiUploadCloud, FiCheckCircle, FiTruck } from 'react-icons/fi';
import { DeliveryDocument } from '@/types';

interface DeliveryReconciliationFormProps {
    onClose: () => void;
    // Pre-filled data passed from parent for read-only section
    deliveryData: {
        invoiceVolume: number;
        measuredStandardized: number;
        variance: number;
        tolerance: number;
        status: string;
    };
    onSubmit: (data: Partial<DeliveryDocument>) => void;
}

export const DeliveryReconciliationForm: React.FC<DeliveryReconciliationFormProps> = ({ onClose, deliveryData, onSubmit }) => {
    // Editable state
    const [confirmedInvoice, setConfirmedInvoice] = useState(deliveryData.invoiceVolume.toString());
    const [deliveryTemp, setDeliveryTemp] = useState('');
    const [physicalDip, setPhysicalDip] = useState('');
    const [supplierStatus, setSupplierStatus] = useState<string>('');
    const [explanation, setExplanation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAction = async (action: 'verified' | 'flagged') => {
        if (!supplierStatus) return;
        if (action === 'flagged' && explanation.trim().length < 5) return;

        setIsSubmitting(true);
        // Simulate network request
        await new Promise(resolve => setTimeout(resolve, 800));

        onSubmit({
            invoiceLiters: parseFloat(confirmedInvoice) || deliveryData.invoiceVolume,
            // the new schema uses `status: 'VERIFIED' | 'NEEDS_REVIEW' | 'DISPUTED'`
            status: action === 'verified' ? 'VERIFIED' : 'DISPUTED',
            verified: action === 'verified',
            notes: `Supplier Status: ${supplierStatus} | Temp: ${deliveryTemp}°C | Dip: ${physicalDip}L | Explanation: ${explanation}`
        });

        setIsSubmitting(false);
        onClose();
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
                        <h2 className="text-xl font-black text-slate-800 tracking-tight">Delivery Verification</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Waybill & Physics Audit</p>
                    </div>
                    <button className="close-btn" type="button" onClick={onClose} title="Close Verification Panel">
                        <FiX />
                    </button>
                </div>

                <div className="modal-body overflow-y-auto custom-scrollbar flex-1 pr-1" style={{ maxHeight: 'calc(90vh - 180px)' }}>
                    <div className="space-y-8 p-1">
                        {/* Section 1: Pre-Filled System Data */}
                        <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100 text-slate-500">
                                    <FiInfo size={16} />
                                </div>
                                <span className="text-xs font-black text-slate-800 uppercase tracking-widest">System Record</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Invoice Volume</span>
                                    <span className="text-lg font-black text-slate-700">{(deliveryData.invoiceVolume || 0).toLocaleString()}L</span>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Measured (Standardized)</span>
                                    <span className="text-lg font-black text-slate-700">{(deliveryData.measuredStandardized || 0).toLocaleString()}L</span>
                                </div>
                                <div className={`p-4 rounded-2xl border shadow-sm md:col-span-2 flex justify-between items-center ${deliveryData.variance < 0 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                                    <div>
                                        <span className={`text-[10px] font-black uppercase tracking-widest block mb-1 ${deliveryData.variance < 0 ? 'text-amber-500' : 'text-emerald-500'}`}>System Variance</span>
                                        <span className={`text-2xl font-black ${deliveryData.variance < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{deliveryData.variance}L</span>
                                    </div>
                                    <div className={`p-2.5 rounded-xl ${deliveryData.variance < 0 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                        <FiTruck size={24} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Section 2: User Verification Log */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-50 rounded-lg shadow-sm border border-emerald-100 text-emerald-500">
                                    <FiCheckCircle size={16} />
                                </div>
                                <span className="text-xs font-black text-slate-800 uppercase tracking-widest">Physical Verification</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                        Confirmed Invoice (L) <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-700 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all"
                                        value={confirmedInvoice}
                                        onChange={(e) => setConfirmedInvoice(e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                            Delivery Temp (°C)
                                        </label>
                                        <input
                                            type="number"
                                            placeholder="Ambient"
                                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-700 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all"
                                            value={deliveryTemp}
                                            onChange={(e) => setDeliveryTemp(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                            Physical Dip Check (L)
                                        </label>
                                        <input
                                            type="number"
                                            placeholder="Optional"
                                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-700 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all"
                                            value={physicalDip}
                                            onChange={(e) => setPhysicalDip(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                        Supplier Status <span className="text-rose-500">*</span>
                                    </label>
                                    <select
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-bold text-slate-700 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all appearance-none cursor-pointer"
                                        value={supplierStatus}
                                        onChange={(e) => setSupplierStatus(e.target.value)}
                                    >
                                        <option value="" disabled>Select status...</option>
                                        <option value="Confirmed Full">Confirmed Full</option>
                                        <option value="Partial Delivery">Partial Delivery</option>
                                        <option value="Suspected Underfill">Suspected Underfill</option>
                                    </select>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                        Discrepancy Notes / Explanation
                                    </label>
                                    <textarea
                                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium text-slate-700 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all resize-none h-32"
                                        placeholder="Record any physical dip differences or driver comments..."
                                        value={explanation}
                                        onChange={(e) => setExplanation(e.target.value)}
                                    />
                                </div>

                                <div className="md:col-span-2 p-6 border-2 border-dashed border-slate-200 rounded-3xl group hover:border-emerald-400 transition-colors cursor-pointer flex flex-col items-center justify-center gap-3 bg-slate-50/30">
                                    <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 text-slate-400 group-hover:text-emerald-500 transition-colors">
                                        <FiUploadCloud size={24} />
                                    </div>
                                    <div className="text-center">
                                        <div className="text-xs font-black text-slate-800 uppercase tracking-widest mb-1">Upload Waybill Photo</div>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Recommended for discrepancies &gt; 50L</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="form-actions shrink-0 mt-8 pt-6 border-t border-slate-100 flex gap-4">
                    <button
                        onClick={() => handleAction('flagged')}
                        disabled={isSubmitting || !supplierStatus || explanation.trim().length < 5}
                        className="flex-1 py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all
                                   bg-slate-100 text-slate-400 hover:bg-rose-50 hover:text-rose-500 
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Flag Discrepancy
                    </button>
                    <button
                        onClick={() => handleAction('verified')}
                        disabled={isSubmitting || !supplierStatus}
                        className="flex-[2] py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all
                                   bg-slate-900 text-white hover:bg-black shadow-lg shadow-slate-200
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Syncing Audit...' : 'Approve Delivery'}
                    </button>
                </div>
                </div>
            </div>
        </>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(modalContent, document.body);
};
