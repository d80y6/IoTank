import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/types';
import { FiAlertTriangle, FiAlertCircle, FiInfo, FiX, FiTruck, FiGlobe } from 'react-icons/fi';

import { useAuth } from '@/hooks/useAuth';
import { RefillVerificationModal } from './RefillVerificationModal';
import './AlertBanner.css';

interface AlertBannerProps {
    alert: Alert;
    floating?: boolean;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ alert, floating }) => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    const [dismissed, setDismissed] = useState(false);
    const [showVerification, setShowVerification] = useState(false);

    useEffect(() => {
        if (floating && !dismissed) {
            const timer = setTimeout(() => {
                setDismissed(true);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [floating, dismissed]);

    const getIcon = () => {
        switch (alert.severity) {
            case 'critical':
                return <FiAlertTriangle size={20} />;
            case 'warning':
                return <FiAlertCircle size={20} />;
            default:
                return <FiInfo size={20} />;
        }
    };

    const getSeverityClass = () => {
        return `alert-banner-${alert.severity}`;
    };



    const handleDismiss = () => {
        setDismissed(true);
    };

    const isRegulatory = alert.type === 'regulatory_update' || alert.type === 'market_news';

    if (dismissed) return null;

    return (
        <div className={`alert-banner ${getSeverityClass()} ${floating ? 'alert-banner-floating' : ''}`} role="alert" aria-live="assertive">
            <div className="alert-banner-icon">
                {getIcon()}
            </div>

            <div className="alert-banner-content">
                <div className="alert-banner-header">
                    <span className="alert-banner-type">{alert.type.toUpperCase()}</span>
                </div>

                <p className="alert-banner-message">{alert.message}</p>

                {alert.evidence?.aiExplanation && (
                    <details className="alert-banner-details">
                        <summary>AI Explanation</summary>
                        <p className="text-sm">{alert.evidence.aiExplanation}</p>
                        {alert.evidence.aiConfidence && (
                            <p className="text-xs text-secondary mt-2">
                                Confidence: {(alert.evidence.aiConfidence * 100).toFixed(1)}%
                            </p>
                        )}
                    </details>
                )}
            </div>

            <div className="alert-banner-actions">
                {isRegulatory && (
                    <button
                        onClick={() => navigate(`/market?tab=news`)}
                        className="btn btn-sm btn-accent"
                        aria-label="View News Feed"
                    >
                        <FiGlobe /> View Feed
                    </button>
                )}

                {alert.type === 'refill' && !alert.resolved && (
                    <button
                        onClick={() => setShowVerification(true)}
                        className="btn btn-sm btn-accent"
                        aria-label="Verify refill"
                    >
                        <FiTruck /> Verify Refill
                    </button>
                )}



                <button
                    onClick={handleDismiss}
                    className="btn btn-icon btn-sm"
                    aria-label="Dismiss alert"
                >
                    <FiX />
                </button>
            </div>

            {showVerification && (
                <RefillVerificationModal
                    alert={alert}
                    stationId={currentUser?.stationId || ''}
                    onClose={() => {
                        setShowVerification(false);
                        setDismissed(true); // Dismiss banner after verification
                    }}
                />
            )}
        </div>
    );
};
