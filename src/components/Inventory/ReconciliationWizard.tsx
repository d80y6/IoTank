import React, { useState } from 'react';
import { FiTarget, FiCheckCircle, FiAlertTriangle, FiArrowRight, FiX } from 'react-icons/fi';
import { Tank } from '@/types';
import { formatVolume } from '@/utils/formatUtils';
import { useTransactions } from '@/hooks/useTransactions';
import './ReconciliationWizard.css';

interface ReconciliationWizardProps {
    tank: Tank;
    currentAtgVolume: number;
    onClose: () => void;
}

export const ReconciliationWizard: React.FC<ReconciliationWizardProps> = ({ tank, currentAtgVolume, onClose }) => {
    const [step, setStep] = useState(1);
    const [physicalDip, setPhysicalDip] = useState<number>(0);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { logTransaction } = useTransactions(tank.stationId);

    const variance = physicalDip - currentAtgVolume;
    const variancePercent = (variance / currentAtgVolume) * 100;

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            await logTransaction({
                type: 'reconciliation',
                tankId: tank.id,
                amount: variance,
                performedBy: 'admin-123', // Demo ID
                metadata: {
                    atgVolume: currentAtgVolume,
                    physicalVolume: physicalDip,
                    variance,
                    notes
                }
            });
            setStep(3); // Success step
        } catch (error) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Reconciliation Failed',
                    message: 'Error persisting reconciliation. Please try again.',
                    type: 'error',
                    attribution: 'RECONCILIATION ENGINE'
                }
            }));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="wizard-overlay">
            <div className="wizard-container card max-w-md w-full p-8 relative">
                <button className="absolute top-4 right-4 btn btn-icon" onClick={onClose}><FiX /></button>

                {step === 1 && (
                    <div className="wizard-step flex flex-col items-center">
                        <FiTarget size={48} className="text-accent mb-6" />
                        <h2 className="text-xl font-bold mb-2">Physical Reconciliation</h2>
                        <p className="text-secondary text-sm text-center mb-8">
                            Log a physical dip measurement for <strong>{tank.name}</strong> to synchronize the ATG system.
                        </p>

                        <div className="form-group w-full mb-6">
                            <label className="text-xs uppercase font-bold text-secondary mb-2 block">Physical Reading (Liters)</label>
                            <input
                                type="number"
                                className="form-control text-2xl py-4"
                                value={physicalDip === 0 ? '' : physicalDip}
                                onChange={(e) => setPhysicalDip(Number(e.target.value))}
                                placeholder="Enter dip stick volume..."
                                autoFocus
                            />
                        </div>

                        <div className="atg-ref bg-white/5 p-4 rounded w-full mb-8 flex justify-between items-center border border-white/5">
                            <span className="text-xs text-secondary">Current ATG Reading:</span>
                            <span className="font-bold text-accent">{formatVolume(currentAtgVolume)}</span>
                        </div>

                        <button
                            className="btn btn-primary btn-block py-4 flex items-center justify-center gap-2"
                            onClick={() => setStep(2)}
                            disabled={physicalDip <= 0}
                        >
                            Next: Review Variance <FiArrowRight />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="wizard-step">
                        <h2 className="text-xl font-bold mb-4">Review Variance</h2>
                        <div className="variance-grid grid grid-cols-2 gap-4 mb-8">
                            <div className="p-4 bg-white/5 rounded">
                                <span className="text-xs text-secondary block mb-1">ATG Volume</span>
                                <span className="text-lg font-bold">{formatVolume(currentAtgVolume)}</span>
                            </div>
                            <div className="p-4 bg-white/5 rounded">
                                <span className="text-xs text-secondary block mb-1">Physical Dip</span>
                                <span className="text-lg font-bold">{formatVolume(physicalDip)}</span>
                            </div>
                            <div className={`p-4 rounded col-span-2 flex justify-between items-center ${Math.abs(variancePercent) > 0.5 ? 'bg-danger/10 border border-danger/20' : 'bg-success/10 border border-success/20'}`}>
                                <div>
                                    <span className="text-xs text-secondary block mb-1">Calculated Variance</span>
                                    <span className={`text-2xl font-bold ${variance < 0 ? 'text-danger' : 'text-success'}`}>
                                        {variance > 0 ? '+' : ''}{variance.toFixed(1)} L
                                    </span>
                                </div>
                                <div className="text-right">
                                    <span className={`text-sm font-bold block ${Math.abs(variancePercent) > 0.5 ? 'text-danger' : 'text-success'}`}>
                                        {variancePercent.toFixed(2)}%
                                    </span>
                                    {Math.abs(variancePercent) > 0.5 && <FiAlertTriangle className="text-danger inline" />}
                                </div>
                            </div>
                        </div>

                        <div className="form-group mb-8">
                            <label className="text-xs uppercase font-bold text-secondary mb-2 block">Reconciliation Notes</label>
                            <textarea
                                className="form-control"
                                rows={3}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="E.g. Temperature shift, suspected evaporation, or theft check..."
                            ></textarea>
                        </div>

                        <div className="flex gap-4">
                            <button className="btn btn-outline flex-1" onClick={() => setStep(1)}>Back</button>
                            <button
                                className="btn btn-primary flex-2"
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Persisting...' : 'Confirm & Reconcile'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="wizard-step flex flex-col items-center py-8">
                        <FiCheckCircle size={64} className="text-success mb-6 animate-bounce" />
                        <h2 className="text-2xl font-bold mb-2">Sync Complete</h2>
                        <p className="text-secondary text-center mb-8">
                            Inventory records for <strong>{tank.name}</strong> have been updated.
                            The variance of {variance.toFixed(1)} L has been logged to the audit trail.
                        </p>
                        <button className="btn btn-primary btn-block" onClick={onClose}>Return to Hub</button>
                    </div>
                )}
            </div>
        </div>
    );
};
