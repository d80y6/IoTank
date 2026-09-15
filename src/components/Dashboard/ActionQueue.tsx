import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiClock, FiZap, FiInfo, FiCheckCircle } from 'react-icons/fi';
import { useTelemetryQueue, TelemetryEvent } from '@/contexts/TelemetryQueueContext';
import { useShiftStatus } from '@/hooks/useShiftStatus';
import { useAuth } from '@/hooks/useAuth';
import { resolveAlert } from '@/hooks/useSupabase';
import { Toast } from '../Common/Toast';
import { useModals } from '@/contexts/ModalContext';
import { logger } from '@/utils/logger';
import './ActionQueue.css';
import '../Common/DesignSystemCards.css';

// Map each action to a destination route
const ACTION_ROUTES: Record<string, string> = {
    'attention-refuel':    '/inventory',
    'attention-predictive': '/analytics',
    'attention-team':      '/users',
};



export const ActionQueue: React.FC = () => {
    const { events, clearEvent } = useTelemetryQueue();
    const navigate = useNavigate();
    const { isViewOnly } = useShiftStatus();
    const { currentUser, canSee } = useAuth();
    const { openModal } = useModals();

    const [toast, setToast] = useState<{ 
        message: string, 
        type: 'info' | 'warning' | 'success' | 'error',
        actionLabel?: string,
        onAction?: () => void
    } | null>(null);

    // Route Level Mapping for Invisibility Gating
    const ROUTE_LEVELS: Record<string, number> = {
        '/analytics': 6,
        '/reporting': 6,
        '/deliveries': 6,
        '/settings': 6,
        '/event-log': 6,
        '/analysis': 6,
        '/security': 6,
        '/billing': 5,
        '/users': 5,
        '/governance': 4,
        '/inventory': 7,
        '/dashboard': 7,
        '/market': 7,
        '/alerts': 7
    };

    const displayEvents = events.filter(item => {
        const route = ACTION_ROUTES[item.id];
        if (!route) return true; // Standard events with no link are always shown
        const required = ROUTE_LEVELS[route] || 7;
        return canSee(required);
    });

    const handleItemClick = (item: TelemetryEvent) => {
        if (item.onAction) {
            item.onAction();
        } else if (item.metadata?.modalType) {
            openModal(item.metadata.modalType);
        } else if (ACTION_ROUTES[item.id]) {
            navigate(ACTION_ROUTES[item.id]);
        }
    };

    const handleDismiss = (e: React.MouseEvent, item: TelemetryEvent) => {
        e.stopPropagation();

        const isAdmin = (currentUser?.authLevel || 99) <= 5;
        
        if (isViewOnly && !isAdmin) {
            setToast({
                message: 'Operational Lock: Only Admins can resolve alerts while shift is closed.',
                type: 'warning',
                actionLabel: 'Initialize Shift',
                onAction: () => openModal('shift-open')
            });
            return;
        }

        if (item.alertId) {
            resolveAlert(item.alertId, currentUser?.displayName || 'USER_ACTION')
                .then(() => {
                    clearEvent(item.id);
                })
                .catch(err => {
                    logger.error('[ActionQueue] Failed to resolve alert:', err);
                    setToast({
                        message: 'Sync Error: Could not resolve alert on server.',
                        type: 'error'
                    });
                });
        } else {
            clearEvent(item.id);
        }
    };

    const getIcon = (type: TelemetryEvent['type']) => {
        switch (type) {
            case 'critical':     return <FiAlertCircle size={14} style={{ strokeWidth: 2 }} />;
            case 'system_error': return <FiAlertCircle size={14} style={{ strokeWidth: 2 }} />;
            case 'watch':        return <FiClock size={14} style={{ strokeWidth: 2 }} />;
            case 'due':          return <FiInfo size={14} style={{ strokeWidth: 2 }} />;
            case 'suggested':    return <FiZap size={14} style={{ strokeWidth: 2 }} />;
            default:             return <FiInfo size={14} style={{ strokeWidth: 2 }} />;
        }
    };

    const getTypeLabel = (type: TelemetryEvent['type']) => {
        if (type === 'system_error') return 'System Alert';
        return type.charAt(0).toUpperCase() + type.slice(1);
    };

    return (
        <div className="action-queue-card">
            {/* ── Colored Header ── */}
            <div className="action-queue-header">
                <div className="action-queue-title-box">
                    <FiZap size={16} className="action-queue-title-icon" />
                    <span className="action-queue-title-text">
                        Action Queue
                    </span>
                </div>
                <div className="action-queue-count-pill">
                    <span className="action-queue-count-value">
                        {displayEvents.length}
                    </span>
                    <span className="action-queue-count-label">
                        Active
                    </span>
                </div>
            </div>

            {/* ── Scrollable Items ── */}
            <div className="action-queue-items-container custom-scrollbar">
                {displayEvents.length === 0 ? (
                    <div className="action-queue-empty-state-modern animate-fade-in">
                        <div className="empty-state-visual-container">
                            <div className="empty-state-glow" />
                            <div className="empty-state-icon-shell">
                                <FiCheckCircle size={32} className="text-emerald-500" />
                            </div>
                        </div>
                        <h4 className="empty-state-heading">Integrity Optimal</h4>
                        <p className="empty-state-subheading">
                            The Operational Directive Engine is clear. No high-priority alerts require attention.
                        </p>
                        <div className="empty-state-footer-bits">
                            <span className="bit-dot animate-ping" />
                            <span className="bit-text">Real-time scan in progress</span>
                        </div>
                    </div>
                ) : (
                    displayEvents.map((item) => {
                        return (
                            <div
                                key={item.id}
                                onClick={() => handleItemClick(item)}
                                className="action-queue-item"
                                data-type={item.type}
                            >
                                {/* Type pill + icon */}
                                <div className="action-queue-type-pill">
                                    <div 
                                        className="type-pill-inner"
                                        data-type={item.type}
                                    >
                                        {getIcon(item.type)}
                                        <span className="type-pill-label">
                                            {getTypeLabel(item.type)}
                                        </span>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="action-queue-content">
                                    <p className="action-item-message">
                                        {item.message}
                                    </p>
                                    {item.actionLabel && (
                                        <span className="action-item-link">
                                            {item.actionLabel}
                                            <span className="action-item-arrow">→</span>
                                        </span>
                                    )}
                                </div>

                                {/* Tick dismiss button */}
                                <button
                                    onClick={(e) => handleDismiss(e, item)}
                                    title="Mark as done"
                                    className="action-queue-dismiss-btn"
                                >
                                    <FiCheckCircle size={18} strokeWidth={2} />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
            {toast && (
                <Toast 
                    message={toast.message} 
                    type={toast.type} 
                    actionLabel={toast.actionLabel}
                    onAction={toast.onAction}
                    onClose={() => setToast(null)} 
                />
            )}
        </div>
    );
};
