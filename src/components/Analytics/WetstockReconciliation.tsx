import React, { useMemo } from 'react';
import { FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { Tank, FuelTransaction } from '@/types';

interface WetstockReconciliationProps {
    tanks: Tank[];
    transactions: FuelTransaction[];
    currency: 'Ksh';
    activeShift?: any;
}

export const WetstockReconciliation: React.FC<WetstockReconciliationProps> = ({ tanks, transactions, currency, activeShift }) => {
    // Calculate forensic reconciliation metrics from telemetry and transactions
    const reconData = useMemo(() => {
        // [ONE TRUTH]: Opening stock is derived from the active shift snapshot (Database-backed)
        const snapshots = activeShift?.metadata?.tank_snapshots || {};
        
        const openingStock = tanks.reduce((sum, t) => {
            // Priority: Snapshot -> Tank Volume -> 0
            const snapshotVol = snapshots[t.id]?.opening_volume;
            return sum + (snapshotVol !== undefined ? snapshotVol : (t.currentVolume || 0));
        }, 0);
        
        // Deliveries and Sales from transactions for "Expected" profile
        const deliveries = transactions.filter(tx => tx.type === 'delivery').reduce((sum, tx) => sum + tx.amount, 0);
        const transactionalSales = transactions.filter(tx => tx.type === 'sale').reduce((sum, tx) => sum + tx.amount, 0);
        
        // Measured Closing (Live Telemetry)
        const measuredClosing = tanks.reduce((sum, t) => sum + (t.currentVolume || 0), 0);

        // [TELEMETRIC DELTA]: As requested, 'Dispensed' shown in UI follows telemetry
        const dispensedTelemetric = Math.max(0, openingStock - measuredClosing);
        
        // Reconciliation: Reality (Measured) vs Expected (Opening + Deliveries - Transactions)
        const expectedClosing = openingStock + deliveries - transactionalSales;
        const variance = measuredClosing - expectedClosing;
        const variancePct = expectedClosing > 0 ? (variance / expectedClosing) * 100 : 0;
        const varianceCost = Math.abs(variance) * (currency === 'Ksh' ? 190.50 : 1.45);

        return {
            openingStock,
            deliveries,
            dispensed: dispensedTelemetric, // Telemetrically derived
            expectedClosing,
            measuredClosing,
            variance,
            variancePct,
            varianceCost,
            score: Math.max(0, 100 - Math.abs(variancePct) * 50)
        };
    }, [tanks, transactions, currency, activeShift]);

    const isHealthy = Math.abs(reconData.variancePct) < 0.5;

    return (
        <div className="acp-card">
            <div className="acp-card-header pb-2 mb-3">
                <div className="acp-card-title">
                    <div className="acp-section-icon acp-icon-accent-purple"><FiCheckCircle /></div>
                    <div className="flex flex-col">
                        <h3>Wetstock Reconciliation (WRe)</h3>
                        <span className="text-[10px] font-black uppercase tracking-tighter opacity-50">Operational Forensic Ledger</span>
                    </div>
                </div>
                <div className="acp-header-badge !bg-slate-100 !text-slate-600 !border-slate-200" style={{ margin: 0 }}>
                    SCORE: {reconData.score.toFixed(1)}%
                </div>
            </div>

            {/* ── Mathematical Ledger Section ─────────────────────────── */}
            <div className="flex flex-col gap-2 p-4 bg-slate-50/50 rounded-xl border border-slate-100 mb-4">
                <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-500 uppercase tracking-widest">Opening Stock</span>
                    <span className="font-black text-slate-900">{reconData.openingStock.toLocaleString()} L</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-success uppercase tracking-widest">+ Deliveries</span>
                    <span className="font-black text-success">{reconData.deliveries.toLocaleString()} L</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-danger uppercase tracking-widest">- Dispensed</span>
                    <span className="font-black text-danger">{reconData.dispensed.toLocaleString()} L</span>
                </div>
                <div className="h-px bg-slate-200 my-1"></div>
                <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">= Expected Stock</span>
                    <span className="font-black text-slate-900">{reconData.expectedClosing.toLocaleString()} L</span>
                </div>
            </div>

            {/* ── Variance & Impact Section ────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-4 bg-white rounded-xl border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Delta Variance</div>
                    <div className={`text-xl font-black ${isHealthy ? 'text-success' : 'text-danger'} leading-none`}>
                        {reconData.variance.toFixed(1)} L 
                        <span className="text-[10px] opacity-40 ml-2">({reconData.variancePct.toFixed(2)}%)</span>
                    </div>
                    {isHealthy ? (
                        <FiCheckCircle className="absolute -bottom-2 -right-2 opacity-5 text-success" size={48} />
                    ) : (
                        <FiAlertCircle className="absolute -bottom-2 -right-2 opacity-5 text-danger" size={48} />
                    )}
                </div>
                <div className="p-4 bg-white rounded-xl border border-slate-100 shadow-sm">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Financial Impact</div>
                    <div className="text-xl font-black text-slate-900 leading-none">
                        {currency} {reconData.varianceCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                </div>
            </div>

            {/* ── Drift Legend & Progress ─────────────────────────────── */}
            <div className="acp-variance-hero !p-0 !bg-transparent !border-none !mb-0 shadow-none">
                <div className="acp-progress-bar !h-1.5 !mb-2">
                    <div 
                        className="acp-progress-fill" 
                        style={{ 
                            width: `${Math.min(100, Math.max(0, 50 + reconData.variancePct * 10))}%`, 
                            background: isHealthy ? 'var(--color-success)' : 'var(--color-danger)' 
                        }}
                    ></div>
                </div>
                <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-widest opacity-60">
                    <span>Negative Drift (-0.5%)</span>
                    <span className="text-slate-900">Neutral Point (0.00%)</span>
                    <span>Positive Drift (+0.5%)</span>
                </div>
            </div>
        </div>

    );
};
