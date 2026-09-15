import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiInfo, FiAlertTriangle, FiCheckCircle, FiShield, FiArrowRight, FiX } from 'react-icons/fi';

import './Toast.css';

export type ToastType = 'info' | 'warning' | 'success' | 'error';

interface ToastProps {
    message: string;
    type?: ToastType;
    duration?: number;
    onClose: () => void;
    actionLabel?: string;
    onAction?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ 
    message, 
    type = 'info', 
    duration = 5000,
    onClose,
    actionLabel,
    onAction
}) => {
    const isShiftBlocked = message.toLowerCase().includes('shift');

    const getIcon = () => {
        if (isShiftBlocked) return <FiShield size={20} />;
        switch (type) {
            case 'warning': return <FiAlertTriangle size={20} />;
            case 'success': return <FiCheckCircle size={20} />;
            case 'error': return <FiAlertTriangle size={20} />;
            default: return <FiInfo size={20} />;
        }
    };

    const getTitle = () => {
        if (isShiftBlocked) {
            return type === 'warning' ? 'Shift Action Blocked' : 'Shift Notification';
        }
        switch (type) {
            case 'warning': return 'Attention Needed';
            case 'success': return 'Action Successful';
            case 'error': return 'System Error';
            default: return 'System Notification';
        }
    };

    const handleAction = () => {
        if (onAction) onAction();
        onClose();
    };

    React.useEffect(() => {
        if (duration > 0 && !actionLabel) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, onClose, actionLabel]);

    return createPortal(
        <AnimatePresence mode="wait">
            <div className={`precision-toast-portal status-${type}`}>
                <motion.div 
                    initial={{ opacity: 0, x: 20, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 20, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="precision-industrial-toast"
                >
                    <div className="toast-icon-column">
                        {getIcon()}
                    </div>
                    
                    <div className="toast-body-column">
                        <div className="toast-header-row">
                            <span className="toast-type-label">{type.toUpperCase()}</span>
                            <button onClick={onClose} className="toast-dismiss-x">
                                <FiX size={14} />
                            </button>
                        </div>
                        
                        <div className="toast-main-content">
                            <h4 className="toast-headline">{getTitle()}</h4>
                            <p className="toast-subtext">{message}</p>
                        </div>

                        {actionLabel && (
                            <div className="toast-footer-actions">
                                <button 
                                    onClick={handleAction}
                                    className="toast-primary-action"
                                >
                                    {actionLabel} <FiArrowRight size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                    
                    <div className="toast-lifetime-track">
                        <motion.div 
                            initial={{ width: '100%' }}
                            animate={{ width: '0%' }}
                            transition={{ duration: duration / 1000, ease: 'linear' }}
                            className="toast-lifetime-bar"
                        />
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>,
        document.body
    );
};
