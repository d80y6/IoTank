import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { SkeletonLoader } from '@shared/components/Common/SkeletonLoader';
import { ErrorBoundary } from '@shared/components/Common/ErrorBoundary';

// Lazy load pages
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ClientsList = lazy(() => import('./pages/ClientsList'));
const BillingList = lazy(() => import('./pages/BillingList'));
const ClientDetails = lazy(() => import('./pages/ClientDetails'));
const SystemUsers = lazy(() => import('./pages/SystemUsers'));
const AdminLogs = lazy(() => import('./pages/AdminLogs'));
const SupportTickets = lazy(() => import('./pages/SupportTickets'));
const PendingRegistrations = lazy(() => import('./pages/PendingRegistrations'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const HardwareMonitoring = lazy(() => import('./pages/HardwareMonitoring'));
const AnalyticsReports = lazy(() => import('./pages/AnalyticsReports'));
const AuditCompliance = lazy(() => import('./pages/AuditCompliance'));
const Announcements = lazy(() => import('./pages/Announcements'));
const SecurityEvents = lazy(() => import('./pages/SecurityEvents'));
const HelpCenter = lazy(() => import('./pages/HelpCenter'));
const JurisdictionRegistryPage = lazy(() => import('./pages/JurisdictionRegistryPage'));
const SystemUtilities = lazy(() => import('./pages/SystemUtilities'));

// Mission Hubs
const FleetHub = lazy(() => import('./pages/FleetHub'));
const GovernanceHub = lazy(() => import('./pages/GovernanceHub'));
const WorkforceHub = lazy(() => import('./pages/WorkforceHub'));
const ResourceHub = lazy(() => import('./pages/ResourceHub'));

function App() {
  return (
    <ErrorBoundary fallback={
      <div style={{ padding: '80px', textAlign: 'center', background: '#F4F5FF', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h2 style={{ color: '#323264', fontWeight: 900, marginBottom: '20px' }}>MISSION INTERRUPTED</h2>
        <p style={{ color: '#7A7A95', marginBottom: '32px' }}>A critical system error occurred. Re-synchronization required.</p>
        <button onClick={() => window.location.assign('/')} style={{ padding: '12px 24px', background: '#00D4FF', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          RE-SYNC INTERFACE
        </button>
      </div>
    }>
      <ThemeProvider>
        <AuthProvider>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={<SkeletonLoader />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                {/* Protected Routes - Level 4 (All Staff) */}
                <Route element={<ProtectedRoute requiredLevel={4} />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/clients" element={<ClientsList />} />
                  <Route path="/billing" element={<BillingList />} />
                  <Route path="/clients/:id" element={<ClientDetails />} />
                  <Route path="/support" element={<SupportTickets />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/help" element={<HelpCenter />} />

                  {/* Operational Hubs (Level 4) */}
                  <Route path="/workforce" element={<WorkforceHub />} />
                  <Route path="/resources" element={<ResourceHub />} />
                </Route>

                {/* Protected Routes - Level 1 (Super Admin Only - 7 Titles) */}
                <Route element={<ProtectedRoute requiredLevel={1} />}>
                  <Route path="/admins" element={<SystemUsers />} />
                  <Route path="/hardware" element={<HardwareMonitoring />} />
                  <Route path="/analytics" element={<AnalyticsReports />} />
                  <Route path="/audit" element={<AuditCompliance />} />
                  <Route path="/security-events" element={<SecurityEvents />} />
                  <Route path="/announcements" element={<Announcements />} />
                  <Route path="/logs" element={<AdminLogs />} />
                  <Route path="/registrations" element={<PendingRegistrations />} />
                  <Route path="/jurisdictions" element={<JurisdictionRegistryPage />} />
                  <Route path="/system" element={<SystemUtilities />} />

                  {/* Strategic Hubs (Level 1) */}
                  <Route path="/fleet" element={<FleetHub />} />
                  <Route path="/governance" element={<GovernanceHub />} />
                </Route>

                {/* Catch all */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
