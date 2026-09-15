/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, Suspense, lazy } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Navbar } from './Navbar';
import { useAlerts, useTanks, useAllLatestReadings } from '@/hooks/useSupabase';
import { useBrowserNotifications } from '@/hooks/useBrowserNotifications';
import { useAlertEngine } from '@/hooks/useAlertEngine';
import { useEPRANotifier } from '@/hooks/useEPRANotifier';
import { AlertBanner } from '../Alerts/AlertBanner';
import TermsModal from '../Landing/TermsModal';
import { PhotoNudgeBanner } from './PhotoNudgeBanner';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiFacebook, FiInstagram, FiTwitter } from 'react-icons/fi';
import { PageLoader } from '../Common/PageLoader';
import { TankIQSidebar } from '../Analysis/TankIQSidebar';
import { useWindowSize } from '@/hooks/useWindowSize';
import { NotificationService } from '@/services/NotificationService';
import brandMark from '@/assets/iotank-official-logo.png';

const TourGuide = lazy(() => import('../Tour/TourGuide').then(module => ({ default: module.TourGuide })));

import './MainLayout.css';

import { RefillVerificationModal } from '../Alerts/RefillVerificationModal';
import { SecurityIntrusionModal } from '../Alerts/SecurityIntrusionModal';
import SecurityPromptModal from '../Auth/SecurityPromptModal';
import { AutoUpdatePriceModal } from '../Market/AutoUpdatePriceModal';

