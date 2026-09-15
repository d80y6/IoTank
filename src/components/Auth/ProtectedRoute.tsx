import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { UserRole } from '@/types';
import { ProvisioningGuard } from './ProvisioningGuard';
import './ProtectedRoute.css';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredRole?: UserRole | UserRole[];
    requiredLevel?: number;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
    children,
    requiredRole,
    requiredLevel,
}) => {
    const { currentUser, loading, hasRole, canSee } = useAuth();
    const location = useLocation();

    const [loadingTimeout, setLoadingTimeout] = React.useState(false);

    React.useEffect(() => {
        if (loading) {
            const timer = setTimeout(() => setLoadingTimeout(true), 8000);
            return () => clearTimeout(timer);
        } else {
            setLoadingTimeout(false);
        }
    }, [loading]);
    
    // [ENRICHMENT GUARD]: Show loader if either authentication is still loading
    // OR if the user is present but identity enrichment (provisional status) is still in progress.
    const shouldShowLoader = loading || currentUser?.isProvisional;

    if (shouldShowLoader) {
        return (
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
                            Verifying system clearance
                        </p>
                        <p className="clearance-subtitle animate-pulse">
                            Establishing secure telemetry baseline...
                        </p>
                    </div>

                    <div className="psych-progress-container">
                        <div className="psych-progress-bar"></div>
                    </div>

                    <div className="clearance-video-wrap">
                        <video
                            src="https://v1.pinimg.com/videos/iht/expMp4/59/24/45/592445ca657c7225e76d41bf1d4c17aa_720w.mp4"
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="clearance-video"
                            onCanPlay={(e) => (e.currentTarget.muted = true)}
                        />
                    </div>
                </div>

                {loadingTimeout && (
                    <div className="clearance-timeout-card">
                        <p className="clearance-timeout-msg">Establishing secure connection is taking longer than expected.</p>
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => window.location.reload()}
                        >
                            Force Re-Sync
                        </button>
                    </div>
                )}
            </div>
        );
    }

    if (!currentUser) {
        // [AUTH HARMONY]: If loading is false but we have no user, we redirect.
        // However, we MUST ensure the AuthContext isn't about to set a user.
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Wrap the legitimate children in a ProvisioningGuard to stop white-screen crashes
    // if the user is authenticated but not yet fully provisioned.
    return (
        <ProvisioningGuard>
            {/* 1. Check specific roles if provided */}
            {requiredRole && !hasRole(requiredRole) ? (
                <div className="denied-container">
                    <h1 className="text-3xl font-bold mb-4">Access Denied</h1>
                    <p className="text-secondary mb-6">
                        You don't have permission to access this page.
                    </p>
                    <a href="/dashboard" className="btn btn-primary">
                        Return to Dashboard
                    </a>
                </div>
            ) : requiredLevel !== undefined && !canSee(requiredLevel) ? (
                <Navigate to="/unauthorized" replace />
            ) : (
                <>{children}</>
            )}
        </ProvisioningGuard>
    );
};
