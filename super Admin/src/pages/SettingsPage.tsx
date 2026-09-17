import React, { useState, useEffect } from 'react';

import { useAuth } from '../hooks/useAuth';
import { supabase } from '../config/supabase';
import { systemUsersService } from '../services/systemUsersService';
import { 
    MdPerson, MdEmail, MdPhone, MdSave, 
    MdPhotoCamera, MdSecurity, MdHistory, 
    MdFingerprint 
} from 'react-icons/md';
import { 
    FiShield, FiUser, FiActivity, FiLock, 
    FiChevronRight, FiCheck, FiDownload, FiClock,
    FiSmartphone, FiKey
} from 'react-icons/fi';
import Layout from '../components/Layout';
import { ApiKeyManager } from '../components/Settings/ApiKeyManager';
import './SettingsPage.css';

const SettingsPage: React.FC = () => {
    const { systemUser, verifySettingsPassword } = useAuth();
    const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'activity' | 'api'>('profile');
    const [isSaving, setIsSaving] = useState(false);
    const [fullName, setFullName] = useState(systemUser?.full_name || '');
    const [phone, setPhone] = useState((systemUser as any)?.phone || '');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [activityLogs, setActivityLogs] = useState<any[]>([]);
    const [loadingActivity, setLoadingActivity] = useState(false);

    useEffect(() => {
        if (systemUser?.full_name) setFullName(systemUser.full_name);
        if ((systemUser as any)?.phone) setPhone((systemUser as any).phone);
    }, [systemUser]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!systemUser?.id) return;
        setIsSaving(true);
        try {
            await systemUsersService.updateSystemUser(systemUser.id, {
                full_name: fullName,
                phone: phone
            } as any);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Profile Updated',
                    message: 'Platform identity and credentials have been synchronized successfully.',
                    type: 'success'
                }
            }));
        } catch (error) {
            console.error('Error updating profile:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Update Failed',
                    message: 'Failed to synchronize profile changes with the administrative directory.',
                    type: 'error'
                }
            }));
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'activity' && systemUser?.auth_user_id) {
            const fetchLogs = async () => {
                setLoadingActivity(true);
                const { data, error } = await supabase
                    .from('unified_events')
                    .select('*')
                    .eq('metadata->>actor_uid', systemUser.auth_user_id)
                    .order('created_at', { ascending: false })
                    .limit(20);
                
                if (!error) setActivityLogs(data || []);
                setLoadingActivity(false);
            };
            fetchLogs();
        }
    }, [activeTab, systemUser?.auth_user_id]);

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setAvatarUrl(URL.createObjectURL(file));
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentPassword || !newPassword) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Incomplete Fields',
                    message: 'Current and new password are required.',
                    type: 'error'
                }
            }));
            return;
        }
        if (newPassword !== confirmPassword) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Password Mismatch',
                    message: 'New password and confirmation do not match.',
                    type: 'error'
                }
            }));
            return;
        }
        setIsChangingPassword(true);
        try {
            await verifySettingsPassword(currentPassword);
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw error;
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Password Updated',
                    message: 'Your platform access key has been rotated successfully.',
                    type: 'success'
                }
            }));
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setShowPasswordForm(false);
        } catch (error) {
            console.error('Error updating password:', error);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Password Update Failed',
                    message: 'Failed to rotate platform access key. Verify your current password.',
                    type: 'error'
                }
            }));
        } finally {
            setIsChangingPassword(false);
        }
    };

    const handleTerminateSessions = () => {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Security Command',
                message: 'Are you sure you want to terminate all other active administrative sessions for this node?',
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Abort',
                        onClick: () => {}
                    },
                    {
                        label: 'Terminate Sessions',
                        primary: true,
                        onClick: () => {
                            supabase.auth.signOut().then(() => {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Sessions Invalidated',
                                        message: 'All sessions invalidated — sign in again',
                                        type: 'success'
                                    }
                                }));
                                setTimeout(() => {
                                    window.location.href = '/login';
                                }, 1000);
                            });
                        }
                    }
                ]
            }
        }));
    };


    return (
        <Layout>
            <div className="settings-container animate-fade-in">
                <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">system settings</h1>
                        <div className="dp-subtitle">Control & Governance Console for Administrative Nodes</div>
                    </div>
                </header>

                <div className="settings-layout">
                    {/* Unified Navigation */}
                    <aside className="settings-nav">
                        <div className="nav-cluster">
                            <div className="cluster-header">Personal Node</div>
                            <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
                                <FiUser /> Profile Identity
                            </button>
                        </div>

                        <div className="nav-cluster">
                            <div className="cluster-header">Protection Layers</div>
                            <button className={`nav-item ${activeTab === 'security' ? 'active' : ''}`} onClick={() => setActiveTab('security')}>
                                <FiShield /> Access Security
                            </button>
                        </div>

                        <div className="nav-cluster">
                            <div className="cluster-header">Audit Trace</div>
                            <button className={`nav-item ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
                                <FiActivity /> Node Activity
                            </button>
                        </div>

                        <div className="nav-cluster">
                            <div className="cluster-header">Financial Gateway</div>
                            <button className={`nav-item ${activeTab === 'api' ? 'active' : ''}`} onClick={() => setActiveTab('api')}>
                                <FiKey /> API Configuration
                            </button>
                        </div>
                    </aside>

                    {/* Content Matrix */}
                    <main className="settings-main">
                        {activeTab === 'profile' && (
                            <div className="settings-section">
                                <h2 className="section-title">Profile Identity</h2>
                                <p className="section-desc">Manage your professional credentials and node identity on the platform.</p>

                                <div className="photo-edit-container">
                                    <div className="settings-avatar-wrapper">
                                        <div className="settings-avatar">
                                            {avatarUrl ? (
                                                <img
                                                    src={avatarUrl}
                                                    alt="avatar"
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px' }}
                                                />
                                            ) : (
                                                <FiUser />
                                            )}
                                        </div>
                                        <label htmlFor="avatar-upload" className="upload-button-pill">
                                            <MdPhotoCamera size={12} />
                                        </label>
                                        <input
                                            id="avatar-upload"
                                            type="file"
                                            accept="image/png,image/jpeg"
                                            style={{ display: 'none' }}
                                            onChange={handleAvatarChange}
                                        />
                                    </div>
                                    <div className="photo-info">
                                        <h4 className="font-black text-slate-800 tracking-tight">System Node Avatar</h4>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Industrial PNG/JPG permitted</p>
                                    </div>
                                </div>

                                <form onSubmit={handleSave} className="space-y-8">
                                    <div className="form-grid">
                                        <div className="form-group-premium">
                                            <label>Full Authority Name</label>
                                            <input 
                                                type="text" 
                                                value={fullName}
                                                onChange={(e) => setFullName(e.target.value)}
                                                className="input-premium-v2"
                                                placeholder="Authority Name"
                                            />
                                        </div>
                                        <div className="form-group-premium">
                                            <label>Contact Telemetry</label>
                                            <input 
                                                type="text" 
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                className="input-premium-v2"
                                                placeholder="+254 XXX XXX XXX"
                                            />
                                        </div>
                                        <div className="form-group-premium col-span-2">
                                            <label>Immutable Node Email</label>
                                            <input 
                                                type="email" 
                                                value={systemUser?.email || ''}
                                                disabled
                                                className="input-premium-v2"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-8 border-t border-slate-100">
                                        <button 
                                            type="submit" 
                                            disabled={isSaving}
                                            className="px-8 py-3 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {isSaving ? 'Synchronizing...' : 'Commit Changes'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}

                        {activeTab === 'security' && (
                            <div className="settings-section">
                                <h2 className="section-title">Access Security</h2>
                                <p className="section-desc">Manage your authentication layers and secure your administrative session.</p>

                                <div className="space-y-4 mt-8">
                                    <div className="settings-utility-card">
                                        <div className="flex items-center gap-4">
                                            <div className="utility-icon-box"><FiLock /></div>
                                            <div>
                                                <h4 className="font-black text-sm text-slate-800 tracking-tight lowercase">password credentials</h4>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Update your platform access key</p>
                                            </div>
                                        </div>
                                        <button className="px-4 py-2 border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all" onClick={() => setShowPasswordForm(prev => !prev)}>
                                            {showPasswordForm ? 'Cancel' : 'Modify'}
                                        </button>
                                    </div>

                                    {showPasswordForm && (
                                        <form onSubmit={handleChangePassword} className="flex flex-wrap gap-4 items-end mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                                            <div className="form-group-premium flex-1 min-w-[180px]">
                                                <label>Current Password</label>
                                                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input-premium-v2" />
                                            </div>
                                            <div className="form-group-premium flex-1 min-w-[180px]">
                                                <label>New Password</label>
                                                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input-premium-v2" />
                                            </div>
                                            <div className="form-group-premium flex-1 min-w-[180px]">
                                                <label>Confirm New Password</label>
                                                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input-premium-v2" />
                                            </div>
                                            <button type="submit" disabled={isChangingPassword} className="px-6 py-2.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest rounded-lg shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50">
                                                {isChangingPassword ? 'Rotating...' : 'Update Password'}
                                            </button>
                                        </form>
                                    )}

                                    <div className="settings-utility-card">
                                        <div className="flex items-center gap-4">
                                            <div className="utility-icon-box"><FiSmartphone /></div>
                                            <div>
                                                <h4 className="font-black text-sm text-slate-800 tracking-tight lowercase">two-factor authentication</h4>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secondary identity verification level</p>
                                            </div>
                                        </div>
                                        <span className="px-3 py-1 bg-slate-100 text-slate-400 font-black text-[9px] uppercase tracking-widest rounded-md">Disabled</span>
                                    </div>

                                    <div className="settings-utility-card">
                                        <div className="flex items-center gap-4">
                                            <div className="utility-icon-box" style={{ background: '#fef3c7', color: '#d97706' }}><FiKey /></div>
                                            <div>
                                                <h4 className="font-black text-sm text-slate-800 tracking-tight lowercase">session management</h4>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active nodes currently linked to your ID</p>
                                            </div>
                                        </div>
                                        <button 
                                            className="px-4 py-2 border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
                                            onClick={handleTerminateSessions}
                                        >
                                            Terminate Others
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'activity' && (
                            <div className="settings-section">
                                <h2 className="section-title">Node Activity Trace</h2>
                                <p className="section-desc">Review your recent administrative actions and login history.</p>

                                {loadingActivity ? (
                                    <div className="py-20 text-center opacity-40 text-[10px] font-black uppercase tracking-[0.3em]"><FiClock className="mx-auto mb-4 animate-spin" /> Synchronizing Trace...</div>
                                ) : activityLogs.length === 0 ? (
                                    <div className="activity-empty-state mt-8">
                                        <FiClock size={32} className="mx-auto mb-4 opacity-20" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">No verified activity trace records found.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3 mt-8">
                                        {activityLogs.map((log, i) => (
                                            <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center group hover:bg-white hover:shadow-md transition-all">
                                                <div className="flex items-center gap-4">
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${log.severity === 'CRITICAL' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                                                        {log.severity === 'CRITICAL' ? <FiShield /> : <FiActivity />}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-xs text-slate-800 lowercase">{log.description}</p>
                                                        <p className="text-[9px] font-black uppercase opacity-30 mt-1">{new Date(log.created_at).toLocaleString()} • {log.event_type}</p>
                                                    </div>
                                                </div>
                                                <FiChevronRight className="opacity-20 group-hover:opacity-100 transition-all" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {activeTab === 'api' && (
                            <div className="settings-section">
                                <ApiKeyManager />
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </Layout>
    );
};

export default SettingsPage;

