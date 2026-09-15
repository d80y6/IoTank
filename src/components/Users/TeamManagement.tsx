import React, { useState, useEffect } from 'react';
import { supabase } from '../../config/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import { AuditService } from '@/services/AuditService';
import { logger } from '@/utils/logger';
import './TeamManagement.css';

interface TeamMember {
    id: string;
    full_name: string;
    email: string;
    role: string;
    auth_level: number;
    created_at: string;
    status?: 'active' | 'pending';
}

interface PendingInvitation {
    id: string;
    full_name: string;
    email: string;
    role: string;
    status: string;
    created_at: string;
    station_name?: string;
}

const ROLES = ['supervisor', 'operator', 'viewer'] as const;
type Role = typeof ROLES[number];

export const TeamManagement: React.FC = () => {
    const { currentUser } = useAuth();
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
    const [activities, setActivities] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        role: 'operator' as Role,
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (currentUser?.stationId) {
            fetchData();
        }
    }, [currentUser?.stationId]);

    const roleCounts = {
        supervisor: members.filter(m => ['owner', 'admin', 'supervisor'].includes(m.role?.toLowerCase())).length,
        operator: members.filter(m => m.role?.toLowerCase() === 'operator').length,
        viewer: members.filter(m => m.role?.toLowerCase() === 'viewer').length,
    };

    const fetchData = async () => {
        if (!currentUser?.stationId) return;
        try {
            setLoading(true);

            // Active members
            const { data: membersData } = await supabase
                .from('profiles')
                .select('*')
                .eq('station_id', currentUser.stationId);

            // Pending team member invitations sent by this station
            const { data: pendingData } = await supabase
                .from('team_member_requests')
                .select('*')
                .eq('station_id', currentUser.stationId)
                .order('created_at', { ascending: false });

            // Recent unified activity
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            const { data: activitiesData } = await supabase
                .from('unified_events')
                .select('*')
                .eq('station_id', currentUser.stationId)
                .gte('created_at', threeDaysAgo.toISOString())
                .order('created_at', { ascending: false })
                .limit(10);

            setMembers(membersData || []);
            setPendingInvitations(pendingData || []);
            
            // Map unified events to the expected activity structure
            const mappedActivities = (activitiesData || []).map(event => ({
                id: event.id,
                user_name: event.metadata?.actor_name || 'System',
                user_email: event.actor_email,
                details: event.description,
                severity: event.severity?.toLowerCase() || 'info',
                created_at: event.created_at
            }));

            setActivities(mappedActivities);
        } catch (error) {
            logger.error('[TeamManagement] Error fetching team data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteMember = async (id: string) => {
        const member = members.find(m => m.id === id);
        if (!member) return;

        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Removal',
                message: `Are you sure you want to remove ${member.full_name}? This will immediately revoke all security credentials and platform access.`,
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Abort',
                        onClick: () => {}
                    },
                    {
                        label: 'Revoke Access',
                        primary: true,
                        onClick: async () => {
                            try {
                                await supabase.from('profiles').delete().eq('auth_user_id', id);
                                await AuditService.log(
                                    'TEAM',
                                    'MEMBER_REMOVED',
                                    currentUser?.stationId || '',
                                    `Security Access Revoked: Personnel [${member.full_name || member.email}] removed from station registry. All credentials invalidated.`,
                                    'CRITICAL',
                                    { 
                                        memberId: id, 
                                        memberEmail: member.email, 
                                        memberName: member.full_name,
                                        revokedBy: currentUser?.email 
                                    }
                                );
                                fetchData();
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Access Revoked',
                                        message: `Personnel record for ${member.full_name} has been purged from the station registry.`,
                                        type: 'info'
                                    }
                                }));
                            } catch (error: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Removal Failed',
                                        message: error.message || 'An error occurred during credential revocation.',
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

    const handleSubmitInvitation = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (!formData.full_name.trim() || !formData.email.trim()) {
            setFormError('Name and email are required.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            setFormError('Please enter a valid email address.');
            return;
        }

        setSubmitting(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            
            const { data, error: functionError } = await supabase.functions.invoke('invite-station-staff', {
                headers: {
                    Authorization: `Bearer ${session?.access_token}`
                },
                body: {
                    email: formData.email.trim().toLowerCase(),
                    full_name: formData.full_name.trim(),
                    role: formData.role,
                    station_id: currentUser?.stationId
                }
            });

            if (functionError) {
                let msg = functionError.message;
                try {
                    if ((functionError as any).context) {
                        const body = await (functionError as any).context.json();
                        msg = body.error || body.message || msg;
                    }
                } catch(e) { logger.warn('[TeamManagement] Failed to parse function error context', e); }
                throw new Error(msg);
            }

            if (data && data.success === false) {
                throw new Error(data.error || 'Failed to send invitation');
            }

            setSubmitSuccess(true);
            setFormData({ full_name: '', email: '', role: 'operator' });
            fetchData();

            // 🟢 Forensic Log
            await AuditService.log(
                'TEAM',
                'INVITE_SENT',
                currentUser?.stationId || '',
                `Security Clearance Issued: Authorization invite sent to [${formData.email}] for high-privilege role: ${formData.role.toUpperCase()}`,
                'INFO',
                { 
                    invitedEmail: formData.email, 
                    invitedName: formData.full_name,
                    role: formData.role,
                    issuedBy: currentUser?.email 
                }
            );

            setTimeout(() => {
                setSubmitSuccess(false);
                setShowAddModal(false);
            }, 2000);
        } catch (err: any) {
            setFormError(err.message || 'Failed to send invitation. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const getRoleBadgeClass = (role: string) => {
        switch (role?.toLowerCase()) {
            case 'owner':
            case 'admin':
            case 'supervisor': return 'badge-supervisor';
            case 'operator': return 'badge-operator';
            default: return 'badge-viewer';
        }
    };

    const getInvitationStatusClass = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'accepted':
            case 'approved': return 'status-approved';
            case 'expired':
            case 'rejected': return 'status-rejected';
            default: return 'status-pending';
        }
    };

    if (loading) return <div className="loading-state">Loading Team Management...</div>;
    if (!currentUser) return <div className="loading-state">Access Denied. Please log in.</div>;

    return (
        <div className="team-management-page">
            {/* Header */}
            <div className="tm-page-header">
                <div className="tm-header-info">
                    <h1>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        Team Management
                    </h1>
                    <p>Manage your station personnel. Invite team members to join your station.</p>
                </div>
                <button
                    id="add-team-member-btn"
                    className="tm-add-btn"
                    onClick={() => { setShowAddModal(true); setFormError(''); setSubmitSuccess(false); }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                    Add Team Member
                </button>
            </div>

            {/* Tier 1: Stats */}
            <div className="tm-stats-grid">
                <div className="tm-stat-card">
                    <span className="tm-stat-label">Total Members</span>
                    <span className="tm-stat-value">{members.length}</span>
                </div>
                <div className="tm-stat-card tm-stat-active">
                    <span className="tm-stat-label">Active Staff</span>
                    <span className="tm-stat-value">{members.length}</span>
                </div>
                <div className="tm-stat-card">
                    <span className="tm-stat-label">Pending Invitations</span>
                    <span className="tm-stat-value tm-pending-count">
                        {pendingInvitations.filter(r => r.status === 'pending').length}
                    </span>
                </div>
                <div className="tm-stat-card tm-role-card">
                    <span className="tm-stat-label">Staff by Role</span>
                    <div className="tm-role-boxes">
                        <div className="tm-role-box supervisor">
                            <span className="tm-role-count">{roleCounts.supervisor}</span>
                            <span className="tm-role-name">Supervisor</span>
                        </div>
                        <div className="tm-role-box operator">
                            <span className="tm-role-count">{roleCounts.operator}</span>
                            <span className="tm-role-name">Operator</span>
                        </div>
                        <div className="tm-role-box viewer">
                            <span className="tm-role-count">{roleCounts.viewer}</span>
                            <span className="tm-role-name">Viewer</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tier 2: Tables Grid */}
            <div className="tm-main-grid">
                {/* Active Personnel */}
                <div className="tm-table-card">
                    <div className="tm-table-header">
                        <svg className="tm-header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <h3>active personnel</h3>
                    </div>
                    <div className="table-wrapper">
                        <table className="tm-table">
                            <thead>
                                <tr>
                                    <th>S/No</th>
                                    <th>Name</th>
                                    <th>Role</th>
                                    <th>Joined Date</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {members.length === 0 ? (
                                    <tr>
                                        <td>1</td>
                                        <td colSpan={4} className="tm-empty-cell">No active personnel found.</td>
                                    </tr>
                                ) : (
                                    members.map((member, idx) => (
                                        <tr key={member.id}>
                                            <td className="tm-sno">{idx + 1}</td>
                                            <td>
                                                <div className="tm-member-cell">
                                                    <div className="tm-avatar">{member.full_name?.charAt(0)?.toUpperCase()}</div>
                                                    <div>
                                                        <div className="tm-member-name">{member.full_name}</div>
                                                        <div className="tm-member-email">{member.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`tm-badge ${getRoleBadgeClass(member.role)}`}>
                                                    {member.role}
                                                </span>
                                            </td>
                                            <td className="tm-date-cell">{new Date(member.created_at).toLocaleDateString()}</td>
                                            <td>
                                                <button
                                                    className="tm-btn-danger"
                                                    title="Remove member"
                                                    onClick={() => handleDeleteMember(member.id)}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <polyline points="3 6 5 6 21 6" />
                                                        <path d="M19 6l-1 14H6L5 6" />
                                                        <path d="M10 11v6M14 11v6" />
                                                        <path d="M9 6V4h6v2" />
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Pending Requests */}
                <div className="tm-table-card">
                    <div className="tm-table-header">
                        <svg className="tm-header-icon tm-icon-orange" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <h3>pending invitations</h3>
                    </div>
                    <div className="table-wrapper">
                        <table className="tm-table">
                            <thead>
                                <tr>
                                    <th>S/No</th>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingInvitations.length === 0 ? (
                                    <tr>
                                        <td>1</td>
                                        <td colSpan={4} className="tm-empty-cell">No pending invitations found.</td>
                                    </tr>
                                ) : (
                                    pendingInvitations.map((req, idx) => (
                                        <tr key={req.id}>
                                            <td className="tm-sno">{idx + 1}</td>
                                            <td>
                                                <div className="tm-member-cell">
                                                    <div className="tm-avatar tm-avatar-pending">
                                                        {(req.full_name || '?').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="tm-member-name">{req.full_name}</div>
                                                </div>
                                            </td>
                                            <td className="tm-member-email">{req.email}</td>
                                            <td>
                                                <span className={`tm-badge ${getRoleBadgeClass(req.role)}`}>
                                                    {req.role}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`tm-status-badge ${getInvitationStatusClass(req.status)}`}>
                                                    {req.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Tier 3: Activity Feed */}
            <div className="tm-table-card tm-full-width">
                <div className="tm-table-header">
                    <svg className="tm-header-icon tm-icon-cyan" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    <h3>recent team activity</h3>
                </div>
                <div className="table-wrapper">
                    <table className="tm-table">
                        <thead>
                            <tr>
                                <th>S/No</th>
                                <th>User</th>
                                <th>Action</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activities.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="tm-empty-cell tm-empty-large">
                                        No recent team activity found in the last 3 days.
                                    </td>
                                </tr>
                            ) : (
                                activities.map((activity, idx) => (
                                    <tr key={activity.id}>
                                        <td className="tm-sno">{idx + 1}</td>
                                        <td>
                                            <div className="tm-member-cell">
                                                <div className="tm-avatar tm-avatar-activity">
                                                    {activity.user_name?.charAt(0)}
                                                </div>
                                                <div>
                                                    <div className="tm-member-name">{activity.user_name}</div>
                                                    <div className="tm-member-email">{activity.user_email || 'Station Personnel'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="tm-activity-row">
                                                <div className={`tm-activity-dot ${activity.severity || 'info'}`} />
                                                <span>{activity.details}</span>
                                            </div>
                                        </td>
                                        <td className="tm-date-cell">
                                            {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add Team Member Modal */}
            {showAddModal && (
                <div className="tm-modal-overlay" id="add-team-member-modal">
                    <div className="tm-modal">
                        <div className="tm-modal-header">
                            <div className="tm-modal-title-group">
                                <div className="tm-modal-icon">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                        <circle cx="8.5" cy="7" r="4" />
                                        <line x1="20" y1="8" x2="20" y2="14" />
                                        <line x1="23" y1="11" x2="17" y2="11" />
                                    </svg>
                                </div>
                                <div>
                                    <h2>Add Team Member</h2>
                                    <p>Invitation will be sent directly to the user</p>
                                </div>
                            </div>
                            <button
                                className="tm-modal-close"
                                onClick={() => setShowAddModal(false)}
                                title="Close"
                            >
                                ×
                            </button>
                        </div>

                        {submitSuccess ? (
                            <div className="tm-modal-success">
                                <div className="tm-success-icon">✓</div>
                                <h3>Invitation Sent!</h3>
                                <p>An invitation link has been sent to the user's email address.</p>
                            </div>
                        ) : (
                            <form className="tm-modal-form" onSubmit={handleSubmitInvitation}>
                                <div className="tm-station-info">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="12" y1="8" x2="12" y2="12" />
                                        <line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    <span>Station will be auto-detected from your account</span>
                                </div>

                                <div className="tm-form-group">
                                    <label htmlFor="member-name">Full Name <span className="tm-required">*</span></label>
                                    <input
                                        id="member-name"
                                        type="text"
                                        placeholder="Enter member's full name"
                                        value={formData.full_name}
                                        onChange={e => setFormData(p => ({ ...p, full_name: e.target.value }))}
                                        required
                                        autoFocus
                                    />
                                </div>

                                <div className="tm-form-group">
                                    <label htmlFor="member-email">Email Address <span className="tm-required">*</span></label>
                                    <input
                                        id="member-email"
                                        type="email"
                                        placeholder="member@example.com"
                                        value={formData.email}
                                        onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                                        required
                                    />
                                </div>

                                <div className="tm-form-group">
                                    <label htmlFor="member-role">Role <span className="tm-required">*</span></label>
                                    <select
                                        id="member-role"
                                        value={formData.role}
                                        onChange={e => setFormData(p => ({ ...p, role: e.target.value as Role }))}
                                        required
                                    >
                                        <option value="supervisor">Supervisor</option>
                                        <option value="operator">Operator</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                    <p className="tm-field-hint">
                                        {formData.role === 'supervisor' && 'Full station access except owner settings'}
                                        {formData.role === 'operator' && 'Day-to-day operations and data entry'}
                                        {formData.role === 'viewer' && 'Read-only access to dashboards and reports'}
                                    </p>
                                </div>

                                {formError && (
                                    <div className="tm-form-error">{formError}</div>
                                )}

                                <div className="tm-modal-actions">
                                    <button
                                        type="button"
                                        className="tm-btn-cancel"
                                        onClick={() => setShowAddModal(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="tm-btn-submit"
                                        disabled={submitting}
                                    >
                                        {submitting ? (
                                            <>
                                                <span className="tm-spinner" />
                                                Submitting...
                                            </>
                                        ) : (
                                            <>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                    <line x1="22" y1="2" x2="11" y2="13" />
                                                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                                </svg>
                                                Send Invitation
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
