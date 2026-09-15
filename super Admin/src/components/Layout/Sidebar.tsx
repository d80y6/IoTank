import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
    MdDashboard,
    MdPeople,
    MdPersonAdd,
    MdConfirmationNumber,
    MdHistory,
    MdAdminPanelSettings,
    MdSettings,
    MdHelpOutline,
    MdAttachMoney,
    MdMemory,
    MdBarChart,
    MdSecurity,
    MdReportGmailerrorred,
    MdNotificationsActive,
} from 'react-icons/md';

import { FiShield } from 'react-icons/fi';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../config/supabase';
import brandMark from '../../assets/iotank-logo-v3.png';
import './Sidebar.css';

interface SidebarProps {
    collapsed: boolean;
    mobileOpen: boolean;
    closeMobile: () => void;
    onActivity?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    collapsed,
    mobileOpen,
    closeMobile,
    onActivity
}) => {
    const { systemUser, canSee } = useAuth();
    const navigate = useNavigate();
    const [criticalEvents24h, setCriticalEvents24h] = useState(0);

    useEffect(() => {
        if (!canSee(1)) return;

        const loadCriticalEvents = async () => {
            try {
                const since = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
                const { count, error } = await supabase
                    .from('security_telemetry_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('severity', 'critical')
                    .gte('created_at', since);
                if (error) return;
                setCriticalEvents24h(count || 0);
            } catch (_err) {
                // Ignore silent sidebar badge failures.
            }
        };

        loadCriticalEvents();
        const interval = setInterval(loadCriticalEvents, 60000);
        return () => clearInterval(interval);
    }, [canSee]);

    // ── SUPER ADMIN RBAC ────────────────────────────────────────────────────────
    // Level 1: Super Admin (Everything)
    // Level 3: Admin Helper / Analyst (Clients, Logs, Registrations)
    // Level 4: Support (Clients, Tickets)
    // ── ─────────────────────────────────────────────────────────────────────────

    const menuItems = [
        { name: 'strategic operations', isSection: true, path: 'sec-intel', level: 4 },
        { name: 'dashboard', path: '/', icon: <MdDashboard />, level: 4 },
        { name: 'fleet control', path: '/fleet', icon: <MdMemory />, level: 4 },
        { name: 'forensic hub', path: '/governance', icon: <FiShield />, level: 1 },
        { name: 'pending requests', path: '/registrations', icon: <MdPersonAdd />, level: 1 },
        { name: 'security events', path: '/security-events', icon: <MdReportGmailerrorred />, level: 1 },

        { name: 'business & revenue', isSection: true, path: 'sec-biz', level: 4 },
        { name: 'Payments & Debt', path: '/billing', icon: <MdAttachMoney />, level: 4 },
        { name: 'analytics & reports', path: '/analytics', icon: <MdBarChart />, level: 1 },

        { name: 'workspace & support', isSection: true, path: 'sec-work', level: 4 },
        { name: 'workforce hub', path: '/workforce', icon: <MdPeople />, level: 4 },
        { name: 'system settings', path: '/settings', icon: <MdSettings />, level: 4 },
        
        { name: 'resource studio', isSection: true, path: 'sec-resources', level: 4 },
        { name: 'platform resources', path: '/resources', icon: <MdNotificationsActive />, level: 4 },
    ].filter(item => canSee(item.level));

    return (
        <aside
            className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
            onMouseMove={onActivity}
            onTouchMove={onActivity}
            onTouchStart={onActivity}
            onClick={onActivity}
            onScroll={onActivity}
        >
            {/* System Console Identity Module */}
            <div
                className={`operator-identity-module ${collapsed ? 'collapsed' : ''}`}
                onClick={() => navigate('/')}
                title="System Management Console"
                style={{ cursor: 'pointer' }}
            >
                <div className="avatar-container">
                    <div className="operator-photo-placeholder neumorphic-rim-seamless">
                        <img src={brandMark} alt="IoTank" className="sidebar-brand-logo-seamless" />
                    </div>
                </div>
                {(!collapsed || mobileOpen) && (
                    <div className="operator-meta animate-fade-in">
                        <span className="op-name">System Console</span>
                        <span className="op-role">{systemUser?.role?.replace('_', ' ') || 'Administrator'}</span>
                    </div>
                )}
            </div>

            <nav className="sidebar-nav">
                <ul>
                    {menuItems.map((item) => {
                        if (item.isSection) {
                            return (
                                <li key={item.path} className={`nav-section ${(collapsed && !mobileOpen) ? 'hidden' : ''}`}>
                                    <span className="nav-section-label-modern">{item.name}</span>
                                </li>
                            );
                        }

                        return (
                            <li key={item.path}>
                                <NavLink
                                    to={item.path}
                                    className={({ isActive }) => `nav-link-modern ${isActive ? 'active' : ''}`}
                                    onClick={closeMobile}
                                >
                                    <span className="nav-icon-modern nav-icon-wrap">
                                        {item.icon}
                                        {item.path === '/security-events' && criticalEvents24h > 0 && (
                                            <span className="nav-critical-badge nav-critical-badge-icon">
                                                {criticalEvents24h > 99 ? '99+' : criticalEvents24h}
                                            </span>
                                        )}
                                    </span>
                                    {(!collapsed || mobileOpen) && (
                                        <span className="nav-text-modern nav-text-wrap">
                                            {item.name}
                                            {item.path === '/security-events' && criticalEvents24h > 0 && (
                                                <span className="nav-critical-badge nav-critical-badge-inline">
                                                    {criticalEvents24h > 99 ? '99+' : criticalEvents24h}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                    {(collapsed && !mobileOpen) && (
                                        <span className="nav-tooltip-modern">
                                            {item.name}
                                            {item.path === '/security-events' && criticalEvents24h > 0 ? ` (${criticalEvents24h > 99 ? '99+' : criticalEvents24h})` : ''}
                                        </span>
                                    )}
                                </NavLink>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {!collapsed && (
                <div className="sidebar-status-widget animate-in slide-in-from-bottom duration-500">
                    <div className="status-header">
                        <span className="status-dot pulse-cyan"></span>
                        <span className="status-label">Engine Active</span>
                    </div>
                    <div className="status-metrics">
                        <div className="mini-metric">
                            <span className="metric-val">320</span>
                            <span className="metric-unit">hubs</span>
                        </div>
                        <div className="mini-metric">
                            <span className="metric-val">99.9%</span>
                            <span className="metric-unit">uptime</span>
                        </div>
                    </div>
                </div>
            )}
        </aside>
    );
};
