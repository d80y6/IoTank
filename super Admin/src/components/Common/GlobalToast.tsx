import React, { useState, useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';
import { FaCheckCircle, FaExclamationTriangle, FaExclamationCircle, FaInfoCircle } from 'react-icons/fa';
import './GlobalToast.css';

interface ToastData {
    id: string;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
    visible: boolean;
    progress: number;
    persistent?: boolean;
    actions?: Array<{
        label: string;
        onClick: () => void;
        primary?: boolean;
    }>;
}

export const GlobalToast: React.FC = () => {
    const [toasts, setToasts] = useState<ToastData[]>([]);
    const toastsRef = useRef<ToastData[]>([]);

    useEffect(() => {
        toastsRef.current = toasts;
    }, [toasts]);

    useEffect(() => {
        const handleToast = (event: Event) => {
            const customEvent = event as CustomEvent<any>;
            const detail = customEvent.detail;
            const id = Math.random().toString(36).substring(2, 11);
            
            const newToast: ToastData = {
                ...detail,
                id,
                visible: true,
                progress: 100
            };
            
            setToasts(prev => [newToast, ...prev].slice(0, 5));

            const isPersistent = newToast.persistent === true;
            if (isPersistent) return;

            const duration = 5000;
            const step = 100;
            
            const progressInterval = setInterval(() => {
                setToasts(prev => prev.map(t => 
                    t.id === id 
                        ? { ...t, progress: Math.max(0, t.progress - (step / duration) * 100) }
                        : t
                ));
            }, step);

            setTimeout(() => {
                setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t));
                clearInterval(progressInterval);
                
                setTimeout(() => {
                    setToasts(prev => prev.filter(t => t.id !== id));
                }, 500);
            }, duration);
        };

        window.addEventListener('system-toast', handleToast);
        
        return () => {
            window.removeEventListener('system-toast', handleToast);
        };
    }, []);

    const removeToast = (id: string) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t));
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 500);
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return <FaCheckCircle size={18} />;
            case 'warning': return <FaExclamationTriangle size={18} />;
            case 'error': return <FaExclamationCircle size={18} />;
            case 'info': 
            default: return <FaInfoCircle size={18} />;
        }
    };

    return (
        <div className="precision-toast-stack">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`precision-toast-container ${toast.visible ? 'active' : 'exiting'}`}
                    role="alert"
                >
                    <div className={`precision-toast-card-industrial status-${toast.type}`}>
                        <div className="toast-icon-col">
                            {getIcon(toast.type)}
                        </div>
                        <div className="toast-content-col">
                            <div className="toast-title-row">
                                <h4 className="toast-title-industrial">{toast.title}</h4>
                            </div>
                            <p className="toast-message-industrial">{toast.message}</p>
                            
                            {toast.actions && toast.actions.length > 0 && (
                                <div className="toast-action-row">
                                    {toast.actions.map((action, idx) => (
                                        <button 
                                            key={idx}
                                            className={`toast-action-btn-industrial ${action.primary ? 'primary' : ''}`}
                                            onClick={() => {
                                                action.onClick();
                                                removeToast(toast.id);
                                            }}
                                        >
                                            {action.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button onClick={() => removeToast(toast.id)} className="toast-close-mini">
                            <FiX size={16} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

