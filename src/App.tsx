import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { ProtectedRoute } from '@/components/Auth/ProtectedRoute';
import { MainLayout } from '@/components/Layout/MainLayout';
import { GlobalToast } from '@/components/Common/GlobalToast';
import { CookieConsent } from '@/components/Common/CookieConsent';
import { enableGovernanceConsole } from '@/config/supabase';
import '@/styles/theme.css';
import '@/styles/global.css';
import '@/styles/modules.css';
import '@/styles/mobile.css';
import '@/styles/tour.css';
import '@/styles/recaptcha.css';

export const LandingPageFactory = () => import('@/components/Landing/LandingPage').then(module => ({ default: module.LandingPage }));
const LandingPage = lazy(LandingPageFactory);
export const LoginFormFactory = () => import('@/components/Auth/LoginForm').then(module => ({ default: module.LoginForm }));
const LoginForm = lazy(LoginFormFactory);
const ForgotPasswordForm = lazy(() => import('@/components/Auth/ForgotPasswordForm').then(module => ({ default: module.ForgotPasswordForm })));
const ResetPasswordForm = lazy(() => import('@/components/Auth/ResetPasswordForm').then(module => ({ default: module.ResetPasswordForm })));
export const DashboardFactory = () => import('@/components/Dashboard/Dashboard').then(module => ({ default: module.Dashboard }));
const Dashboard = lazy(DashboardFactory);
export const InventoryPageFactory = () => import('@/components/Inventory/InventoryPage').then(module => ({ default: module.InventoryPage }));
const InventoryPage = lazy(InventoryPageFactory);
export const AnalyticsPageFactory = () => import('@/components/Analytics/AnalyticsPage').then(module => ({ default: module.AnalyticsPage }));
const AnalyticsPage = lazy(AnalyticsPageFactory);

export const MarketPageFactory = () => import('@/components/Market/MarketPage').then(module => ({ default: module.MarketPage }));
const MarketPage = lazy(MarketPageFactory);
export const AlertsCenterFactory = () => import('@/components/Alerts/AlertsCenter').then(module => ({ default: module.AlertsCenter }));
const AlertsCenter = lazy(AlertsCenterFactory);
export const ReportingPageFactory = () => import('@/components/Reporting/ReportingPage').then(module => ({ default: module.ReportingPage }));
const ReportingPage = lazy(ReportingPageFactory);
const AIGovernancePage = lazy(() => import('@/components/Governance/AIGovernancePage').then(module => ({ default: module.AIGovernancePage })));
export const SettingsPageFactory = () => import('@/components/Settings/SettingsPage').then(module => ({ default: module.SettingsPage }));
const SettingsPage = lazy(SettingsPageFactory);
export const HelpPageFactory = () => import('@/components/Help/HelpPage').then(module => ({ default: module.HelpPage }));
const HelpPage = lazy(HelpPageFactory);
export const EventLogPageFactory = () => import('@/components/History/EventLogPage').then(module => ({ default: module.EventLogPage }));
const EventLogPage = lazy(EventLogPageFactory);
const BillingPage = lazy(() => import('@/components/Billing/BillingPage').then(module => ({ default: module.BillingPage })));
export const TeamManagementFactory = () => import('@/components/Users/TeamManagement').then(module => ({ default: module.TeamManagement }));
const TeamManagement = lazy(TeamManagementFactory);
export const DeliveriesPageFactory = () => import('@/components/Deliveries/DeliveriesPage').then(module => ({ default: module.DeliveriesPage }));
const DeliveriesPage = lazy(DeliveriesPageFactory);
export const ShiftManagementPageFactory = () => import('@/components/Shifts/ShiftManagementPage').then(module => ({ default: module.ShiftManagementPage }));
const ShiftManagementPage = lazy(ShiftManagementPageFactory);
const NetworkPulsePage = lazy(() => import('@/components/Governance/NetworkPulsePage').then(module => ({ default: module.NetworkPulsePage })));
const InadequateClearancePage = lazy(() => import('@/components/Auth/InadequateClearancePage').then(module => ({ default: module.InadequateClearancePage })));
const AcceptableUsePolicy = lazy(() => import('@/components/Landing/AcceptableUsePolicy').then(module => ({ default: module.default })));

// PAYSTACK MODULES
// Consolidated into BillingPage



const PublicLoader = () => (
    <div className="clearance-overlay">
        <div className="clearance-content">
            <div className="advanced-loader">
                <div className="loader-pulse"></div>
                <div className="loader-ring"></div>
                <div className="loader-ring"></div>
                <div className="loader-ring"></div>
            </div>
            
            <div className="clearance-status">
                <p className="clearance-title">
                    IoTank Intelligence
                </p>
                <p className="clearance-subtitle animate-pulse">
                    Synchronizing secure telemetry baseline...
                </p>
            </div>

            <div className="psych-progress-container">
                <div className="psych-progress-bar"></div>
            </div>
        </div>
    </div>
);

