import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { FaEnvelope, FaLock, FaShieldAlt, FaBriefcase, FaChartBar, FaSearch, FaUserShield, FaTimesCircle } from 'react-icons/fa';
import { PasswordInput } from '../components/PasswordInput';
import './Login.css';
import brandMark from '../assets/iotank-logo-v3.png';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const { signIn, error: contextError, systemUser } = useAuth();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');
        setIsLoading(true);
        try {
            await signIn(email, password);
            
            // We wait for systemUser to be set by the context
            // If it takes too long, we time out.
            setTimeout(() => {
                setIsLoading(false);
            }, 10000);

        } catch (err: any) {
            console.error("Login failed:", err);
            setLocalError(err.message || 'Invalid email or password.');
            setIsLoading(false);
        }
    };

    // Effect to handle navigation once profile is definitely ready
    React.useEffect(() => {
        if (systemUser && !contextError && isLoading) {
            navigate('/');
        }
    }, [systemUser, contextError, isLoading, navigate]);

    return (
        <div className="login-page-wrapper">
            <div className="branding-section">
                <div className="branding-content">
                    <img src={brandMark} alt="IoTank Logo" className="branding-logo" />
                    <h1 className="branding-title">Platform Governance Console</h1>
                    <p className="branding-description">Enterprise-grade oversight, client management, and system-wide security for the IoTank ecosystem.</p>
                    <div className="value-statements">
                        <div className="value-item item-1">
                            <div className="value-icon"><FaShieldAlt /></div>
                            <div className="value-number">01</div>
                            <strong>Global Security Monitoring</strong>
                            <span>Track system-wide signals and security anomalies across all organizations.</span>
                        </div>
                        <div className="value-item item-2">
                            <div className="value-icon"><FaBriefcase /></div>
                            <div className="value-number">02</div>
                            <strong>Automated Provisioning</strong>
                            <span>Deploy new client environments and hardware with verified compliance.</span>
                        </div>
                        <div className="value-item item-3">
                            <div className="value-icon"><FaChartBar /></div>
                            <div className="value-number">03</div>
                            <strong>Audit & Compliance</strong>
                            <span>Immutable logs provide a transparent history of all administrative actions.</span>
                        </div>
                        <div className="value-item item-4">
                            <div className="value-icon"><FaSearch /></div>
                            <div className="value-number">04</div>
                            <strong>Support Orchestration</strong>
                            <span>Centrally manage support tickets and platform reliability indicators.</span>
                        </div>
                        <div className="value-item item-5">
                            <div className="value-icon"><FaUserShield /></div>
                            <div className="value-number">05</div>
                            <strong>Role-Based Governance</strong>
                            <span>Enforce strict RBAC policies for administrative staff and platform helpers.</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="form-section">
                <div className="login-container">
                    <div className="login-card">
                        <div className="login-header">
                            <h2 className="login-title">System Clearance</h2>
                            <p className="login-subtitle">Sign in to the management console</p>
                        </div>
                        
                        <div className="login-body">
                            {(localError || contextError) && (
                                <div className="alert-premium-danger" role="alert">
                                    <div className="alert-icon-wrapper">
                                        <FaTimesCircle />
                                    </div>
                                    <div className="alert-content">
                                        <div className="alert-title">Access Denied</div>
                                        <div className="alert-message">{localError || contextError}</div>
                                    </div>
                                </div>
                            )}

                            <form onSubmit={handleLogin} className="login-form">
                                <div className="form-group">
                                    <label htmlFor="email"><FaEnvelope className="inline-icon" /> Administrator Email</label>
                                    <input 
                                        id="email" 
                                        type="email" 
                                        value={email} 
                                        onChange={(e) => setEmail(e.target.value)} 
                                        placeholder="admin@iotank.ai" 
                                        autoComplete="off"
                                        required 
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="password"><FaLock className="inline-icon" /> Secure Password</label>
                                    <PasswordInput 
                                        id="password" 
                                        value={password} 
                                        onChange={setPassword} 
                                        showStrength={false} 
                                        placeholder="Enter your security key" 
                                        autoComplete="off"
                                    />
                                </div>
                                <button 
                                    type="submit" 
                                    className="btn btn-primary" 
                                    disabled={isLoading}
                                    style={{ 
                                        minWidth: '220px', 
                                        height: '48px', 
                                        margin: '0 auto', 
                                        display: 'flex', 
                                        justifyContent: 'center',
                                        transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                                    }}
                                >
                                    {isLoading ? (
                                        <div className="loading-dots">
                                            <span></span><span></span><span></span>
                                        </div>
                                    ) : 'Authenticate'}
                                </button>
                                
                                <div className="login-status-disclaimer">
                                    Access is logged and strictly restricted to authorized personnel.
                                </div>
                            </form>
                            
                            <div className="login-footer">
                                <Link to="/forgot-password" line-height="1.4" className="text-link">Recovery options?</Link>
                            </div>
                        </div>
                    </div>
                </div>
                
                <footer className="login-page-footer">
                    <p>© 2026 IoTank Governance Hub. All rights reserved.</p>
                </footer>
            </div>
        </div>
    );
};

export default Login;