export const MainLayout: React.FC = () => {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isTankIQOpen, setIsTankIQOpen] = useState(false);

    // Modal state for footer links
    const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
    const [modalInitialStep, setModalInitialStep] = useState(0);

    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const isFullBleedPage = location.pathname.includes('/alerts');
    const [showNudge, setShowNudge] = useState(() => {
        // Only show if user has no photo and hasn't dismissed it this session
        const dismissed = sessionStorage.getItem('photo_nudge_dismissed');
        return !currentUser?.photoURL && !dismissed;
    });

    const [showSecurityPrompt, setShowSecurityPrompt] = useState(false);

    // [REACTIVE SECURITY LOGIC]: Synchronize the nudge state when the user profile is enriched.
    // If the user has MFA or a PIN, the nudge should disappear automatically.
    React.useEffect(() => {
        const dismissed = sessionStorage.getItem('security_nudge_dismissed');
        const shouldShow = !!currentUser && !currentUser.mfaEnabled && !currentUser.securityPinEnabled && !dismissed;
        setShowSecurityPrompt(shouldShow);
    }, [currentUser?.mfaEnabled, currentUser?.securityPinEnabled, currentUser?.authUserId]);

    // Activate EPRA Notifications Engine
    useEPRANotifier();

    // Mobile Sidebar Inactivity Timer
    const mobileMenuTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    const resetMobileTimer = React.useCallback(() => {
        if (mobileMenuTimerRef.current) {
            clearTimeout(mobileMenuTimerRef.current);
        }
        if (isMobileMenuOpen) {
            mobileMenuTimerRef.current = setTimeout(() => {
                setIsMobileMenuOpen(false);
            }, 5000);
        }
    }, [isMobileMenuOpen]);

    React.useEffect(() => {
        if (isMobileMenuOpen) {
            resetMobileTimer();
        } else if (mobileMenuTimerRef.current) {
            clearTimeout(mobileMenuTimerRef.current);
            mobileMenuTimerRef.current = null;
        }

        return () => {
            if (mobileMenuTimerRef.current) {
                clearTimeout(mobileMenuTimerRef.current);
            }
        };
    }, [isMobileMenuOpen, resetMobileTimer]);

    // Ensure route changes scroll to the top of the page
    React.useEffect(() => {
        window.scrollTo(0, 0);
    }, [location.pathname]);

    const handleNudgeUpload = () => {
        setShowNudge(false);
        sessionStorage.setItem('photo_nudge_dismissed', 'true');
        navigate('/settings?tab=profile');
    };

    const handleNudgeDismiss = () => {
        setShowNudge(false);
        sessionStorage.setItem('photo_nudge_dismissed', 'true');
    };

    // Fetch notifications for the floating pop-ups
    const stationId = currentUser?.stationId || '';
    const { alerts } = useAlerts(stationId, false);
    const { tanks } = useTanks(stationId);
    
    const tankIds = React.useMemo(() => tanks.map((t: import('@/types').Tank) => t.id), [tanks]);
    const { readings } = useAllLatestReadings(stationId, tankIds);

    const unreadAlerts = alerts.filter((a: import('@/types').Alert) => !a.resolved).slice(0, 1);

    // [FORENSIC GLOBAL TRIGGER]: Automatically pop reconciliation modal for new refill completions
    const [activeRefillAlert, setActiveRefillAlert] = useState<any>(null);
    React.useEffect(() => {
        const latestRefill = alerts.find((a: import('@/types').Alert) => 
            (a.type === 'refill' || a.type === 'refill_detected' || a.type === 'unauthorized_refill') && 
            !a.resolved && 
            (a.metadata?.type === 'REFILL' || a.metadata?.type === 'UNAUTHORIZED_REFILL' || a.metadata?.type === 'REFILL_COMPLETE' || a.metadata?.type === 'UNAUTHORIZED_REFILL_COMPLETE') &&
            // Only auto-pop if it happened in the last 5 minutes to avoid stale pops on login
            (a.metadata?.detectedAt ? (Date.now() - new Date(a.metadata.detectedAt).getTime()) < 300000 : true)
        );
        if (latestRefill && (!activeRefillAlert || activeRefillAlert.id !== latestRefill.id)) {
            setActiveRefillAlert(latestRefill);
        }
    }, [alerts, activeRefillAlert]);

    // [SECURITY GLOBAL TRIGGER]: Automatically pop security intrusion modal for THEFT/LEAK
    const [activeSecurityAlert, setActiveSecurityAlert] = useState<any>(null);
    const snoozedAlertsRef = React.useRef<Record<string, number>>({});
    
    React.useEffect(() => {
        const latestSecurity = alerts.find((a: import('@/types').Alert) => 
            (a.type === 'anomaly' || a.type === 'leak_detected' || a.type === 'theft_detected') && 
            !a.resolved && 
            (a.metadata?.type?.includes('THEFT') || a.metadata?.type?.includes('LEAK')) &&
            // Filter out stale alerts (5 min window)
            (a.metadata?.detectedAt ? (Date.now() - new Date(a.metadata.detectedAt).getTime()) < 300000 : true)
        );
        
        if (latestSecurity) {
            const snoozeTimestamp = snoozedAlertsRef.current[latestSecurity.id];
            const isSnoozed = snoozeTimestamp && (Date.now() - snoozeTimestamp < 20000); // 20 seconds snooze
            
            if (!isSnoozed && (!activeSecurityAlert || activeSecurityAlert.id !== latestSecurity.id)) {
                setActiveSecurityAlert(latestSecurity);
            }
        }
    }, [alerts, activeSecurityAlert]);

    // Native Browser Notifications
    useBrowserNotifications(stationId);

    // [SECURITY HEARTBEAT]: Global Alert Detection Engine (Theft/Leak/Refill)
    const alertEngine = useAlertEngine(stationId);

    // [TELEMETRY PIPELINE]: Feed real-time readings into the engine
    React.useEffect(() => {
        if (!readings || Object.keys(readings).length === 0) return;
        
        Object.entries(readings).forEach(([tankId, reading]) => {
            alertEngine.updateReading(tankId, reading as any);
        });
    }, [readings, alertEngine]);

    // [NOTIFICATION NUDGE]: Prompt user to enable browser alerts if not set
    React.useEffect(() => {
        const checkNudge = async () => {
            if (NotificationService.shouldShowNudge()) {
                const isBlocked = Notification.permission === 'denied';
                
                // Wait a bit after mount for visual clarity
                const timer = setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('system-toast', {
                        detail: {
                            title: isBlocked ? 'Tactical Alerts: Permissions Blocked' : 'Tactical Alerts: Enable Browser Dispatch',
                            message: isBlocked 
                                ? 'Browser notifications are currently blocked for this site. To receive real-time critical security alerts and telemetry warnings when closed, please click the site settings (lock icon next to the URL) and change Notifications to "Allow".'
                                : 'Get real-time browser notifications for critical security events and inventory levels even when you are on other tabs.',
                            type: isBlocked ? 'warning' : 'info',
                            persistent: true,
                            actions: [
                                {
                                    label: 'Dismiss',
                                    onClick: () => NotificationService.dismissNudge()
                                },
                                ...(!isBlocked ? [{
                                    label: 'Enable Alerts',
                                    primary: true,
                                    onClick: async () => {
                                        const granted = await NotificationService.requestPermission();
                                        if (granted && currentUser?.authUserId) {
                                            await NotificationService.subscribeToPush(currentUser.authUserId);
                                            window.dispatchEvent(new CustomEvent('system-toast', {
                                                detail: {
                                                    title: 'Alerts Activated',
                                                    message: 'Browser dispatch is now active. You will receive mission-critical updates in real-time.',
                                                    type: 'success'
                                                }
                                            }));
                                        }
                                    }
                                }] : [])
                            ]
                        }
                    }));
                }, 3000);
                return () => clearTimeout(timer);
            }
        };
        checkNudge();
    }, [currentUser?.authUserId]);

    const { width } = useWindowSize();

    // Auto-collapse sidebar on tablet, expand on desktop, use mobile menu on phone
    React.useEffect(() => {
        if (width <= 600) {
            setSidebarCollapsed(false); // Mobile menu doesn't use 'collapsed' state usually
        } else if (width > 600 && width <= 1024) {
            setSidebarCollapsed(true);
        } else {
            setSidebarCollapsed(false);
        }
    }, [width]);

    const toggleSidebar = () => {
        if (width <= 600) {
            setIsMobileMenuOpen(!isMobileMenuOpen);
        } else {
            setSidebarCollapsed(!sidebarCollapsed);
        }
    };

    const openLegalModal = (step: number) => {
        setModalInitialStep(step);
        setIsTermsModalOpen(true);
    };

    return (
        <div className={`main-layout ${sidebarCollapsed ? 'collapsed' : ''} ${isMobileMenuOpen ? 'mobile-menu-active' : ''}`}>
            <Suspense fallback={null}>
                <TourGuide />
            </Suspense>

            {/* Global Floating Alert Notification */}
            <div className="alerts-floating-container">
                {unreadAlerts.map((alert: any) => (
                    <AlertBanner key={`${alert.id}-${alert.timestamp}`} alert={alert} floating={true} />
                ))}
            </div>
            <Sidebar
                collapsed={sidebarCollapsed}
                mobileOpen={isMobileMenuOpen}
                closeMobile={() => setIsMobileMenuOpen(false)}
                onActivity={resetMobileTimer}
            />

            <TankIQSidebar 
                isOpen={isTankIQOpen} 
                onClose={() => setIsTankIQOpen(false)} 
                onToggle={() => setIsTankIQOpen(!isTankIQOpen)}
            />

            <div className="content-wrapper">
                <Navbar 
                    onToggleSidebar={toggleSidebar} 
                    onToggleTankIQ={() => setIsTankIQOpen(!isTankIQOpen)}
                />
                {showNudge && currentUser && (
                    <PhotoNudgeBanner
                        onUploadClick={handleNudgeUpload}
                        onDismiss={handleNudgeDismiss}
                    />
                )}

                <main className={`main-content ${isFullBleedPage ? 'full-bleed' : ''}`}>
                    <Suspense fallback={<PageLoader />}>
                        <Outlet />
                    </Suspense>
                </main>

                <footer className="mission-control-footer">
                    <div className="footer-left">
                        <div className="footer-brand">
                            <img src={brandMark} alt="IoTank" className="footer-brand-logo" />
                            <div className="v-divider"></div>
                            <div className="system-tag">
                                <span className="tag-label">Client Hub</span>
                                <span className="tag-version">V2.0.0-PRO</span>
                            </div>
                        </div>
                        <div className="v-divider hidden xl:block"></div>
                        <div className="legal-text hidden xl:block">
                            © 2026 <span className="text-accent-primary">The IoTank</span>
                        </div>
                    </div>
                    
                    <div className="footer-center">
                        <nav className="footer-nav">
                            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }} className="footer-nav-link">hub dashboard</a>
                            <a href="/inventory" onClick={(e) => { e.preventDefault(); navigate('/inventory'); }} className="footer-nav-link">inventory</a>
                            <a href="/analytics" onClick={(e) => { e.preventDefault(); navigate('/analytics'); }} className="footer-nav-link">analytics</a>
                        </nav>
                    </div>

                    <div className="footer-right">
                        <div className="footer-status-legal">
                            <div className="uptime-index">
                                <span className="pulse-cyan"></span> <span className="hidden sm:inline">Status:</span> Operational
                            </div>
                            <div className="v-divider"></div>
                            <a href="#privacy" onClick={(e) => { e.preventDefault(); openLegalModal(0); }} className="footer-nav-link !text-[10px]">Privacy</a>
                            <div className="v-divider"></div>
                            <a href="#aup" onClick={(e) => { e.preventDefault(); openLegalModal(2); }} className="footer-nav-link !text-[10px]">Acceptable Use</a>
                        </div>
                        
                        <div className="v-divider hidden lg:block"></div>

                        <div className="footer-social">
                            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="social-pill" title="Facebook" aria-label="IoTank on Facebook"><FiFacebook /></a>
                            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="social-pill" title="Instagram" aria-label="IoTank on Instagram"><FiInstagram /></a>
                            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="social-pill" title="Twitter" aria-label="IoTank on Twitter"><FiTwitter /></a>
                        </div>
                    </div>
                </footer>
            </div>

            <TermsModal
                isOpen={isTermsModalOpen}
                onClose={() => setIsTermsModalOpen(false)}
                onComplete={() => setIsTermsModalOpen(false)}
                initialStep={modalInitialStep}
                readOnly={true}
            />

            {/* Mobile Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="mobile-overlay"
                    onClick={() => setIsMobileMenuOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Global Refill Reconciliation (Auto-Pop) */}
            {activeRefillAlert && (
                <RefillVerificationModal
                    alert={activeRefillAlert}
                    stationId={stationId}
                    onClose={() => setActiveRefillAlert(null)}
                />
            )}
            {/* Global Security Intrusion (Auto-Pop) */}
            {activeSecurityAlert && (
                <SecurityIntrusionModal
                    event={{
                        message: activeSecurityAlert.message,
                        metadata: {
                            forensicData: {
                                type: activeSecurityAlert.metadata?.type?.includes('THEFT') ? 'THEFT' : 'LEAK',
                                dropRate: activeSecurityAlert.metadata?.dropRate || 0,
                                volumeLost: activeSecurityAlert.metadata?.volumeLost,
                                tankName: activeSecurityAlert.title?.split(': ')[1] || 'Unknown Tank',
                                timestamp: activeSecurityAlert.metadata?.detectedAt || new Date().toISOString()
                            }
                        }
                    }}
                    onClose={() => {
                        if (activeSecurityAlert) {
                            snoozedAlertsRef.current[activeSecurityAlert.id] = Date.now();
                        }
                        setActiveSecurityAlert(null);
                    }}
                />
            )}

            <SecurityPromptModal 
                isOpen={!!showSecurityPrompt} 
                onClose={() => {
                    setShowSecurityPrompt(false);
                    sessionStorage.setItem('security_nudge_dismissed', 'true');
                }} 
            />

            {/* Global Market Price Auto-Update (Immediate & 1hr Reminder) */}
            <AutoUpdatePriceModal stationId={stationId} />
        </div>
    );
};
