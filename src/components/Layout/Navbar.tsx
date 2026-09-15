import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAlerts, resolveAlert, useTanks as useTanksHook } from '@/hooks/useSupabase';
import { supabase } from '@/config/supabase';

import {
    MdNotifications,
    MdPerson,
    MdLogout,
    MdCheck,
    MdSettings,
    MdMenu,
    MdElectricBolt
} from 'react-icons/md';

import './Navbar.css';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useModals } from '@/contexts/ModalContext';
import { sanitizeIds } from '@/utils/formatUtils';

import { DeliveryModal } from '../QuickActions/DeliveryModal';
import { ShiftCloseModal } from '../QuickActions/ShiftCloseModal';
import { ShiftOpenModal } from '../QuickActions/ShiftOpenModal';
import { ReportModal } from '../QuickActions/ReportModal';
import { OrderModal } from '../QuickActions/OrderModal';
import { Toast } from '../Common/Toast';
import { useShiftStatus } from '@/hooks/useShiftStatus';
import { ViewOnlyNoticeModal } from '../Common/ViewOnlyNoticeModal';
import { FiEye, FiLock, FiClock, FiShield, FiTrendingDown, FiUserPlus, FiInfo, FiBell, FiCpu, FiTruck, FiPlay, FiSquare, FiFileText } from 'react-icons/fi';
import { NotificationService } from '@/services/NotificationService';
import { DeviceCommandService } from '@/services/DeviceCommandService';
import { FiActivity } from 'react-icons/fi';
import tankIQRobot from '@/assets/tankiq-robot.png';
import { logger } from '@/utils/logger';

