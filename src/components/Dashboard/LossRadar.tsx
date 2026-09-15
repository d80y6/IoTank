import React, { useState, useEffect } from 'react';
import { FiCrosshair, FiAlertTriangle, FiArrowRight } from 'react-icons/fi';
import { TodayVarianceReviewPanel } from './TodayVarianceReviewPanel';
import '../Common/DesignSystemCards.css';

export const LossRadar: React.FC = () => {
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [lossData, setLossData] = useState(() => {
        try {
            const stored = localStorage.getItem('iotank_latest_loss_data');
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    });

    useEffect(() => {
        const handleShiftChange = () => {
            const stored = localStorage.getItem('iotank_latest_loss_data');
            setLossData(stored ? JSON.parse(stored) : null);
        };
        window.addEventListener('iotank_shift_changed', handleShiftChange);
        return () => window.removeEventListener('iotank_shift_changed', handleShiftChange);
    }, []);

    // Defensive fallback
    const dataToUse = lossData || {
        pumpSales: 0,
        tankDrawdown: 0,
        difference: 0,
        estimatedValueKes: 0,
        dataConfidence: 100
    };

    return (
        <>
            <div className="ds-card ds-card-panel p-6 h-full flex flex-col justify-between group transition-all duration-500 hover:shadow-2xl hover:shadow-rose-500/10 border-rose-500/20 bg-gradient-to-br from-white/95 to-rose-50/30 backdrop-blur-xl group">
                <div className="flex-1">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-gradient-to-br from-rose-500 to-red-600 text-white rounded-2xl shadow-lg shadow-rose-500/20 group-hover:scale-110 transition-transform">
                                <FiCrosshair size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Volatility Radar</h3>
                                <p className="text-[10px] text-rose-600 font-bold uppercase tracking-widest opacity-80">Variance Detection</p>
                            </div>
                        </div>
                        <span className="text-[9px] font-black bg-rose-500 text-white px-3 py-1 rounded-full uppercase tracking-widest border border-rose-400 shadow-sm shadow-rose-200">Security Check</span>
                    </div>

                    <div className="mb-8 p-1">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                            Total Unexplained Variance
                            <div className="h-px flex-1 bg-slate-100"></div>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className={`text-4xl font-black tracking-tighter tabular-nums ${dataToUse.difference < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {dataToUse.difference > 0 ? '+' : ''}{(dataToUse.difference || 0).toFixed(1)}L
                                </span>
                                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">Net Stock Shift</span>
                            </div>
                            <div className="p-4 bg-white rounded-2xl border-2 border-slate-50 shadow-inner flex flex-col items-end">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Value Impact</span>
                                <span className="text-xl font-black text-slate-800 tabular-nums uppercase">
                                    Ksh {Math.abs(dataToUse.estimatedValueKes || 0).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-900 rounded-3xl p-5 mb-8 relative overflow-hidden group/cause border border-slate-800 shadow-2xl">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <FiAlertTriangle size={60} className="text-amber-500" />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-pulse"></div>
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Primary Risk Analysis</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <div>
                                    <span className="text-sm font-black text-white block mb-0.5 tracking-tight uppercase">{dataToUse.difference !== 0 ? 'Inventory Mismatch' : 'Inventory Stable'}</span>
                                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{dataToUse.difference !== 0 ? 'Stock-Outlier Detected' : 'No Anomalies Found'}</span>
                                </div>
                                <div className="text-right">
                                    <div className="flex flex-col items-center">
                                        <div className="relative w-12 h-12 flex items-center justify-center">
                                            <svg className="w-full h-full transform -rotate-90">
                                                <circle cx="24" cy="24" r="20" fill="none" stroke="#1e293b" strokeWidth="4" />
                                                <circle cx="24" cy="24" r="20" fill="none" stroke="#f59e0b" strokeWidth="4" strokeDasharray={`${(dataToUse.dataConfidence || 0) * 1.256} 125.6`} strokeLinecap="round" />
                                            </svg>
                                            <span className="absolute text-[10px] font-black text-white">{(dataToUse.dataConfidence || 0)}%</span>
                                        </div>
                                        <span className="text-[8px] font-black text-slate-500 uppercase tracking-tighter mt-1">CONFIDENCE</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <button
                    className="w-full py-4 px-6 rounded-2xl font-black text-xs transition-all duration-300
                               bg-slate-900 text-white hover:bg-white hover:text-slate-900 border-2 border-slate-900
                               flex justify-center items-center gap-4 shadow-xl shadow-slate-900/10 uppercase tracking-[0.2em] group/btn"
                    onClick={() => setIsPanelOpen(true)}
                >
                    Deep Dive Analysis <FiArrowRight className="group-hover/btn:translate-x-2 transition-transform" />
                </button>
            </div>

            {isPanelOpen && (
                <TodayVarianceReviewPanel
                    onClose={() => setIsPanelOpen(false)}
                    varianceData={dataToUse}
                    onReviewComplete={() => {
                        // Variance Review Submitted
                    }}
                />
            )}
        </>
    );
};
