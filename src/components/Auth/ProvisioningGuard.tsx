import React, { useState, useEffect } from 'react';
import { supabase } from '../../config/supabase';
import { useAuth } from '@/hooks/useAuth';
import { FiRefreshCw, FiCheckCircle, FiLoader, FiShield, FiCpu, FiActivity, FiServer, FiLock } from 'react-icons/fi';
import { logger } from '@/utils/logger';
import './ProvisioningGuard.css';

interface ProvisioningGuardProps {
    children: React.ReactNode;
}

/**
 * Premium ProvisioningGuard with Violet Glassmorphism aesthetic.
 */
export const ProvisioningGuard: React.FC<ProvisioningGuardProps> = ({ children }) => {
    const { currentUser, signOut, enrichUserFromSupabase } = useAuth();
    const [isRetrying, setIsRetrying] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Performing secure identity handshake...');
    const [activeStep, setActiveStep] = useState(1);
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    const isProvisioned = !!currentUser?.stationId;
    const isSystem = currentUser?.isSystemAccount;

    // Dynamic progress steps based on provisioning state
    useEffect(() => {
        if (!isProvisioned && !isSystem && currentUser) {
            // Steps 1 & 2 happen almost instantly
            const timer1 = setTimeout(() => {
                setStatusMessage('Handshake complete. Securing session layer...');
                setActiveStep(2);
            }, 600);
            
            const timer2 = setTimeout(() => {
                setStatusMessage('Allocating station resources and telemetry nodes...');
                setActiveStep(3);
            }, 1200);
            
            const timer3 = setTimeout(() => {
                setStatusMessage('Finalizing real-time telemetry uplink...');
                setActiveStep(4);
            }, 1800);

            return () => {
                clearTimeout(timer1);
                clearTimeout(timer2);
                clearTimeout(timer3);
            };
        }
    }, [isProvisioned, isSystem, currentUser]);

    const handleRetry = () => {
        setIsRetrying(true);
        setStatusMessage('Re-synchronizing security clearance with the Provisioning Hub...');
        enrichUserFromSupabase();
        setTimeout(() => {
            setIsRetrying(false);
        }, 2000);
    };

    const handleDiagnostic = async () => {
        try {
            const { data, error } = await supabase.rpc('check_my_identity');
            if (error) throw error;
            // IDENTITY_DIAGNOSTIC checked
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Diagnostic Report',
                    message: `Status: ${data.auth_user ? 'Authenticated' : 'Unauthenticated'}\nProfile: ${data.profile ? 'Found' : 'MISSING'}\n\nCheck browser console for full payload.`,
                    type: data.profile ? 'success' : 'warning',
                    attribution: 'IDENTITY SYSTEM'
                }
            }));
        } catch (err) {
            logger.error('[DEBUG_LOG] Diagnostic failed:', err);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Diagnostic Failed',
                    message: 'Diagnostic function not found in DB. Please run the migration first.',
                    type: 'error',
                    attribution: 'IDENTITY SYSTEM'
                }
            }));
        }
    };

    if (!isProvisioned && !isSystem && currentUser) {
        return (
            <div className="provisioning-overlay">
                <div className="provisioning-card">
                    <div className="provisioning-header">
                        <div className="provisioning-logo-box">
                            <FiServer />
                        </div>
                        <h2 className="provisioning-title">System Initialization</h2>
                        <p className="provisioning-subtitle">Configuring your secure enterprise environment</p>
                    </div>

                    <div className="provisioning-body">
                        <div className="provisioning-loader-wrap">
                            <div className="provisioning-pulse" />
                            <FiLoader className="provisioning-main-spinner" />
                        </div>

                        <p className="provisioning-status-msg">{statusMessage}</p>

                        <div className="provisioning-steps-list">
                            {/* Step 1: Identity */}
                            <div className={`provisioning-step ${activeStep > 1 ? 'complete' : 'active'}`}>
                                <div className="provisioning-step-left">
                                    <FiShield className="provisioning-step-icon" />
                                    <span>Identity Clearance</span>
                                </div>
                                {activeStep > 1 ? <FiCheckCircle className="provisioning-step-done" /> : <div className="provisioning-step-pending" />}
                            </div>

                            {/* Step 2: Securing Channel */}
                            <div className={`provisioning-step ${activeStep === 2 ? 'active' : activeStep > 2 ? 'complete' : ''}`}>
                                <div className="provisioning-step-left">
                                    <FiLock className="provisioning-step-icon" />
                                    <span>Securing Channel</span>
                                </div>
                                {activeStep > 2 ? <FiCheckCircle className="provisioning-step-done" /> : activeStep === 2 ? <div className="provisioning-step-pending" /> : <div className="provisioning-step-pending inactive" />}
                            </div>

                            {/* Step 3: Allocation */}
                            <div className={`provisioning-step ${activeStep === 3 ? 'active' : activeStep > 3 ? 'complete' : ''}`}>
                                <div className="provisioning-step-left">
                                    <FiCpu className="provisioning-step-icon" />
                                    <span>Station Allocation</span>
                                </div>
                                {activeStep > 3 ? <FiCheckCircle className="provisioning-step-done" /> : activeStep === 3 ? <div className="provisioning-step-pending" /> : <div className="provisioning-step-pending inactive" />}
                            </div>

                            {/* Step 4: Telemetry */}
                            <div className={`provisioning-step ${activeStep === 4 ? 'active' : ''}`}>
                                <div className="provisioning-step-left">
                                    <FiActivity className="provisioning-step-icon" />
                                    <span>Telemetry Uplink</span>
                                </div>
                                <div className={`provisioning-step-pending ${activeStep === 4 ? '' : 'inactive'}`} />
                            </div>
                        </div>

                        <div className="provisioning-btn-group">
                            <button 
                                onClick={handleRetry}
                                disabled={isRetrying}
                                className="provisioning-btn-primary"
                            >
                                <FiRefreshCw className={isRetrying ? 'provisioning-btn-icon-rotating' : ''} />
                                {isRetrying ? 'Synchronizing...' : 'Force System Sync'}
                            </button>
                            
                            <button 
                                onClick={() => signOut()}
                                className="provisioning-btn-secondary"
                            >
                                Re-authenticate Session
                            </button>
                        </div>

                        {/* Diagnostic Toggle & Info */}
                        <div className="diagnostic-toggle" onClick={() => setShowDiagnostics(!showDiagnostics)}>
                            {showDiagnostics ? 'Hide Technical Details' : 'Show Technical Details'}
                        </div>

                        {showDiagnostics && (
                            <div className="diagnostic-panel">
                                <code>
                                    User ID: {currentUser?.authUserId || 'N/A'}<br />
                                    Station ID: {currentUser?.stationId || 'MISSING'}<br />
                                    Role: {currentUser?.role || 'provisional'}<br />
                                    Level: {currentUser?.authLevel || 0}<br />
                                    Events: {activeStep} / 4
                                </code>
                                <button 
                                    className="btn btn-ghost mt-2 text-[10px] h-auto px-2 py-1" 
                                    onClick={handleDiagnostic}
                                >
                                    Run Database Diagnostic
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="provisioning-footer-tag">
                        TRACE_ID: {currentUser?.authUserId?.slice(0, 8).toUpperCase() || 'UNKNOWN'} // NODE_0{activeStep}
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};
