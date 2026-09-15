import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaLock, FaCheckCircle, FaExclamationTriangle, FaShieldAlt, FaTimesCircle } from 'react-icons/fa';
import { supabase } from '@/config/supabase';
import { useAuth } from '@/hooks/useAuth';
import { PasswordInput } from './PasswordInput';
import { logger } from '@/utils/logger';
import './LoginForm.css';

export const ResetPasswordForm: React.FC = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [mfaCode, setMfaCode] = useState('');
    const [mfaLoading, setMfaLoading] = useState(false);
    
    const { mfaChallengeRequired, verifyMFA, cancelMFAChallenge, checkMFAChallenge } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        let retries = 0;
        const maxRetries = 10;
        const retryInterval = 500; // ms

        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setLoading(false);
                return;
            }

            if (retries < maxRetries) {
                retries++;
                setTimeout(checkSession, retryInterval);
            } else {
                setError('No active recovery session found. Please request a new reset link and ensure you click the link directly.');
                setLoading(false);
            }
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) {
                setLoading(false);
                setError('');
            }
        });

        setLoading(true);
        checkSession();

        return () => subscription.unsubscribe();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Password must be at least 8 characters long.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            // Check if MFA is required for this session to update password
            const challengeNeeded = await checkMFAChallenge();
            if (challengeNeeded) {
                setLoading(false);
                return; // MFA UI will be shown by mfaChallengeRequired flag
            }

            const { error: updateError } = await supabase.auth.updateUser({
                password: password,
            });

            if (updateError) {
                if (updateError.message.includes('aal2')) {
                    // Force challenge if Supabase returns AAL2 error
                    const triggered = await checkMFAChallenge();
                    if (triggered) {
                        setLoading(false);
                        return;
                    }
                }
                throw updateError;
            }

            setSuccess(true);
            setTimeout(() => {
                navigate('/login');
            }, 3000);
        } catch (err: any) {
            logger.error('Password update error:', err);
            setError(err.message || 'Failed to update password. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleMFASubmit = async (e?: React.FormEvent, overrideCode?: string) => {
        if (e) e.preventDefault();
        const codeToVerify = overrideCode || mfaCode;
        if (!codeToVerify || codeToVerify.length !== 6) {
            setError('Please enter a valid 6-digit code.');
            return;
        }
        setError('');
        setMfaLoading(true);
        try {
            await verifyMFA(codeToVerify);
            // After successful MFA, the handleSubmit logic can be re-run or user can click again
            // but usually it's better to let them click "Update" again once they are AAL2.
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'MFA Verified',
                    message: 'Security clearance elevated. You can now finalize your password reset.',
                    type: 'success'
                }
            }));
        } catch (err: any) {
            logger.error('MFA Verification Error:', err);
            setError(err.message || 'Invalid verification code. Please try again.');
        } finally {
            setMfaLoading(false);
        }
    };

    return (
        <div className="login-page-wrapper">
            <div className="form-section" style={{ flex: '1', justifyContent: 'center' }}>
                <div className="login-container">
                    <div className="login-card card">
                        {mfaChallengeRequired ? (
                            <>
                                <div className="login-header">
                                    <div className="mfa-lock-icon">🔐</div>
                                    <h2 className="login-title">Two-Factor Auth</h2>
                                    <p className="login-subtitle">An AAL2 session is required. Please verify your identity.</p>
                                </div>
                                <div className="login-body">
                                    {error && (
                                        <div className="alert alert-danger flex items-start gap-2" role="alert">
                                            <FaTimesCircle className="mt-1 flex-shrink-0" />
                                            <span>{error}</span>
                                        </div>
                                    )}
                                    <form onSubmit={handleMFASubmit} className="login-form">
                                        <div className="form-group">
                                            <label htmlFor="mfa-code"><FaShieldAlt className="inline-icon" /> Verification Code</label>
                                            <input
                                                id="mfa-code"
                                                type="text"
                                                inputMode="numeric"
                                                pattern="[0-9]{6}"
                                                maxLength={6}
                                                value={mfaCode}
                                                onChange={(e) => {
                                                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                                    setMfaCode(val);
                                                    if (error) setError('');
                                                    if (val.length === 6 && !mfaLoading) {
                                                        handleMFASubmit(undefined, val);
                                                    }
                                                }}
                                                placeholder="000000"
                                                autoFocus
                                                required
                                                className="mfa-input-display"
                                            />
                                        </div>
                                        <button
                                            type="submit"
                                            className="btn btn-primary login-btn-submit"
                                            disabled={mfaLoading || mfaCode.length !== 6}
                                        >
                                            {mfaLoading ? <div className="loading-dots"><span></span><span></span><span></span></div> : 'Verify & Continue Reset'}
                                        </button>
                                    </form>
                                    <button
                                        type="button"
                                        className="btn btn-outline btn-block mt-3"
                                        onClick={() => { cancelMFAChallenge(); navigate('/login'); }}
                                    >
                                        ← Back to Login
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="login-header">
                                    <div className="recovery-icon-circle" style={{ 
                                        width: '64px', 
                                        height: '64px', 
                                        background: 'rgba(0, 212, 255, 0.1)', 
                                        borderRadius: '50%', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center',
                                        margin: '0 auto 1.5rem',
                                        color: '#00D4FF',
                                        fontSize: '1.5rem'
                                    }}>
                                        {success ? <FaCheckCircle style={{ color: '#10b981' }} /> : <FaShieldAlt />}
                                    </div>
                                    <h2 className="login-title" style={{ fontSize: '1.8rem' }}>
                                        {success ? 'Password Updated' : 'Secure Reset'}
                                    </h2>
                                    <p className="login-subtitle">
                                        {success 
                                            ? 'Your credentials have been re-synchronized. Redirecting to login...' 
                                            : 'Establish a new high-entropy password for your account.'}
                                    </p>
                                </div>

                                <div className="login-body">
                                    {error && (
                                        <div className="alert alert-danger mb-6 flex items-start gap-2" role="alert" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '1rem', borderRadius: '0.75rem' }}>
                                            <FaExclamationTriangle className="mt-1 flex-shrink-0" />
                                            <span>{error}</span>
                                        </div>
                                    )}

                                    {success ? (
                                        <div className="text-center py-4">
                                            <Link to="/login" className="btn btn-primary" style={{ width: '100%' }}>
                                                Return to Login Now
                                            </Link>
                                        </div>
                                    ) : (
                                        <form onSubmit={handleSubmit} className="login-form">
                                            <div className="form-group mb-4">
                                                <label htmlFor="password"><FaLock className="inline-icon" /> NEW PASSWORD</label>
                                                <PasswordInput
                                                    id="password"
                                                    value={password}
                                                    onChange={setPassword}
                                                    showStrength={true}
                                                    placeholder="Enter strong password"
                                                    autoComplete="new-password"
                                                />
                                            </div>
                                            <div className="form-group mb-8">
                                                <label htmlFor="confirm-password"><FaLock className="inline-icon" /> CONFIRM NEW PASSWORD</label>
                                                <input
                                                    id="confirm-password"
                                                    type="password"
                                                    value={confirmPassword}
                                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                                    placeholder="Repeat new password"
                                                    className="form-control"
                                                    autoComplete="new-password"
                                                    required
                                                />
                                            </div>

                                            <button
                                                type="submit"
                                                className="btn btn-primary"
                                                disabled={loading || !!error}
                                                style={{ 
                                                    width: '100%', 
                                                    height: '48px',
                                                    display: 'flex', 
                                                    justifyContent: 'center',
                                                    alignItems: 'center'
                                                }}
                                            >
                                                {loading ? (
                                                    <div className="loading-dots">
                                                        <span></span><span></span><span></span>
                                                    </div>
                                                ) : 'Update Password & Re-sync'}
                                            </button>
                                        </form>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
