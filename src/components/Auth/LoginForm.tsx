import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FaGoogle, FaTimesCircle, FaEnvelope, FaLock, FaShieldAlt, FaDollarSign, FaChartBar, FaSearch, FaCog } from 'react-icons/fa';
import { PasswordInput } from './PasswordInput';
import './LoginForm.css';
import TermsModal from '../Landing/TermsModal';
import '../Landing/TermsModal.css';
import { OnboardingModal } from './OnboardingModal';
import { RegistrationRequestForm } from './RegistrationRequestForm';

import { supabase } from '@/config/supabase';
import { getAuthFriendlyErrorMessage } from '@/utils/authErrors';
import brandMark from '@/assets/iotank-official-logo.png';
import { logger } from '@/utils/logger';




export const LoginForm: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [rateLimitError, setRateLimitError] = useState('');
    const [remainingAttempts, setRemainingAttempts] = useState(0);

    const { signIn, signInWithGoogle, currentUser, mfaChallengeRequired, mfaFailures, verifyMFA, cancelMFAChallenge, signOut, verifySecurityPin, resetMfaFailures } = useAuth();
    const navigate = useNavigate();
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [isTermsOpen, setIsTermsOpen] = useState(false);
    const [showRegRequest, setShowRegRequest] = useState(false);
    const [mfaCode, setMfaCode] = useState('');
    const [mfaLoading, setMfaLoading] = useState(false);
    const [shouldShake, setShouldShake] = useState(false);
    const [pinCode, setPinCode] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    const [visiblePinIndices, setVisiblePinIndices] = useState<number[]>([]);

    // Disable auto-redirect to prevent "instant login" mystery.
    // We now show an "Active Session" state in the UI instead.
    useEffect(() => {
        if (currentUser?.stationId && !mfaChallengeRequired) {
            navigate('/dashboard', { replace: true });
        }
    }, [currentUser, mfaChallengeRequired, navigate]);






    const processSignIn = async () => {
        try {
            await signIn(email, password);
            // Note: The AuthContext listener will set global 'loading' to true,
            // preventing the useEffect from navigating. Once the listener sets
            // mfaChallengeRequired to true and loading to false, the UI will 
            // naturally swap to the MFA form.
        } catch (err: any) {
            logger.error('Auth Error:', err);
            
            const friendlyMsg = getAuthFriendlyErrorMessage(err);
            setError(friendlyMsg);
            setShouldShake(true);
            setTimeout(() => setShouldShake(false), 600);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setRateLimitError('');
        const identifier = email.toLowerCase().trim();

        setLoading(true);

        try {
            // Check rate limit on server
            const { data: limitData, error: limitErr } = await supabase.rpc('check_auth_attempt', { p_email: identifier });
            
            if (limitErr) throw limitErr;

            const limit = Array.isArray(limitData) ? limitData[0] : limitData;

            if (limit && !limit.allowed) {
                const resetDate = new Date(limit.reset_time);
                const minutes = Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60));
                setRateLimitError(`Too many failed attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
                setRemainingAttempts(0);
                setLoading(false);
                return;
            }

            setRemainingAttempts(limit?.remaining_attempts || 0);
            await processSignIn();
        } catch (err) {
            logger.error('Rate limit check failed:', err);
            // Fallback: allow attempt if RPC fails (don't lock out users due to infra issues)
            await processSignIn();
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
            // Navigation is safely handled by the reactive useEffect hook once currentUser is enriched.
        } catch (err: any) {
            logger.error('MFA Verification Error:', err);
            setError(err.message || 'Invalid verification code. Please try again.');
            setShouldShake(true);
            setTimeout(() => setShouldShake(false), 600);
        } finally {
            setMfaLoading(false);
        }
    };

    const handlePinSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (pinCode.length !== 6) return;
        setPinLoading(true);
        setError('');
        try {
            const success = await verifySecurityPin(pinCode);
            if (success) {
                // Security verification passed, proceed to dashboard
                // verifySecurityPin in AuthContext already escalates if successful
                navigate('/dashboard');
            } else {
                setError('Invalid Security PIN.');
                setShouldShake(true);
                setTimeout(() => setShouldShake(false), 600);
            }
        } catch (err: any) {
            setError(err.message || 'Verification failed.');
        } finally {
            setPinLoading(false);
        }
    };


    const handleTermsAccepted = () => {
        setIsTermsOpen(false);
        setShowRegRequest(true);
    };

    const initiateSignUp = () => {
        setIsTermsOpen(true);
    };


    const handleGoogleSignIn = async () => {
        setError('');
        setRateLimitError('');
        setLoading(true);
        try {
            // signInWithGoogle() triggers a browser redirect to Google.
            // The browser navigates away — no code runs after this line.
            // When Google returns, the OAuth callback lands back at the app
            // and the useEffect above handles navigation to /dashboard.
            await signInWithGoogle();
        } catch (err: any) {
            logger.error("Google Auth Error:", err);
            setError(getAuthFriendlyErrorMessage(err));
            setLoading(false);
        }
    };

    return (
        <div className="login-page-wrapper">
            <div className="branding-section">
                <div className="branding-content">
                    <img src={brandMark} alt="IoTank Logo" className="branding-logo" />
                    <h1 className="branding-title">Advanced Fuel Intelligence</h1>
                    <p className="branding-description">Enterprise-grade monitoring, analytics, and governance for your fuel assets.</p>
                    <div className="value-statements">
                        <div className="value-item item-1">
                            <div className="value-icon"><FaShieldAlt /></div>
                            <div className="value-number">01</div>
                            <strong>Total Asset Security</strong>
                            <span>Real-time theft detection and leak alerts protect your inventory 24/7.</span>
                        </div>
                        <div className="value-item item-2">
                            <div className="value-icon"><FaDollarSign /></div>
                            <div className="value-number">02</div>
                            <strong>Financial Clarity</strong>
                            <span>See the exact dollar value of your fuel with live market pricing.</span>
                        </div>
                        <div className="value-item item-3">
                            <div className="value-icon"><FaChartBar /></div>
                            <div className="value-number">03</div>
                            <strong>Pinpoint Accuracy</strong>
                            <span>Physics-based corrections deliver precise volume readings you can trust.</span>
                        </div>
                        <div className="value-item item-4">
                            <div className="value-icon"><FaSearch /></div>
                            <div className="value-number">04</div>
                            <strong>AI-Powered Insights</strong>
                            <span>Smart procurement advice tells you exactly when to refill for maximum savings.</span>
                        </div>
                        <div className="value-item item-5">
                            <div className="value-icon"><FaCog /></div>
                            <div className="value-number">05</div>
                            <strong>Instant Alerts</strong>
                            <span>Get notified the moment something unusual happens—day or night.</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="form-section">
                <div className="login-container">
                    <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} onComplete={handleTermsAccepted} />

                    {currentUser && <OnboardingModal isOpen={showOnboarding} user={currentUser} onComplete={() => { setShowOnboarding(false); navigate('/dashboard'); }} />}
                    {showRegRequest && (
                        <RegistrationRequestForm onBack={() => setShowRegRequest(false)} />
                    )}

                    <div className={`login-card card ${showOnboarding || showRegRequest ? 'hidden' : ''} ${shouldShake ? 'shake' : ''}`}>

                        {currentUser && !mfaChallengeRequired ? (
                            <div className="active-session-card animate-in fade-in zoom-in-95 duration-400">
                                <div className="login-header">
                                    <div className="avatar-preview mb-4">
                                        {currentUser.photoURL ? (
                                            <img src={currentUser.photoURL} alt="Profile" className="w-16 h-16 rounded-full border-4 border-blue-500/20 shadow-lg mx-auto" />
                                        ) : (
                                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto shadow-lg text-white font-black text-xl">
                                                {currentUser.displayName?.charAt(0) || currentUser.email.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                    <h2 className="login-title">Active Session Detected</h2>
                                    <p className="login-subtitle">You are already identified as <span className="text-blue-500 font-bold">{currentUser.displayName || currentUser.email}</span></p>
                                </div>
                                <div className="login-body flex flex-col gap-3">
                                    <button 
                                        className="btn btn-primary login-btn-submit h-[56px] text-[13px]"
                                        onClick={() => navigate('/dashboard')}
                                    >
                                        Go to Dashboard
                                    </button>
                                    <button 
                                        className="btn btn-outline h-[56px] text-[13px] border-slate-200 hover:bg-slate-50"
                                        onClick={() => signOut()}
                                    >
                                        Sign out to switch account
                                    </button>
                                </div>
                            </div>
                        ) : mfaChallengeRequired ? (
                            <>
                                <div className="login-header">
                                    <div className="mfa-lock-icon">🔐</div>
                                    <h2 className="login-title">{mfaFailures >= 3 && currentUser?.securityPinEnabled ? 'PIN Verification' : 'Two-Factor Auth'}</h2>
                                    <p className="login-subtitle">
                                        {mfaFailures >= 3 && currentUser?.securityPinEnabled 
                                            ? 'MFA limit reached. Please verify your 6-digit Security PIN.' 
                                            : 'Open your authenticator app and enter the 6-digit code'}
                                    </p>
                                </div>
                                <div className="login-body">
                                    {error && (
                                        <div className="alert alert-danger flex items-start gap-2" role="alert">
                                            <FaTimesCircle className="mt-1 flex-shrink-0" />
                                            <span>{error}</span>
                                        </div>
                                    )}
                                    {mfaFailures >= 3 && currentUser?.securityPinEnabled ? (
                                        <form onSubmit={handlePinSubmit} className="login-form">
                                            <div className="form-group">
                                                <label><FaShieldAlt className="inline-icon" /> Security PIN</label>
                                                <div className="flex justify-center gap-2 mb-6">
                                                    {[...Array(6)].map((_, i) => (
                                                        <input
                                                            key={`pin-login-${i}`}
                                                            id={`pin-login-input-${i}`}
                                                            type={visiblePinIndices.includes(i) ? "text" : "password"}
                                                            maxLength={1}
                                                            className="w-10 h-12 bg-slate-100 border-2 border-slate-200 rounded-lg text-center text-xl font-bold focus:border-blue-500 focus:bg-white outline-none transition-all"
                                                            value={pinCode[i] || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value.replace(/\D/g, '');
                                                                if (!val && e.target.value) return;
                                                                const newPin = pinCode.split('');
                                                                newPin[i] = val;
                                                                const finalPin = newPin.join('').slice(0, 6);
                                                                setPinCode(finalPin);
                                                                if (val) {
                                                                    setVisiblePinIndices(prev => [...prev, i]);
                                                                    setTimeout(() => {
                                                                        setVisiblePinIndices(prev => prev.filter(idx => idx !== i));
                                                                    }, 1000);
                                                                    if (i < 5) {
                                                                        document.getElementById(`pin-login-input-${i + 1}`)?.focus();
                                                                    }
                                                                }
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Backspace' && !pinCode[i] && i > 0) {
                                                                    document.getElementById(`pin-login-input-${i - 1}`)?.focus();
                                                                }
                                                            }}
                                                            autoFocus={i === 0}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                            <button
                                                type="submit"
                                                className="btn btn-primary login-btn-submit"
                                                disabled={pinLoading || pinCode.length !== 6}
                                            >
                                                {pinLoading ? <div className="loading-dots"><span></span><span></span><span></span></div> : 'Verify PIN'}
                                            </button>
                                        </form>
                                    ) : (
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
                                                {mfaLoading ? <div className="loading-dots"><span></span><span></span><span></span></div> : 'Verify & Sign In'}
                                            </button>
                                        </form>
                                    )}
                                    <button
                                        type="button"
                                        className="btn btn-outline btn-block mt-3"
                                        onClick={() => { cancelMFAChallenge(); resetMfaFailures(); setError(''); setMfaCode(''); setPinCode(''); }}
                                    >
                                        ← Back to Login
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="login-header">
                                    <h2 className="login-title">Welcome Back</h2>
                                    <p className="login-subtitle">Sign in to your dashboard</p>
                                </div>
                                <div className="login-body">
                                    {rateLimitError && (
                                        <div className="alert alert-danger flex items-start gap-2" role="alert">
                                            <FaTimesCircle className="mt-1 flex-shrink-0" />
                                            <div>
                                                <span>{rateLimitError}</span>
                                                {remainingAttempts > 0 && <div className="text-sm mt-1 opacity-75">{remainingAttempts} attempt{remainingAttempts > 1 ? 's' : ''} remaining</div>}
                                            </div>
                                        </div>
                                    )}
                                    {error && (
                                        <div className="alert alert-danger flex items-start gap-2" role="alert">
                                            <FaTimesCircle className="mt-1 flex-shrink-0" />
                                            <span>{error}</span>
                                        </div>
                                    )}
                                    <form onSubmit={handleSubmit} className="login-form">
                                        <div className="hidden-honey-pot" aria-hidden="true">
                                            <input type="text" name="username_fake" tabIndex={-1} autoComplete="off" />
                                            <input type="password" name="password_fake" tabIndex={-1} autoComplete="off" />
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="email"><FaEnvelope className="inline-icon" /> Email Address</label>
                                            <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required aria-required="true" autoComplete="new-password" />
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="password"><FaLock className="inline-icon" /> Password</label>
                                            <PasswordInput id="password" name="password" value={password} onChange={setPassword} showStrength={false} placeholder="Enter your password" autoComplete="new-password" />
                                        </div>

                                        <div className="form-group-utility flex items-center justify-between mb-8 mt-2 px-1">
                                            <label className="remember-me-toggle flex items-center gap-3 cursor-pointer group">
                                                <div className="checkbox-custom-wrapper relative flex items-center">
                                                    <input 
                                                        type="checkbox" 
                                                        defaultChecked 
                                                        className="peer appearance-none w-5 h-5 rounded-md border-2 border-slate-200/50 bg-white/10 checked:bg-indigo-600 checked:border-indigo-600 transition-all duration-200 cursor-pointer"
                                                    />
                                                    <svg className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 pointer-events-none left-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </div>
                                                <span className="text-[11px] font-black text-slate-500 group-hover:text-indigo-600 transition-colors uppercase tracking-widest select-none">Stay Signed In</span>
                                            </label>
                                            <Link to="/forgot-password" title="Recover account access" className="forgot-password-action-link flex items-center gap-2 text-[10px] font-black text-slate-600 uppercase tracking-[0.15em] py-2 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 hover:text-indigo-600 active:scale-95 transition-all shadow-sm border border-slate-200">
                                                <FaLock className="text-[11px] opacity-60" />
                                                Forgot Password?
                                            </Link>
                                        </div>

                                        <button
                                            type="submit"
                                            className="btn btn-primary login-btn-submit-animated"
                                            disabled={loading}
                                        >
                                            {loading ? <div className="loading-dots"><span></span><span></span><span></span></div> : 'Sign In'}
                                        </button>
                                    </form>
                                    <button onClick={handleGoogleSignIn} className="btn btn-secondary btn-block mt-4" disabled={loading}><FaGoogle /> Continue with Google</button>
                                </div>
                            </>
                        )}
                    </div>

                    <div className={`registration-promo-card card ${showOnboarding || showRegRequest ? 'hidden' : ''}`}>
                        <div className="promo-icon">
                            <FaShieldAlt />
                        </div>
                        <div className="promo-body">
                            <h3>new station?</h3>
                            <p>complete technical configuration to initialize your enterprise account</p>
                        </div>
                        <button type="button" className="promo-action-btn" onClick={initiateSignUp}>
                            request platform access
                        </button>
                    </div>
                    <footer className="login-page-footer">
                        <p className="text-sm text-secondary">© 2026 IoTank. All rights reserved.</p>
                        <p className="recaptcha-disclosure">
                            This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy">Privacy Policy</a> and <a href="https://policies.google.com/terms">Terms of Service</a> apply.
                        </p>
                    </footer>
                </div>
            </div>
        </div>
    );
};

export default LoginForm;
