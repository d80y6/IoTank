import React, { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../config/supabase';
import { systemUsersService, SystemUser } from '../services/systemUsersService';
import {
    FiUserPlus, FiShield, FiLoader, FiActivity,
    FiCheck, FiX, FiTrash2, FiToggleRight, FiToggleLeft,
    FiInfo, FiSend, FiUsers, FiLock, FiCalendar, FiClock,
    FiUser, FiMoreVertical, FiExternalLink, FiDownload
} from 'react-icons/fi';
import './SystemUsers.css';

const ROLE_LABELS: Record<string, string> = {
    super_admin: 'Super Admin (Level 1)',
    admin_helper: 'Super Admin Helper (Level 2)',
    support_staff: 'Support Staff (Level 3)',
    analyst: 'Analysts (Accountants, Auditors - Level 4)',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
    super_admin: 'Full system access, including billing and user management.',
    admin_helper: 'Administrative support with limited billing access.',
    support_staff: 'Day-to-day operations, support tickets, and monitoring.',
    analyst: 'Read-only access for auditing, reports, and accounting.',
};

const SystemUsers: React.FC<{ isHubView?: boolean }> = ({ isHubView }) => {
    const { systemUser: currentAdmin } = useAuth();
    const [users, setUsers] = useState<SystemUser[]>([]);
    const [recentActivity, setRecentActivity] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [creating, setCreating] = useState(false);
    const [showBootstrapPanel, setShowBootstrapPanel] = useState(false);
    const [bootstrapping, setBootstrapping] = useState(false);

    // New system user form
    const [newEmail, setNewEmail] = useState('');
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState<SystemUser['role']>('support_staff');

    // Bootstrap form
    const [bootstrapEmail, setBootstrapEmail] = useState('');
    const [bootstrapName, setBootstrapName] = useState('');
    const [bootstrapUid, setBootstrapUid] = useState('');
    const [bootstrapAuditTrail, setBootstrapAuditTrail] = useState<Array<{
        timestamp: string;
        actor: string;
        targetEmail: string;
    }>>([]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const systemUsers = await systemUsersService.getAllSystemUsers();
            setUsers(systemUsers || []);
            
            const { data: activityRows } = await supabase
                .from('admin_logs')
                .select('id, description, created_at, action_type')
                .order('created_at', { ascending: false })
                .limit(5);

            setRecentActivity(activityRows || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            await systemUsersService.inviteSystemUser({
                email: newEmail,
                full_name: newName,
                role: newRole,
                portal_link: window.location.origin + '/reset-password',
            });
            setIsAdding(false);
            setNewEmail('');
            setNewName('');
            fetchData();
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Invitation Dispatched',
                    message: `Security credentials for ${newName} have been sent.`,
                    type: 'success'
                }
            }));
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Provisioning Error',
                    message: err.message || 'Failed to communicate with service.',
                    type: 'error'
                }
            }));
        } finally {
            setCreating(false);
        }
    };

    const toggleActive = async (user: SystemUser) => {
        if (user.id === currentAdmin?.id) return;
        try {
            await systemUsersService.updateSystemUser(user.id, { is_active: !user.is_active });
            fetchData();
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Status Updated',
                    message: `Access for ${user.email} is now ${!user.is_active ? 'Active' : 'Suspended'}.`,
                    type: 'info'
                }
            }));
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Update Failed',
                    message: err.message,
                    type: 'error'
                }
            }));
        }
    };

    const handleDeleteUser = async (user: SystemUser) => {
        if (user.id === currentAdmin?.id) return;
        
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Purge',
                message: `Are you sure you want to permanently remove access for ${user.email}? This action is irreversible.`,
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Cancel',
                        onClick: () => {}
                    },
                    {
                        label: 'Purge Worker',
                        primary: true,
                        onClick: async () => {
                            try {
                                await systemUsersService.deleteSystemUser(user.id);
                                fetchData();
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Worker Purged',
                                        message: 'The administrative node has been removed from the directory.',
                                        type: 'success'
                                    }
                                }));
                            } catch (err: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Purge Failed',
                                        message: err.message,
                                        type: 'error'
                                    }
                                }));
                            }
                        }
                    }
                ]
            }
        }));
    };

    const handleBootstrap = async (e: React.FormEvent) => {
        e.preventDefault();
        setBootstrapping(true);
        try {
            await systemUsersService.bootstrapSuperAdmin({ 
                email: bootstrapEmail.trim().toLowerCase(), 
                full_name: bootstrapName.trim(), 
                auth_user_id: bootstrapUid.trim() 
            });
            await fetchData();
            setShowBootstrapPanel(false);
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Bootstrap Failed',
                    message: err.message,
                    type: 'error'
                }
            }));
        } finally {
            setBootstrapping(false);
        }
    };

    const content = (
        <div className="system-users-page animate-in fade-in duration-500">
            <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">user management</h1>
                        <div className="dp-subtitle">Strategic Platform Governance & Administrative Directory</div>
                    </div>
                    
                    <div className="dp-header-actions">
                         <button 
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all"
                            onClick={() => setShowBootstrapPanel(true)}
                        >
                            <FiLock /> Bootstrap Engine
                        </button>
                        <button 
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                            onClick={() => setIsAdding(true)}
                        >
                            <FiUserPlus /> Invite console staff
                        </button>
                    </div>
                </header>

                <div className="dp-stats-grid">
                    <div className="dp-premium-stat-card">
                        <div className="stat-content">
                            <label>Console Team</label>
                            <h3>{users.length}</h3>
                            <div className="stat-trend">Total directory size</div>
                        </div>
                    </div>
                    <div className="dp-premium-stat-card">
                        <div className="stat-content">
                            <label>Active nodes</label>
                            <h3 className="text-emerald-600">{users.filter(u => u.is_active).length}</h3>
                            <div className="stat-trend up">Authorized workers</div>
                        </div>
                    </div>
                    <div className="dp-premium-stat-card">
                         <div className="stat-content">
                            <label>Super Admins</label>
                            <h3>{users.filter(u => u.role === 'super_admin').length}</h3>
                            <div className="stat-trend">Level 1 access</div>
                        </div>
                    </div>
                    <div className="dp-premium-stat-card">
                        <div className="stat-content">
                            <label>System helpers</label>
                            <h3>{users.filter(u => u.role !== 'super_admin').length}</h3>
                            <div className="stat-trend">Operational staff</div>
                        </div>
                    </div>
                </div>

                <div className="tdv-transaction-table-container">
                    <table className="tdv-transaction-table">
                        <thead>
                            <tr>
                                <th>Worker Identity</th>
                                <th>Email / Directory</th>
                                <th>Access Role</th>
                                <th>Joined</th>
                                <th>Last Pulse</th>
                                <th>Status</th>
                                <th className="text-right">Command</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={7} className="p-20 text-center opacity-40">Synchronizing Administrative Directory...</td></tr>
                            ) : users.length === 0 ? (
                                <tr><td colSpan={7} className="p-20 text-center opacity-40">No administrative nodes found in directory.</td></tr>
                            ) : (
                                users.map((user) => (
                                    <tr key={user.id}>
                                        <td>
                                            <div className="worker-identity-cell">
                                                <div className="avatar-token">
                                                    {(user.full_name || '?').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm tracking-tight">{user.full_name || 'Anonymous Operator'}</div>
                                                    <div className="text-[9px] opacity-40 font-black uppercase tracking-widest">ID: #{user.id.slice(0, 8)}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="font-bold text-slate-500 text-xs lowercase">{user.email}</td>
                                        <td>
                                            <span className="role-badge">{ROLE_LABELS[user.role] || user.role}</span>
                                        </td>
                                        <td className="text-xs font-bold text-slate-400">
                                            {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                                        </td>
                                        <td className="text-xs font-bold text-slate-600">
                                            {user.last_login ? new Date(user.last_login).toLocaleString([], { hour: '2-digit', minute: '2-digit' }) : 'NEVER'}
                                        </td>
                                        <td>
                                            <span className={`su-status-badge ${user.is_active ? 'su-active' : 'su-suspended'}`}>
                                                {user.is_active ? 'Active' : 'Suspended'}
                                            </span>
                                        </td>
                                        <td className="text-right">
                                            <div className="flex justify-end gap-2 pr-2">
                                                {user.id !== currentAdmin?.id && (
                                                    <>
                                                        <button 
                                                            className="action-circle view" 
                                                            onClick={() => toggleActive(user)}
                                                            title={user.is_active ? "Suspend Access" : "Reactivate Access"}
                                                        >
                                                            {user.is_active ? <FiToggleRight className="text-emerald-500" /> : <FiToggleLeft className="text-slate-300" />}
                                                        </button>
                                                        <button 
                                                            className="action-circle delete" 
                                                            onClick={() => handleDeleteUser(user)}
                                                            title="Purge Worker"
                                                        >
                                                            <FiTrash2 size={16}/>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Secondary Activity Audit */}
                <div className="mt-12 bg-slate-50 border border-slate-100 rounded-3xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <FiActivity className="text-blue-600" />
                        <h3 className="text-lg font-black lowercase tracking-tighter">recent console activity</h3>
                    </div>
                    <div className="space-y-4">
                        {recentActivity.map(event => (
                            <div key={event.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                     <span className="text-[10px] font-black uppercase text-slate-300 tracking-widest">{event.action_type || 'SYSTEM'}</span>
                                     <span className="text-sm font-bold text-slate-700">{event.description}</span>
                                </div>
                                <span className="text-[10px] font-mono opacity-40">{new Date(event.created_at).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Modals */}
                {isAdding && (
                    <div className="modal-overlay-premium">
                        <form className="modal-content-premium animate-fade-in" onSubmit={handleCreate}>
                            <div className="modal-header-section">
                                <div className="modal-header-icon-container"><FiUserPlus /></div>
                                <div>
                                    <h3 className="font-black text-2xl tracking-tighter">Invite Console Staff</h3>
                                    <p className="text-xs font-bold text-slate-400">Grant authorized console permissions</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="form-group-premium">
                                    <label>Full Operator Name</label>
                                    <input className="input-premium-v2" value={newName} onChange={e => setNewName(e.target.value)} required />
                                </div>
                                <div className="form-group-premium">
                                    <label>Email Address</label>
                                    <input className="input-premium-v2" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required />
                                </div>
                                <div className="form-group-premium">
                                    <label>Console Access Role</label>
                                    <select className="input-premium-v2" value={newRole} onChange={e => setNewRole(e.target.value as any)}>
                                        {Object.entries(ROLE_LABELS).map(([key, label]) => (
                                            <option key={key} value={key}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="modal-actions-premium">
                                <button type="button" className="btn-premium-cancel" onClick={() => setIsAdding(false)}>Cancel</button>
                                <button type="submit" className="btn-premium-primary" disabled={creating}>
                                    {creating ? 'Dispatching...' : 'Dispatch Invitation'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {showBootstrapPanel && (
                    <div className="modal-overlay-premium">
                        <form className="modal-content-premium animate-fade-in" onSubmit={handleBootstrap}>
                            <div className="modal-header-section">
                                <div className="modal-header-icon-container"><FiLock /></div>
                                <div>
                                    <h3 className="font-black text-2xl tracking-tighter">Engine Bootstrap Flow</h3>
                                    <p className="text-xs font-bold text-slate-400">Platform recovery & primary linking</p>
                                </div>
                            </div>
                            <div className="modal-info-banner">
                                <FiInfo /> Direct RPC link. Use only for platform initialization.
                            </div>
                            <div className="space-y-6">
                                <div className="form-group-premium">
                                    <label>Identity Email</label>
                                    <input className="input-premium-v2" value={bootstrapEmail} onChange={e => setBootstrapEmail(e.target.value)} required />
                                </div>
                                <div className="form-group-premium">
                                    <label>Auth UID (UUID)</label>
                                    <input className="input-premium-v2" value={bootstrapUid} onChange={e => setBootstrapUid(e.target.value)} required />
                                </div>
                            </div>
                            <div className="modal-actions-premium">
                                <button type="button" className="btn-premium-cancel" onClick={() => setShowBootstrapPanel(false)}>Cancel</button>
                                <button type="submit" className="btn-premium-primary" disabled={bootstrapping}>
                                    {bootstrapping ? 'Synchronizing...' : 'Execute Bootstrap'}
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
    );

    if (isHubView) return content;
    return <Layout>{content}</Layout>;
};

export default SystemUsers;
