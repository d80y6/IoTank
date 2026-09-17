import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../config/supabase';
import {
    MdPerson,
    MdLogout,
    MdMenu,
    MdSettings,
    MdSecurity,
} from 'react-icons/md';

import './Navbar.css';

interface NavbarProps {
    onToggleSidebar: () => void;
    children?: React.ReactNode;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar, children }) => {

    const { systemUser, signOut, canSee } = useAuth();
    const navigate = useNavigate();

    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [criticalEvents24h, setCriticalEvents24h] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const checkConnection = async () => {
            if (!systemUser) return;
            try {
                const { error } = await supabase.from('market_prices').select('id').limit(1);
                if (error) console.error('Supabase Connection Error:', error);
                setIsOnline(!error);
            } catch (err) {
                console.error('Supabase Exception:', err);
                setIsOnline(false);
            }
        };
        checkConnection();
        const interval = setInterval(checkConnection, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!canSee(1)) return;

        const loadCriticalEvents = async () => {
            if (!systemUser || !canSee(1)) return;
            try {
                const since = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
                const { count, error } = await supabase
                    .from('security_telemetry_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('severity', 'critical')
                    .gte('created_at', since);
                if (error) {
                    console.error('Failed to load critical security events:', error);
                    return;
                }
                setCriticalEvents24h(count || 0);
            } catch (err) {
                console.error('Critical event fetch failed:', err);
            }
        };

        loadCriticalEvents();
        const interval = setInterval(loadCriticalEvents, 60000);
        return () => clearInterval(interval);
    }, [canSee]);

    const formattedTime = currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    return (
        <header className="navbar">
            <div className="navbar-left">
                <button className="menu-toggle-btn mr-4" onClick={onToggleSidebar} aria-label="Toggle Sidebar">
                    <MdMenu size={24} />
                </button>
                <div className="navbar-brand-container" onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Logo moved to Sidebar */}
                </div>
                {/* Admin Context */}
                <div className="site-context scale-90 sm:scale-100 flex-shrink-0 ml-4 hidden md:flex">
                    <span className="org-name whitespace-nowrap">System Management</span>
                    <span className="context-divider mx-1">|</span>
                    <span className="site-name hidden sm:inline whitespace-nowrap">Global Console</span>
                </div>
            </div>

            <div className="navbar-right">
                {children}
                <div className="navbar-item-relative system-health hidden lg:flex">
                    <div className={`mission-control-badge ${!isOnline ? 'offline' : ''}`}>
                        <div className="indicator-wrapper">
                            <div className={`indicator-dot ${isOnline ? 'online pulse-cyan-fast' : 'offline'}`} />
                        </div>
                        <div className="badge-content">
                            <span className="badge-label">{isOnline ? 'Core Engine' : 'Engine Sync'}</span>
                            <span className="badge-status">{isOnline ? 'OPERATIONAL' : 'ERROR 503'}</span>
                        </div>
                        <div className="badge-telemetry">
                            <span className="telemetry-time">{formattedTime}</span>
                        </div>
                    </div>
                </div>

                {canSee(1) && (
                    <div className="navbar-item-relative">
                        <button
                            className="navbar-btn"
                            aria-label="Security Events"
                            title="View security events"
                            onClick={() => navigate('/security-events')}
                            style={{ position: 'relative' }}
                        >
                            <MdSecurity />
                            {criticalEvents24h > 0 && (
                                <span
                                    style={{
                                        position: 'absolute',
                                        top: '-6px',
                                        right: '-6px',
                                        minWidth: '18px',
                                        height: '18px',
                                        borderRadius: '999px',
                                        background: '#ef4444',
                                        color: '#fff',
                                        fontSize: '10px',
                                        fontWeight: 800,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '0 5px',
                                        lineHeight: 1,
                                    }}
                                >
                                    {criticalEvents24h > 99 ? '99+' : criticalEvents24h}
                                </span>
                            )}
                        </button>
                    </div>
                )}

                <div className="navbar-item-relative user-menu-container">
                    <button
                        className="profile-btn px-1 sm:px-2"
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                    >
                        <div className="avatar">
                            <MdPerson />
                        </div>
                        <span className="hidden lg:inline-block text-sm font-bold ml-1 overflow-hidden transition-all duration-300" style={{ maxWidth: '120px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {systemUser?.full_name?.split(' ')[0] || 'Admin'}
                        </span>
                    </button>

                    {showProfileMenu && (
                        <div className="dropdown-menu modern-dropdown profile-dropdown">
                            <div className="dropdown-header">
                                <h3>{systemUser?.full_name || 'System Administrator'}</h3>
                                <div className="user-role">{systemUser?.role?.replace('_', ' ').toUpperCase() || 'ADMINISTRATOR'}</div>
                            </div>
                            <div className="dropdown-content">
                                <ul>
                                    <li>
                                        <button className="menu-btn" onClick={() => { navigate('/settings'); setShowProfileMenu(false); }}>
                                            <MdPerson className="menu-icon" /> Account Settings
                                        </button>
                                    </li>
                                    <li>
                                        <button className="menu-btn" onClick={() => { navigate('/admins'); setShowProfileMenu(false); }}>
                                            <MdSettings className="menu-icon" /> Manage Admins
                                        </button>
                                    </li>
                                </ul>
                                <div className="divider"></div>
                                <ul>
                                    <li>
                                        <button className="menu-btn logout-btn" onClick={() => { signOut(); setShowProfileMenu(false); }}>
                                            <MdLogout className="menu-icon" /> Logout
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};
