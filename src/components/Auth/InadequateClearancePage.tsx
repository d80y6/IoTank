import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiLock, FiArrowLeft, FiShield, FiAlertTriangle } from 'react-icons/fi';
import { AuditService } from '@/services/AuditService';
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/utils/logger';
import './InadequateClearancePage.css';

export const InadequateClearancePage: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    useEffect(() => {
        if (currentUser) {
            AuditService.log(
                'SECURITY',
                'DEVICE_COMMAND', // Using this as a proxy for access violation until generic SECURITY type is added
                currentUser.stationId || 'SYSTEM',
                `Access Denied (403-A): User ${currentUser.email} attempted to access a restricted module.`,
                'CRITICAL',
                {
                    attempted_path: window.location.pathname,
                    user_role: currentUser.role,
                    auth_level: currentUser.authLevel
                }
            ).catch(err => logger.error('[Audit Log Failed]', err));
        }
    }, [currentUser]);

    return (
        <div className="clearance-page-wrapper">
            <div className="clearance-card">
                <div className="clearance-icon-header">
                    <div className="shield-ring">
                        <FiShield size={40} className="clearance-shield-icon" />
                    </div>
                    <div className="lock-overlay">
                        <FiLock size={18} className="clearance-lock-icon" />
                    </div>
                </div>

                <div className="clearance-content">
                    <h1 className="clearance-title">Inadequate Clearance</h1>
                    <p className="clearance-subtitle">
                        Your current identity level does not have authorization to access this forensic module.
                    </p>
                    
                    <div className="clearance-alert-box">
                        <FiAlertTriangle className="clearance-alert-icon" />
                        <span>Security Protocol 403-A: Access Attempt has been logged to the central audit timeline.</span>
                    </div>

                    <div className="clearance-remedy">
                        <h3>How to resolve?</h3>
                        <p>Contact your Station Administrator to upgrade your role or request temporary mission credentials.</p>
                    </div>

                    <div className="clearance-actions">
                        <button 
                            className="clearance-btn-primary"
                            onClick={() => navigate('/dashboard')}
                        >
                            <FiArrowLeft /> Return to Dashboard
                        </button>
                    </div>
                </div>
                
                <div className="clearance-footer">
                    <span>IoTank V2.0.0 Forensic Security Layer</span>
                </div>
            </div>
        </div>
    );
};
