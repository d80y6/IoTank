import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { 
    FiBell, FiAlertCircle, FiShield, FiCpu, 
    FiCheckCircle, FiClock, FiX, FiCheck
} from 'react-icons/fi';
import './NotificationPanel.css';

interface Notification {
    id: string;
    category: 'system' | 'security' | 'sla' | 'billing';
    priority: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    is_read: boolean;
    created_at: string;
}

const NotificationPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const fetchNotifications = async () => {
            const { data } = await supabase
                .from('system_notifications')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20);
            if (isMounted) {
                setNotifications(data || []);
                setLoading(false);
            }
        };

        fetchNotifications();

        // Real-time subscription
        const channel = supabase
            .channel('internal_alerts')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'system_notifications' 
            }, () => {
                fetchNotifications();
            })
            .subscribe();

        return () => {
            isMounted = false;
            supabase.removeChannel(channel);
        };
    }, []);

    const markAsRead = async (id: string) => {
        await supabase
            .from('system_notifications')
            .update({ is_read: true })
            .eq('id', id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    };

    const clearAll = async () => {
        await supabase
            .from('system_notifications')
            .update({ is_read: true })
            .eq('is_read', false);
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    };

    const getIcon = (category: string) => {
        switch (category) {
            case 'sla': return <FiClock className="text-rose-500" />;
            case 'security': return <FiShield className="text-amber-500" />;
            case 'billing': return <FiCheckCircle className="text-emerald-500" />;
            default: return <FiCpu className="text-blue-500" />;
        }
    };

    return (
        <div className="notif-panel glass-panel animate-slide-in-right">
            <div className="notif-header">
                <div className="flex items-center gap-2">
                    <FiBell />
                    <h3 className="lowercase font-black">command alerts</h3>
                </div>
                <div className="flex gap-2">
                    <button className="notif-action-btn" title="Clear All" onClick={clearAll}><FiCheck /></button>
                    <button className="notif-action-btn" title="Close" onClick={onClose}><FiX /></button>
                </div>
            </div>

            <div className="notif-scroll-area">
                {loading ? (
                    <div className="flex items-center justify-center h-40 opacity-20">
                        <div className="animate-spin border-2 border-slate-400 border-t-transparent rounded-full w-5 h-5"></div>
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="notif-empty">
                        <FiCheckCircle size={32} />
                        <p>Platform ecosystem stable. No active alerts.</p>
                    </div>
                ) : (
                    notifications.map(n => (
                        <div 
                            key={n.id} 
                            className={`notif-item ${!n.is_read ? 'unread' : ''} ${n.priority}`}
                            onClick={() => markAsRead(n.id)}
                        >
                            <div className="notif-icon-box">
                                {getIcon(n.category)}
                            </div>
                            <div className="notif-content">
                                <div className="notif-title-row">
                                    <span className="notif-title">{n.title}</span>
                                    <span className="notif-time">{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <p className="notif-msg">{n.message}</p>
                                <div className="notif-badge-row">
                                    <span className={`notif-tag ${n.category}`}>{n.category}</span>
                                    {!n.is_read && <span className="notif-pulse"></span>}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="notif-footer">
                <button className="view-all-btn" onClick={() => { onClose(); navigate('/logs'); }}>View Full Audit Stream</button>
            </div>
        </div>
    );
};

export default NotificationPanel;