import { ErrorBoundary } from '@/components/Common/ErrorBoundary';
import { TelemetryQueueProvider } from '@/contexts/TelemetryQueueContext';
import { ModalProvider } from '@/contexts/ModalContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';



function App() {

    return (
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <TelemetryQueueProvider>
                    <ModalProvider>
                <ConfigProvider>
                    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                        <ThemeProvider>
                            <AuthProvider>
                                <GlobalToast />
                                <CookieConsent />
                                <Routes>
                                    {/* Public routes */}
                                    <Route path="/" element={<Suspense fallback={<PublicLoader />}><LandingPage /></Suspense>} />
                                    <Route path="/login" element={<Suspense fallback={<PublicLoader />}><LoginForm /></Suspense>} />
                                    <Route path="/forgot-password" element={<Suspense fallback={<PublicLoader />}><ForgotPasswordForm /></Suspense>} />
                                    <Route path="/reset-password" element={<Suspense fallback={<PublicLoader />}><ResetPasswordForm /></Suspense>} />
                                    <Route path="/aup" element={<Suspense fallback={<PublicLoader />}><AcceptableUsePolicy /></Suspense>} />

                                    {/* Protected Application Routes - Level 8 (Minimum for all) */}
                                    <Route element={<ProtectedRoute requiredLevel={8}><MainLayout /></ProtectedRoute>}>
                                        <Route path="dashboard" element={<Suspense fallback={<PublicLoader />}><Dashboard /></Suspense>} />
                                        <Route path="inventory" element={<Suspense fallback={<PublicLoader />}><InventoryPage /></Suspense>} />

                                        <Route path="market" element={<Suspense fallback={<PublicLoader />}><MarketPage /></Suspense>} />
                                        <Route path="alerts" element={<Suspense fallback={<PublicLoader />}><AlertsCenter /></Suspense>} />
                                        <Route path="help" element={<Suspense fallback={<PublicLoader />}><HelpPage /></Suspense>} />
                                        <Route path="bottom-link" element={<Suspense fallback={<PublicLoader />}><HelpPage /></Suspense>} />
                                        <Route path="settings" element={<Suspense fallback={<PublicLoader />}><SettingsPage /></Suspense>} />
                                    </Route>

                                    {/* Protected Application Routes - Level 6 (Supervisor) */}
                                    <Route element={<ProtectedRoute requiredLevel={6}><MainLayout /></ProtectedRoute>}>
                                        <Route path="analytics" element={<Suspense fallback={<PublicLoader />}><AnalyticsPage /></Suspense>} />
                                        <Route path="reporting" element={<Suspense fallback={<PublicLoader />}><ReportingPage /></Suspense>} />
                                        <Route path="deliveries" element={<Suspense fallback={<PublicLoader />}><DeliveriesPage /></Suspense>} />
                                        <Route path="shifts" element={<Suspense fallback={<PublicLoader />}><ShiftManagementPage /></Suspense>} />
                                        <Route path="inventory/transactions" element={<Suspense fallback={<PublicLoader />}><DeliveriesPage /></Suspense>} />
                                        <Route path="event-log" element={<Suspense fallback={<PublicLoader />}><EventLogPage /></Suspense>} />
                                    </Route>

                                    {/* Protected Application Routes - Level 5 (Admin) */}
                                    <Route element={<ProtectedRoute requiredLevel={5}><MainLayout /></ProtectedRoute>}>
                                        <Route path="billing" element={<Suspense fallback={<PublicLoader />}><BillingPage /></Suspense>} />
                                        <Route path="users" element={<Suspense fallback={<PublicLoader />}><TeamManagement /></Suspense>} />
                                    </Route>
                                    
                                    {/* Protected Application Routes - Level 4 (Governance/Super Admin) */}
                                    <Route element={<ProtectedRoute requiredLevel={4}><MainLayout /></ProtectedRoute>}>
                                        {enableGovernanceConsole && <Route path="governance" element={<Suspense fallback={<PublicLoader />}><AIGovernancePage /></Suspense>} />}
                                        <Route path="admin/pulse" element={<Suspense fallback={<PublicLoader />}><NetworkPulsePage /></Suspense>} />
                                    </Route>
                                    <Route path="/unauthorized" element={<Suspense fallback={<PublicLoader />}><InadequateClearancePage /></Suspense>} />
                                </Routes>
                            </AuthProvider>
                        </ThemeProvider>
                    </BrowserRouter>
                </ConfigProvider>
                </ModalProvider>
                </TelemetryQueueProvider>
            </QueryClientProvider>
        </ErrorBoundary>
    );
}

export default App;
