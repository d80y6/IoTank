import React, { useState, useEffect } from 'react';
import { FiAlertTriangle, FiX, FiShield, FiClock, FiActivity, FiMapPin } from 'react-icons/fi';
import '../Inventory/AddTankModal.css'; // Inheriting the premium layout and aesthetic

interface SecurityIntrusionModalProps {
    event: {
        message: string;
        metadata: {
            forensicData: {
                type: 'THEFT' | 'LEAK';
                dropRate: number;
                volumeLost?: number;
                tankName: string;
                timestamp: string;
            };
        };
    };
    onClose: () => void;
}

export const SecurityIntrusionModal: React.FC<SecurityIntrusionModalProps> = ({ event, onClose }) => {
    const { forensicData } = event.metadata;
    const isTheft = forensicData.type === 'THEFT';
    const [isHibernating, setIsHibernating] = useState(false);

    // Calculate the actual current loss based on elapsed time since the anomaly started
    // This ensures that even if the modal is snoozed and remounts later, the value doesn't "reset" 
    // but correctly reflects the ongoing background loss.
    const lossPerSecond = Number(forensicData.dropRate || 0) / 3600;
    const initialLoss = Number(forensicData.volumeLost ?? 0);
    const alertStartTime = new Date(forensicData.timestamp).getTime();

    const getRealtimeLoss = () => {
        if (!alertStartTime || isNaN(alertStartTime) || lossPerSecond <= 0) return initialLoss;
        const secondsElapsed = Math.max(0, (Date.now() - alertStartTime) / 1000);
        return initialLoss + (secondsElapsed * lossPerSecond);
    };

    const [liveCumulativeLoss, setLiveCumulativeLoss] = useState<number>(getRealtimeLoss());

    useEffect(() => {
        if (lossPerSecond <= 0) return;
        const ticker = setInterval(() => {
            setLiveCumulativeLoss(getRealtimeLoss());
        }, 1000);
        return () => clearInterval(ticker);
    }, [lossPerSecond, alertStartTime, initialLoss]);

    const triggerHibernate = () => {
        setIsHibernating(true);
        setTimeout(() => {
            setIsHibernating(false);
            onClose();
        }, 300);
    };

    return (
        <div className="add-tank-modal-overlay animate-in fade-in duration-300" onClick={triggerHibernate}>
            <div className="add-tank-modal-content max-w-2xl border-t-4 border-t-rose-500" onClick={e => e.stopPropagation()}>
                <div className="modal-header" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #4c0519 50%, #be123c 100%)' }}>
                    <div className="header-text-container">
                        <h2>{isTheft ? 'CRITICAL INTRUSION DETECTED' : 'SYSTEM LEAK DETECTED'}</h2>
                        <p>Forensic anomaly identified on {forensicData.tankName}</p>
                        <div className="modal-header-badges">
                            <span className="modal-badge slate">SECURITY PROTOCOL LEVEL 1</span>
                            <span className={`modal-badge ${isTheft ? 'rose' : 'amber'}`}>{isTheft ? 'THEFT ALERT' : 'LEAK ALERT'}</span>
                        </div>
                    </div>
                    <button className={`close-btn ${isHibernating ? 'hibernate' : ''}`} type="button" onClick={triggerHibernate} title="Dismiss Alert"><FiX size={18} /></button>
                </div>

                <div className="add-tank-form p-6">
                    <div className="error-banner mb-6" style={{ background: 'rgba(244, 63, 94, 0.06)', border: '1px solid rgba(244, 63, 94, 0.25)', borderRadius: '16px', padding: '16px 20px', display: 'flex', gap: '16px', alignItems: 'center', margin: '0' }}>
                        <div className="error-icon-container" style={{ background: 'rgba(244, 63, 94, 0.15)', width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FiAlertTriangle className="error-icon text-rose-500 animate-pulse" size={24} />
                        </div>
                        <div className="error-content flex-1">
                            <strong className="text-rose-600 text-[15px] mb-1 block">Action Required Immediately</strong>
                            <p className="text-slate-700 text-[13px] m-0">{event.message}</p>
                            <p className="text-rose-700 text-[13px] font-bold mt-1.5 m-0 bg-rose-50 p-2 rounded-lg border border-rose-100/50 inline-block">
                                {isTheft 
                                    ? "This discharge rate exceeds operational benchmarks for 'Quiet Hours'. Local security dispatch recommended." 
                                    : "Persistent downward variance detected without active pump engagement. Maintenance review required."}
                            </p>
                        </div>
                    </div>

                    <div className="atm-section mb-2">
                        <div className="atm-section-header bg-slate-50/50">
                            <div className="atm-section-icon bg-slate-800 text-white"><FiShield size={14} /></div>
                            <span className="atm-section-title text-slate-800">Forensic Diagnostics</span>
                        </div>
                        <div className="atm-section-body p-5">
                            <div className="grid grid-cols-2 gap-3">

                                {/* Card 1: Loss Rate */}
                                <div style={{
                                    background: '#fff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '14px',
                                    boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}>
                                    <div style={{ height: '3px', background: 'linear-gradient(90deg, #3b82f6, #6366f1)' }} />
                                    <div style={{ padding: '14px 16px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                            <div style={{ background: 'rgba(59,130,246,0.1)', borderRadius: '6px', padding: '4px', display: 'flex' }}>
                                                <FiActivity size={12} style={{ color: '#3b82f6' }} />
                                            </div>
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'ui-monospace, monospace' }}>Loss Rate</span>
                                        </div>
                                        <div style={{ fontSize: '24px', fontWeight: 500, color: '#1e293b', letterSpacing: '-0.02em', lineHeight: 1 }}>
                                            {Number(forensicData.dropRate || 0).toFixed(1)}
                                            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500, marginLeft: '4px' }}>L/hr</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Card 2: Cumulative Loss */}
                                <div style={{
                                    background: '#fff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '14px',
                                    boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}>
                                    <div style={{ height: '3px', background: 'linear-gradient(90deg, #f59e0b, #ef4444)' }} />
                                    <div style={{ padding: '14px 16px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                            <div style={{ background: 'rgba(245,158,11,0.1)', borderRadius: '6px', padding: '4px', display: 'flex' }}>
                                                <FiShield size={12} style={{ color: '#f59e0b' }} />
                                            </div>
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'ui-monospace, monospace' }}>Cumulative Loss</span>
                                        </div>
                                        <div style={{ fontSize: '24px', fontWeight: 500, color: '#1e293b', letterSpacing: '-0.02em', lineHeight: 1 }}>
                                            {liveCumulativeLoss !== undefined ? Number(liveCumulativeLoss).toFixed(1) : '--'}
                                            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500, marginLeft: '4px' }}>L</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Card 3: Detected At */}
                                <div style={{
                                    background: '#fff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '14px',
                                    boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}>
                                    <div style={{ height: '3px', background: 'linear-gradient(90deg, #10b981, #06b6d4)' }} />
                                    <div style={{ padding: '14px 16px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                            <div style={{ background: 'rgba(16,185,129,0.1)', borderRadius: '6px', padding: '4px', display: 'flex' }}>
                                                <FiClock size={12} style={{ color: '#10b981' }} />
                                            </div>
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'ui-monospace, monospace' }}>Detected At</span>
                                        </div>
                                        <div style={{ fontSize: '24px', fontWeight: 500, color: '#1e293b', letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'ui-monospace, monospace' }}>
                                            {forensicData.timestamp && !isNaN(new Date(forensicData.timestamp).getTime())
                                                ? new Date(forensicData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                                : '--:--:--'}
                                        </div>
                                    </div>
                                </div>

                                {/* Card 4: Status */}
                                <div style={{
                                    background: '#fff',
                                    border: '1px solid #fecdd3',
                                    borderRadius: '14px',
                                    boxShadow: '0 2px 12px rgba(244,63,94,0.08)',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}>
                                    <div style={{ height: '3px', background: 'linear-gradient(90deg, #f43f5e, #dc2626)' }} />
                                    <div style={{ padding: '14px 16px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                            <div style={{ background: 'rgba(244,63,94,0.1)', borderRadius: '6px', padding: '4px', display: 'flex' }}>
                                                <FiMapPin size={12} style={{ color: '#f43f5e' }} />
                                            </div>
                                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'ui-monospace, monospace' }}>Status</span>
                                        </div>
                                        <div style={{ fontSize: '14px', fontWeight: 500, color: '#f43f5e', letterSpacing: '0.04em', lineHeight: 1, background: 'rgba(244,63,94,0.07)', padding: '6px 10px', borderRadius: '8px', display: 'inline-block' }}>
                                            SHIFT CLOSED
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                    <div className="form-actions pt-6 justify-end gap-4 border-t-0 bg-transparent mb-0 pb-0 mt-4">
                        <button onClick={triggerHibernate} className="btn-cancel" style={{ padding: '14px 28px', fontSize: '13px' }}>
                            Log Investigation Only
                        </button>
                        <button onClick={() => {
                            window.dispatchEvent(new CustomEvent('system-toast', {
                                detail: { title: 'Security Notified', message: 'Regional response team has been alerted.', type: 'error' }
                            }));
                            triggerHibernate();
                        }} className="btn-submit" style={{ padding: '14px 28px', fontSize: '13px', background: 'linear-gradient(135deg, #e11d48 0%, #9f1239 100%)', boxShadow: '0 8px 20px -4px rgba(225, 29, 72, 0.4)' }}>
                            <FiShield size={16} />
                            {isTheft ? 'Dispatch Security Team' : 'Request Maintenance'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