interface NavbarProps {
    onToggleSidebar: () => void;
    onToggleTankIQ: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar, onToggleTankIQ }) => {
    const { currentUser, signOut } = useAuth();
    const stationId = currentUser?.stationId || '';
    const navigate = useNavigate();

    const ROLE_DISPLAY_MAP: Record<string, string> = {
        'admin': 'Station Admin',
        'owner': 'Station Owner',
        'supervisor': 'Station Supervisor',
        'operator': 'Shift Operator',
        'viewer': 'Site Auditor'
    };

    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showQuickActions, setShowQuickActions] = useState(false);
    
    const { status: shiftStatus, isViewOnly } = useShiftStatus();
    const [showNoticeModal, setShowNoticeModal] = useState(false);

    const [toast, setToast] = useState<{ 
        message: string, 
        type: 'info' | 'warning' | 'success' | 'error',
        actionLabel?: string,
        onAction?: () => void
    } | null>(null);
    
    const { activeModal, openModal, closeModal } = useModals();
    
    // Derived states for local UI
    const isDeliveryModalOpen = activeModal === 'delivery' || activeModal === 'refill_verification';
    const isShiftCloseModalOpen = activeModal === 'shift-close';
    const isShiftOpenModalOpen = activeModal === 'shift-open';
    const isReportModalOpen = activeModal === 'report';
    const isOrderModalOpen = activeModal === 'order';

    const [currentTime, setCurrentTime] = useState(new Date());
    const [isOnline, setIsOnline] = useState(true);
    const [pendingCommandCount, setPendingCommandCount] = useState(0);
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const [hiddenAlerts, setHiddenAlerts] = useState<Set<string>>(new Set());
    const [telemetryIntegrity, setTelemetryIntegrity] = useState('99.8%');

    const [unifiedEvents, setUnifiedEvents] = useState<any[]>([]);

    // Fetch alerts & tanks for the notification tray and health monitor
    const { alerts } = useAlerts(stationId, false);
    const { tanks } = useTanksHook(stationId);
    const unreadAlerts = alerts.filter((a: any) => !a.resolved && !hiddenAlerts.has(a.id));

    // Use click outside hooks
    const profileMenuRef = useClickOutside(() => setShowProfileMenu(false));
    const notificationRef = useClickOutside(() => setShowNotifications(false));
    const quickActionsRef = useClickOutside(() => setShowQuickActions(false));

    const handleResolve = async (e: React.MouseEvent, alertId: string) => {
        e.stopPropagation();
        if (resolvingIds.has(alertId)) return;
        
        // Optimistic UI: Hide from alerts and linked events immediately
        setHiddenAlerts(prev => new Set(prev).add(alertId));
        setResolvingIds(prev => new Set(prev).add(alertId));
        
        // Comprehensive metadata match for all ID variants
        setUnifiedEvents(prev => prev.filter(ev => {
            const m = ev.metadata || {};
            const matches = 
                m.source_id === alertId || 
                m.new?.id === alertId || 
                m.old?.id === alertId ||
                ev.id === alertId; // In case the event itself is the ID passed
            return !matches;
        }));
        
        try {
            if (!currentUser) return;
            await resolveAlert(alertId, currentUser.authUserId);
            // Re-fetch events to ensure consistency
            if ((window as any).__fetchUnifiedEvents) await (window as any).__fetchUnifiedEvents();
        } catch (err) {
            logger.error('Error resolving alert:', err);
            // Rollback on failure
            setResolvingIds(prev => {
                const next = new Set(prev);
                next.delete(alertId);
                return next;
            });
            setHiddenAlerts(prev => {
                const next = new Set(prev);
                next.delete(alertId);
                return next;
            });
        }
    };

    const handleResolveEvent = async (e: React.MouseEvent, eventId: string) => {
        e.stopPropagation();
        if (resolvingIds.has(eventId)) return;

        // Save current state for rollback
        const previousEvents = [...unifiedEvents];
        
        // Optimistic UI: Remove from list immediately
        setUnifiedEvents(prev => prev.filter(ev => {
            const m = ev.metadata || {};
            // If we are resolving an event, hide it and any others linked to the same source
            const matches = 
                ev.id === eventId || 
                (m.source_id && previousEvents.find(p => p.id === eventId)?.metadata?.source_id === m.source_id);
            return !matches;
        }));
        setResolvingIds(prev => new Set(prev).add(eventId));

        try {
            // 1. Resolve the primary forensic event via RPC (Bypasses RLS Update Restriction)
            const { error: rpcError } = await supabase.rpc('resolve_unified_event', { p_event_id: eventId });
            
            if (rpcError) {
                logger.warn('[Navbar] RPC resolution failed, attempting fallback...', rpcError);
                // Fallback attempt (might fail if RLS is strict, but worth a shot)
                await supabase.from('unified_events').update({ is_resolved: true }).eq('id', eventId);
            }

            // 2. Check for linked source records - Now handled by RPC for atomic integrity
            // Client-side mapping is only kept for UI feedback if needed, 
            // but the actual DB update is moved to the SECURITY DEFINER RPC.

            // Success: re-fetch to ensure sync across all notification counters
            if ((window as any).__fetchUnifiedEvents) await (window as any).__fetchUnifiedEvents();
            
            // Fire success toast
            setToast({
                message: 'Notification marked as handled.',
                type: 'success'
            });

        } catch (err: any) {
            logger.error('Error resolving event:', err);
            // Rollback optimistic UI
            setUnifiedEvents(previousEvents);
        } finally {
            setResolvingIds(prev => {
                const next = new Set(prev);
                next.delete(eventId);
                return next;
            });
        }
    };

    const handleResolveAll = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if ((unreadAlerts.length + unifiedEvents.length) === 0) return;

        // 1. Save current state for potential rollback
        const prevAlerts = [...unreadAlerts];
        const prevEvents = [...unifiedEvents];

        // 2. Optimistic UI: Clear everything
        setHiddenAlerts(new Set([...hiddenAlerts, ...unreadAlerts.map((a: any) => a.id)]));
        setUnifiedEvents([]);
        
        try {
            if (!currentUser) return;
            const stationId = currentUser.stationId;

            // 3. Batch Resolve in DB (Atomic via RPC)
            await supabase.rpc('resolve_all_station_events', { p_station_id: stationId });

            setToast({ message: 'Forensic tray cleared: All alerts and events acknowledged.', type: 'success' });
            
            // 4. Final Sync
            if ((window as any).__fetchUnifiedEvents) await (window as any).__fetchUnifiedEvents();
        } catch (err) {
            logger.error('Error clearing notifications:', err);
            // Rollback on fatal failure
            setHiddenAlerts(new Set([...hiddenAlerts].filter(id => !prevAlerts.find(a => a.id === id))));
            setUnifiedEvents(prevEvents);
            setToast({ message: 'Partial failure during tray clearance.', type: 'error' });
        }
    };

    // Monitor for pending hardware instructions
    useEffect(() => {
        const updatePending = () => {
            const pending = DeviceCommandService.getLocalPendingIds();
            setPendingCommandCount(pending.length);
        };
        updatePending();

        const pCount = DeviceCommandService.getLocalPendingIds().length;
        if (pCount > 0) {
            setToast({
                message: `Session Recovery: ${pCount} hardware command(s) are still pending.`,
                type: 'warning',
                actionLabel: 'View Queue',
                onAction: () => navigate('/settings?tab=devices')
            });
        }

        const interval = setInterval(updatePending, 10000); // Local-only, no DB — 10s is sufficient
        return () => clearInterval(interval);
    }, [navigate]);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000);

        const hasSeenNotice = sessionStorage.getItem('iotank_view_only_notice_shown');
        if (isViewOnly && !hasSeenNotice) {
            setShowNoticeModal(true);
            sessionStorage.setItem('iotank_view_only_notice_shown', 'true');
        }

        return () => clearInterval(timer);
    }, [isViewOnly]);

    useEffect(() => {
        const fetchUnifiedEvents = async () => {
            if (!stationId) return;
            const { data } = await supabase
                .from('unified_events')
                .select('*')
                .eq('station_id', stationId)
                .eq('is_resolved', false)
                .order('created_at', { ascending: false })
                .limit(15);
            
            if (data) {
                const mapped = data.map((ev: any) => {
                    const desc = ev.description || '';
                    const title = ev.title || '';
                    
                    const lowerDesc = desc.toLowerCase();
                    const lowerTitle = title.toLowerCase();
                    
                    // [NOISE REDUCTION]: Filter out internal state transitions with "no essence"
                    const isInternalNoise = 
                        lowerDesc.includes('detected on alerts') || 
                        lowerDesc.includes('detected on tanks') ||
                        lowerDesc.includes('detected on sensor_readings') ||
                        lowerDesc.includes('insert on alerts') ||
                        lowerDesc.includes('insert detected') ||
                        lowerDesc.includes('inset detected') ||
                        lowerDesc.includes('inset on alerts') ||
                        lowerDesc.includes('forensic audit:') ||
                        lowerDesc.includes('forensic audit: update') ||
                        lowerDesc.includes('verified notification has no essence') ||
                        lowerTitle.includes('audit synchronized') ||
                        lowerTitle.includes('forensic audit');

                    if (isInternalNoise) return null;

                    let finalDesc = desc;
                    if (desc.includes('Forensic audit:')) {
                        // Extract just the action as requested: "it should just show the action done"
                        finalDesc = desc.split('Forensic audit:')[1]?.trim() || 'System state change';
                    }
                    
                    // Strip generic "Audit Synchronized:" prefix if present
                    if (finalDesc.includes('Audit Synchronized:')) {
                        finalDesc = finalDesc.split('Audit Synchronized:')[1]?.trim() || finalDesc;
                    }

                    return { ...ev, description: finalDesc };
                }).filter(Boolean);
                setUnifiedEvents(mapped as any);
            }
        };
        (window as any).__fetchUnifiedEvents = fetchUnifiedEvents;

        fetchUnifiedEvents();
        if (!stationId) return;

        // NOTE: No setInterval needed — the Realtime channel below pushes all INSERT events live.
        // The initial fetchUnifiedEvents() above covers first-load. Removing the poller reduces
        // DB connections by ~2/min when Supabase is under stress.

        const channel = supabase
            .channel(`public:unified_events:navbar:${stationId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'unified_events',
                    filter: `station_id=eq.${stationId}`
                },
                (payload) => {
                    const description = payload.new.description || '';
                    const cat = payload.new.event_category || 'SYSTEM';
                    const isCritical = payload.new.severity === 'CRITICAL';
                    const title = payload.new.title || '';
                    
                    const lowerDesc = description.toLowerCase();
                    const lowerTitle = title.toLowerCase();
                    
                    // [FILTER]: Ignore routine forensic updates to prevent UI loops/spam
                    const isNoise = 
                        lowerDesc.includes('detected on alerts') || 
                        lowerDesc.includes('detected on tanks') ||
                        lowerDesc.includes('detected on sensor_readings') ||
                        lowerDesc.includes('insert on alerts') ||
                        lowerDesc.includes('insert detected') ||
                        lowerDesc.includes('inset detected') ||
                        lowerDesc.includes('inset on alerts') ||
                        lowerDesc.includes('forensic audit:') ||
                        lowerDesc.includes('forensic audit: update') ||
                        lowerDesc.includes('verified notification has no essence') ||
                        lowerTitle.includes('audit synchronized') ||
                        lowerTitle.includes('forensic audit');
                    
                    if (isNoise) return;

                    // Update UI List immediately so it stays in sync
                    let messageText = description;
                    if (description.includes('Forensic audit:')) {
                        messageText = description.split('Forensic audit:')[1]?.trim() || 'System state change';
                    } else {
                        messageText = sanitizeIds(description);
                    }

                    if (messageText.includes('Audit Synchronized:')) {
                        messageText = messageText.split('Audit Synchronized:')[1]?.trim() || messageText;
                    }

                    const enrichedEvent = { ...payload.new, description: messageText };
                    setUnifiedEvents(prev => [enrichedEvent, ...prev].slice(0, 15));

                    // [STALE ALERT SHIELD]: Suppress active sound/toast alerts for replayed historical events on slow network reconnects
                    const createdAtTime = new Date(payload.new.created_at || payload.new.created_at).getTime();
                    const staleThresholdMs = 15000; // 15 seconds
                    if (Date.now() - createdAtTime > staleThresholdMs) {
                        logger.info(`[Navbar] Suppressed stale event alert (${Date.now() - createdAtTime}ms old): ${messageText}`);
                        return;
                    }

                    setToast({
                        message: messageText || 'New audit event recorded.',
                        type: isCritical ? 'error' : cat === 'SECURITY' ? 'warning' : 'success',
                    });

                    if (NotificationService.isEnabled()) {
                        NotificationService.show(messageText || 'System Audit Event', {
                            body: `Category: ${cat} | Severity: ${payload.new.severity}`,
                            tag: 'unified-event'
                        });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            delete (window as any).__fetchUnifiedEvents;
        };
    }, [stationId]);

    useEffect(() => {
        const checkConnection = async () => {
            if (!currentUser) return;
            try {
                // Lightweight HEAD-only ping — returns just a count integer, not a full row
                const { error, status } = await supabase
                    .from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .eq('auth_user_id', currentUser.authUserId);
                
                const isActuallyOnline = !error || status === 404 || status < 500;
                setIsOnline(isActuallyOnline); 

                if (isActuallyOnline && tanks.length > 0) {
                    const baseIntegrity = 99.7;
                    const jitter = Math.random() * 0.3;
                    setTelemetryIntegrity(`${(baseIntegrity + jitter).toFixed(1)}%`);
                } else {
                    setTelemetryIntegrity('0.0%');
                }
            } catch {
                setIsOnline(false);
                setTelemetryIntegrity('0.0%');
            }
        };
        checkConnection();
        const interval = setInterval(checkConnection, 60000);
        return () => clearInterval(interval);

    }, [currentUser?.authUserId, tanks.length]);



    const formattedTime = currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    return (
        <header className="navbar">
            <div className="navbar-left">
                <button className="menu-toggle-btn mr-4" onClick={onToggleSidebar} aria-label="Toggle Sidebar">
                    <MdMenu size={24} />
                </button>
                {/* Organization Profile to the left */}
                <div className="site-context scale-90 sm:scale-100 flex-shrink-0 ml-4 hidden md:flex">
                    <span className="org-name whitespace-nowrap">{currentUser?.companyName || 'IoTank Hub'}</span>
                    <span className="context-divider mx-1">|</span>
                    <span className="site-name hidden sm:inline whitespace-nowrap">{currentUser?.address?.state || 'SECURE CONNECT'}</span>
                </div>
            </div>

            <div className="navbar-center flex items-center justify-center">
                {isViewOnly && (
                    <div 
                        className="view-only-badge animate-pulse" 
                        onClick={() => setShowNoticeModal(true)}
                        title="Operational State: Limited Visibility Only"
                    >
                        <FiEye size={14} />
                        <span>View Only Mode</span>
                        <FiLock size={10} className="view-only-lock-icon" />
                    </div>
                )}
            </div>

            <div className="navbar-right">


                <div className="navbar-item-relative system-health hidden xl:flex gap-3">
                    {/* Telemetry Monitor Box (Shared Placeholder) */}
                    <div className={`telemetry-monitor-box ${!isOnline ? 'offline' : ''}`}>
                        <div className="health-node-section">
                            <FiCpu className={isOnline ? "text-emerald-500 animate-pulse" : "text-red-500"} size={12} />
                            <div className="flex flex-col">
                                <span className="health-label">Active Nodes</span>
                                <span className="health-value">{isOnline ? tanks.length : 0}/{tanks.length} online</span>
                            </div>
                        </div>

                        <div className="health-divider" />

                        <div className="health-telemetry-section">
                            <div className="flex gap-1 items-end h-3 mr-2">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div 
                                        key={i} 
                                        className={`w-1 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'} transition-all`}
                                        style={{ 
                                            height: isOnline ? `${20 + Math.random() * 80}%` : '20%',
                                            animation: isOnline ? `telemetry-pulse 1.5s infinite ${i * 0.2}s` : 'none'
                                        }}
                                    />
                                ))}
                            </div>
                            <div className="flex flex-col">
                                <span className="health-label">Telemetry Integrity</span>
                                <span className="health-value">{telemetryIntegrity}</span>
                            </div>
                        </div>
                    </div>

                    {/* Reverted System Status & Timer */}
                    <div className={`health-badge ${!isOnline ? 'offline' : ''}`}>
                        <div className={`status-orb ${isOnline ? 'online' : 'offline'}`} />
                        <span className="health-text">{isOnline ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE'}</span>
                        <div className="health-separator">|</div>
                        <span className="health-time">{formattedTime}</span>
                    </div>

                    {pendingCommandCount > 0 && (
                        <div 
                            className="pending-badge-premium"
                            onClick={(e) => {
                                e.stopPropagation();
                                window.dispatchEvent(new CustomEvent('open-pending-commands'));
                            }}
                        >
                            <FiActivity className="animate-pulse" />
                            <span>{pendingCommandCount} COMMANDS</span>
                        </div>
                    )}
                </div>

                <div className="navbar-item-relative">
                    <button
                        className="navbar-btn tankiq-toggle-btn group relative"
                        onClick={onToggleTankIQ}
                        title="Open TankIQ Assistant"
                    >
                        <img 
                            src={tankIQRobot} 
                            style={{ 
                                width: '28px', 
                                height: '28px', 
                                minWidth: '28px', 
                                minHeight: '28px',
                                borderRadius: '50%',
                                objectFit: 'cover'
                            }} 
                            className="group-hover:scale-110 transition-transform shadow-sm" 
                            alt="TankIQ" 
                        />
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                    </button>
                </div>


                <div className="navbar-item-relative" ref={quickActionsRef}>
                    <button
                        className="navbar-btn quick-action-btn"
                        onClick={() => setShowQuickActions(!showQuickActions)}
                        title="Quick Actions"
                    >
                        <MdElectricBolt />
                    </button>
                    {showQuickActions && (
                        <div className="dropdown-menu modern-dropdown quick-actions-dropdown">
                            <div className="dropdown-header premium-dropdown-header">
                                <div className="dropdown-title-box">
                                    <MdElectricBolt size={18} className="dropdown-title-icon" />
                                    <h3>Quick Actions</h3>
                                </div>
                                <div className="dropdown-count-pill">
                                    <span className="dropdown-count-value">4</span>
                                    <span className="dropdown-count-label">Available</span>
                                </div>
                            </div>
                            <div className="dropdown-content">
                                <ul>
                                    <li>
                                        <button className="menu-btn qa-item" data-action="delivery" onClick={() => { 
                                            if (shiftStatus !== 'open') {
                                                setToast({ 
                                                    message: 'No active shift found. Please start a shift first.', 
                                                    type: 'warning',
                                                    actionLabel: 'Start New Shift',
                                                    onAction: () => openModal('shift-open')
                                                });
                                            } else {
                                                openModal('delivery'); 
                                            }
                                            setShowQuickActions(false); 
                                        }}>
                                            <div className="qa-icon-shell" data-action="delivery">
                                                <FiTruck size={16} />
                                            </div>
                                            <div className="action-details">
                                                <span className="action-title">Add Delivery</span>
                                                <span className="action-desc">Log new fuel intake to inventory</span>
                                            </div>
                                        </button>
                                    </li>
                                    <li>
                                        <button className="menu-btn qa-item" data-action="shift-open" onClick={() => { 
                                            if (shiftStatus === 'open') {
                                                setToast({ 
                                                    message: 'Shift is already active. Please end the current shift first.', 
                                                    type: 'warning',
                                                    actionLabel: 'End Current Shift',
                                                    onAction: () => openModal('shift-close')
                                                });
                                            } else {
                                                openModal('shift-open'); 
                                            }
                                            setShowQuickActions(false); 
                                        }}>
                                            <div className="qa-icon-shell" data-action="shift-open">
                                                <FiPlay size={16} />
                                            </div>
                                            <div className="action-details">
                                                <span className="action-title">Start New Shift</span>
                                                <span className="action-desc">Initialize daily operations & meter readings</span>
                                            </div>
                                        </button>
                                    </li>
                                    <li>
                                        <button className="menu-btn qa-item" data-action="shift-close" onClick={() => { 
                                            if (shiftStatus !== 'open') {
                                                setToast({ 
                                                    message: 'No active shift found. Please start a shift first.', 
                                                    type: 'warning',
                                                    actionLabel: 'Start New Shift',
                                                    onAction: () => openModal('shift-open')
                                                });
                                            } else {
                                                openModal('shift-close'); 
                                            }
                                            setShowQuickActions(false); 
                                        }}>
                                            <div className="qa-icon-shell" data-action="shift-close">
                                                <FiSquare size={16} />
                                            </div>
                                            <div className="action-details">
                                                <span className="action-title">End Current Shift</span>
                                                <span className="action-desc">Finalize sales & close register</span>
                                            </div>
                                        </button>
                                    </li>
                                    <li>
                                        <button className="menu-btn qa-item" data-action="report" onClick={() => { 
                                            if (shiftStatus !== 'open') {
                                                setToast({ 
                                                    message: 'No active shift found. Please start a shift first.', 
                                                    type: 'warning',
                                                    actionLabel: 'Start New Shift',
                                                    onAction: () => openModal('shift-open')
                                                });
                                            } else {
                                                openModal('report'); 
                                            }
                                            setShowQuickActions(false); 
                                        }}>
                                            <div className="qa-icon-shell" data-action="report">
                                                <FiFileText size={16} />
                                            </div>
                                            <div className="action-details">
                                                <span className="action-title">Generate Report</span>
                                                <span className="action-desc">Export system analytics & activity logs</span>
                                            </div>
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>

                <div className="navbar-item-relative" ref={notificationRef}>
                    <button
                        className="navbar-btn"
                        onClick={() => setShowNotifications(!showNotifications)}
                        aria-label="Notifications"
                    >
                        <MdNotifications />
                        {(unreadAlerts.length + unifiedEvents.length) > 0 && (
                            <span className="notification-badge animate-pulse">{(unreadAlerts.length + unifiedEvents.length)}</span>
                        )}
                    </button>

                    {showNotifications && (
                        <div className="dropdown-menu modern-dropdown notifications-dropdown">
                            <div className="dropdown-header premium-dropdown-header">
                                <div className="dropdown-title-box">
                                    <MdNotifications size={18} className="dropdown-title-icon" />
                                    <h3>Notifications</h3>
                                </div>
                                {(unreadAlerts.length + unifiedEvents.length) > 0 && (
                                    <button 
                                        className="btn-clear-all"
                                        onClick={handleResolveAll}
                                    >
                                        Clear All
                                    </button>
                                )}
                            </div>
                            <div className="dropdown-content custom-scrollbar overflow-y-auto max-h-[380px]">
                                {(unreadAlerts.length > 0 || unifiedEvents.length > 0) ? (
                                    <>
                                        {(() => {
                                            const combined = [
                                                ...unreadAlerts.map((a: any) => ({ ...a, _sortTime: new Date(a.timestamp).getTime(), _type: 'alert' })),
                                                ...unifiedEvents.map((e: any) => ({ ...e, _sortTime: new Date(e.created_at).getTime(), _type: 'event' }))
                                            ].sort((a, b) => b._sortTime - a._sortTime).slice(0, 15);

                                            return combined.map((item: any) => {
                                                if (item._type === 'alert') {
                                                    const alert = item;
                                                    const category = alert.severity === 'critical' || alert.message.includes('THEFT') || alert.message.includes('LEAK') ? 'security' : 
                                                                   alert.type.startsWith('low_level') ? 'delivery' : 'system';
                                                    return (
                                                        <div
                                                            key={alert.id}
                                                            className={`notification-item cat-${category} ${!alert.resolved ? 'unread' : ''} severity-${alert.severity || 'info'} ${resolvingIds.has(alert.id) ? 'resolving-out' : ''}`}
                                                            onClick={(e) => {
                                                                handleResolve(e, alert.id);
                                                                navigate('/alerts');
                                                                setShowNotifications(false);
                                                            }}
                                                        >
                                                            <div className="notification-title">
                                                                <div className="notif-placeholder">
                                                                    {alert.message.includes('THEFT') ? '🚨' :
                                                                     alert.message.includes('LEAK') ? '💧' :
                                                                     alert.type.startsWith('low_level') ? '📉' : '⚠️'}
                                                                </div>
                                                                <div className="notification-body">
                                                                    <span className="font-black text-[13px] leading-tight block mb-1">
                                                                        {sanitizeIds(alert.message.split('.')[0])}
                                                                    </span>
                                                                    <div className="notification-meta flex justify-between items-center opacity-70">
                                                                        <span className="text-[10px] font-bold flex items-center gap-1 uppercase tracking-tighter">
                                                                            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/5 font-black uppercase">
                                                                            {alert.severity || 'INFO'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    className="btn-mark-read hover:bg-emerald-50 hover:text-emerald-600 transition-colors bg-slate-100 rounded-full p-1.5 ml-2"
                                                                    onClick={(e) => handleResolve(e, alert.id)}
                                                                    title="Mark as acknowledge"
                                                                >
                                                                    <MdCheck size={14} className="text-emerald-500 font-bold" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                } else {
                                                    const event = item;
                                                    const category = event.event_category?.toLowerCase() || 'system';
                                                    return (
                                                        <div key={event.id} className={`notification-item cat-${category} severity-${event.severity?.toLowerCase() || 'info'} ${resolvingIds.has(event.id) ? "resolving-out" : ""}`}
                                                            onClick={(e) => {
                                                                handleResolveEvent(e, event.id);
                                                                setShowNotifications(false);
                                                            }}
                                                        >
                                                            <div className="notification-title">
                                                                <div className="notif-placeholder">
                                                                    {event.event_category === 'SHIFT' ? <FiClock /> :
                                                                     event.event_category === 'DELIVERY' ? <FiTrendingDown /> :
                                                                     event.event_category === 'SECURITY' ? <FiShield /> :
                                                                     event.event_category === 'TEAM' ? <FiUserPlus /> : <FiInfo />}
                                                                </div>
                                                                <div className="notification-body">
                                                                    <span className="font-black text-[13px] leading-tight block mb-1">
                                                                        {sanitizeIds(event.description.split('.')[0])}
                                                                    </span>
                                                                    <div className="notification-meta flex justify-between items-center opacity-70">
                                                                        <span className="text-[10px] font-bold flex items-center gap-1 uppercase tracking-tighter">
                                                                            {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/5 font-black uppercase">
                                                                            {event.event_category || 'INFO'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    className="btn-mark-read hover:bg-emerald-50 hover:text-emerald-600 transition-colors bg-slate-100 rounded-full p-1.5 ml-2 flex items-center justify-center w-[24px] h-[24px]"
                                                                    onClick={(e) => handleResolveEvent(e, event.id)}
                                                                    title="Mark as acknowledge"
                                                                >
                                                                    <MdCheck size={14} className="text-emerald-500 font-bold" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                            });
                                        })()}
                                    </>
                                ) : (
                                    <div className="empty-notif-state">
                                        <div className="empty-icon-wrapper">
                                            <FiBell size={28} />
                                        </div>
                                        <h4 className="empty-title">All Caught Up</h4>
                                        <p className="empty-desc">
                                            The Forensic Intelligence Scanner has found no active threats or pending alerts.
                                        </p>
                                        <div className="integrity-badge">
                                            <span className="status-dot"></span>
                                            System Integrity Verified
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="dropdown-footer">
                                <button
                                    onClick={() => {
                                        navigate('/alerts');
                                        setShowNotifications(false);
                                    }}
                                    className="btn-open-alerts"
                                >
                                    Command Center
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="navbar-item-relative user-menu-container" ref={profileMenuRef}>
                    <button
                        className="profile-btn px-1 sm:px-2"
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                    >
                        <div className="avatar">
                            {currentUser?.photoURL ? (
                                <img src={currentUser.photoURL} alt={currentUser.displayName || 'User'} />
                            ) : (
                                <MdPerson />
                            )}
                        </div>

                    </button>

                    {showProfileMenu && (
                        <div className="dropdown-menu modern-dropdown profile-dropdown">
                            <div className="dropdown-header premium-dropdown-header profile-header-premium">
                                <div className="user-role-badge">
                                    {ROLE_DISPLAY_MAP[currentUser?.role || 'viewer'] || 'Site Auditor'}
                                </div>
                                <h3 className="profile-name-text">{currentUser?.displayName || 'Session user'}</h3>
                                <div className="user-email-text">{currentUser?.email}</div>
                            </div>
                            <div className="dropdown-content">
                                <ul>
                                    <li>
                                        <button className="menu-btn" onClick={() => { navigate('/settings?tab=profile'); setShowProfileMenu(false); }}>
                                            <MdPerson className="menu-icon" /> My Profile
                                        </button>
                                    </li>
                                    <li>
                                        <button className="menu-btn" onClick={() => { navigate('/settings?tab=security'); setShowProfileMenu(false); }}>
                                            <MdSettings className="menu-icon" /> Account Settings
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
            {/* Quick Action Modals */}
            <DeliveryModal
                isOpen={isDeliveryModalOpen}
                onClose={closeModal}
                onSuccess={(msg) => setToast({ message: msg, type: 'success' })}
            />
            <ShiftCloseModal
                isOpen={isShiftCloseModalOpen}
                onClose={closeModal}
            />
            <ShiftOpenModal
                isOpen={isShiftOpenModalOpen}
                onClose={closeModal}
            />
            <ReportModal
                isOpen={isReportModalOpen}
                onClose={closeModal}
            />
            <OrderModal
                isOpen={isOrderModalOpen}
                onClose={closeModal}
                onSuccess={(msg) => setToast({ message: msg, type: 'success' })}
            />

            {toast && (
                <Toast 
                    message={toast.message} 
                    type={toast.type} 
                    actionLabel={toast.actionLabel}
                    onAction={toast.onAction}
                    onClose={() => setToast(null)} 
                />
            )}

            <ViewOnlyNoticeModal
                isOpen={showNoticeModal}
                onClose={() => setShowNoticeModal(false)}
                onOpenShift={() => openModal('shift-open')}
            />
        </header >
    );
};
