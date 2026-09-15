import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clientsService } from '../services/clientsService';
import Layout from '../components/Layout';
import { FiArrowLeft, FiEdit2, FiSlash, FiCheckCircle, FiDollarSign, FiClock, FiActivity, FiMapPin, FiMail, FiPhone, FiShield, FiLoader, FiPlus, FiXCircle } from 'react-icons/fi';
import './ClientDetails.css';

const ClientDetails = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [client, setClient] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isAdjustingDebt, setIsAdjustingDebt] = useState(false);
    const [isAddingTank, setIsAddingTank] = useState(false);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
    const [isRecordingPayment, setIsRecordingPayment] = useState(false);
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentReason, setAdjustmentReason] = useState('');
    const [paymentData, setPaymentData] = useState({ amount: '', method: 'M-PESA', reference: '' });
    const [profileUpdates, setProfileUpdates] = useState({ 
        station_name: '', 
        email: '', 
        phone: '', 
        station_location: '', 
        county: '' 
    });
    const [newTank, setNewTank] = useState({ name: '', type: 'Super Petrol (Unleaded Premium)', capacity: 10000 });

    useEffect(() => {
        const fetchClient = async () => {
            if (!id) return;
            try {
                const data = await clientsService.getClientById(id);
                setClient(data);
            } catch (err) {
                console.error("Error fetching client details:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchClient();
    }, [id]);

    const handleAdjustDebt = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id) return;
        try {
            await clientsService.adjustDebt(id, parseFloat(adjustmentAmount), adjustmentReason);
            const data = await clientsService.getClientById(id);
            setClient(data);
            setIsAdjustingDebt(false);
            setAdjustmentAmount('');
            setAdjustmentReason('');
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Debt Adjusted',
                    message: `Liability for ${client.station_name} has been modified in the ledger.`,
                    type: 'success'
                }
            }));
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Adjustment Failed',
                    message: err.message,
                    type: 'error'
                }
            }));
        }
    };

    const handleSuspend = async () => {
        if (!id) return;
        
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Suspension',
                message: `Suspend all operational access for ${client.station_name}? This will interrupt telemetry and billing.`,
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Abort',
                        onClick: () => {}
                    },
                    {
                        label: 'Suspend Node',
                        primary: true,
                        onClick: async () => {
                            try {
                                await clientsService.suspendClient(id, 'Administrative suspension initiated via Super Admin.');
                                const data = await clientsService.getClientById(id);
                                setClient(data);
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Node Suspended',
                                        message: 'Operational credentials have been revoked.',
                                        type: 'info'
                                    }
                                }));
                            } catch (err: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Suspension Failed',
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

    const handleReactivate = async () => {
        if (!id) return;
        
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Reactivation',
                message: `Restore full services and telemetry for ${client.station_name}?`,
                type: 'info',
                persistent: true,
                actions: [
                    {
                        label: 'Cancel',
                        onClick: () => {}
                    },
                    {
                        label: 'Restore Services',
                        primary: true,
                        onClick: async () => {
                            try {
                                await clientsService.reactivateClient(id);
                                const data = await clientsService.getClientById(id);
                                setClient(data);
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Node Reactivated',
                                        message: 'All platform services have been synchronized.',
                                        type: 'success'
                                    }
                                }));
                            } catch (err: any) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Restoration Failed',
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

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id) return;
        try {
            await clientsService.updateProfile(id, profileUpdates);
            const data = await clientsService.getClientById(id);
            setClient(data);
            setIsUpdatingProfile(false);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Profile Updated',
                    message: 'Master registration details have been committed.',
                    type: 'success'
                }
            }));
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Update Error',
                    message: err.message,
                    type: 'error'
                }
            }));
        }
    };

    const handleRecordPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id) return;
        try {
            await clientsService.recordExternalPayment(
                id, 
                parseFloat(paymentData.amount), 
                paymentData.method, 
                paymentData.reference
            );
            const data = await clientsService.getClientById(id);
            setClient(data);
            setIsRecordingPayment(false);
            setPaymentData({ amount: '', method: 'M-PESA', reference: '' });
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Remittance Recorded',
                    message: 'External payment has been applied to the ledger.',
                    type: 'success'
                }
            }));
        } catch (err: any) {
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Recording Failed',
                    message: err.message,
                    type: 'error'
                }
            }));
        }
    };

    if (loading) return (
        <Layout>
            <div className="p-20 flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-12 h-12 border-4 border-accent-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-secondary font-black uppercase tracking-widest text-xs">synchronizing client data ledger...</p>
            </div>
        </Layout>
    );

    if (!client) return (
        <Layout>
            <div className="p-20 text-center card bg-bg-primary">
                <FiActivity className="text-4xl mx-auto mb-4 text-danger opacity-20" />
                <h2 className="text-xl font-bold text-danger">subject not found</h2>
                <p className="text-secondary mt-2">the record you are attempting to access does not exist or has been purged.</p>
                <button onClick={() => navigate('/clients')} className="btn btn-secondary mt-8">
                    return to directory
                </button>
            </div>
        </Layout>
    );

    return (
        <Layout>
            <div className="client-details-container">
                <header className="client-details-header">
                    <button onClick={() => navigate('/clients')} className="back-link">
                        <FiArrowLeft /> return to client directory
                    </button>
                    <div className="flex gap-3">
                        {client.account_status !== 'suspended' ? (
                            <button onClick={handleSuspend} className="btn btn-secondary text-danger border-danger-border gap-2">
                                <FiSlash /> suspend operational access
                            </button>
                        ) : (
                            <button onClick={handleReactivate} className="btn btn-success gap-2">
                                <FiCheckCircle /> reactivate services
                            </button>
                        )}
                        <button 
                            className="btn btn-primary gap-2"
                            onClick={() => {
                                setProfileUpdates({
                                    station_name: client.station_name,
                                    email: client.email,
                                    phone: client.phone || '',
                                    station_location: client.station_location,
                                    county: client.county
                                });
                                setIsUpdatingProfile(true);
                            }}
                        >
                            <FiEdit2 /> update profile
                        </button>
                    </div>
                </header>

                <div className="details-grid">
                    <div className="flex flex-col gap-8">
                        {/* Profile Premium Card */}
                        <div className="profile-premium-card">
                            <div className="profile-banner">
                                <div className="station-identity">
                                    <div className="station-logo-large">
                                        {client.station_name?.charAt(0) || <FiActivity />}
                                    </div>
                                    <div className="station-info">
                                        <h1>{client.station_name}</h1>
                                        <div className="station-location-text">
                                            <FiMapPin className="inline mr-1 opacity-50" /> {client.station_location}, {client.county}
                                        </div>
                                    </div>
                                </div>
                                <div className="status-section">
                                    <span className={`status-badge-large ${
                                        client.account_status === 'active' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                                    }`}>
                                        system status: {client.account_status}
                                    </span>
                                    <p className="text-[10px] text-disabled font-bold mt-3 tracking-widest uppercase">
                                        core id: {client.station_id.slice(0, 16)}...
                                    </p>
                                </div>
                            </div>

                            <div className="info-stripe">
                                <div className="info-item">
                                    <label>verified email</label>
                                    <p><FiMail className="inline mr-1 opacity-50" /> {client.email}</p>
                                </div>
                                <div className="info-item">
                                    <label>telecommunications</label>
                                    <p><FiPhone className="inline mr-1 opacity-50" /> {client.phone || 'n/a'}</p>
                                </div>
                                <div className="info-item">
                                    <label>billing model</label>
                                    <p><FiShield className="inline mr-1 opacity-50 text-accent-primary" /> Usage-Based (Standard)</p>
                                </div>
                            </div>
                        </div>

                        {/* Financial Premium Section */}
                        <div className="financial-premium-section">
                            <h2 className="text-lg font-black flex items-center gap-2 text-primary uppercase tracking-wider mb-6">
                                <FiDollarSign className="text-accent-primary" /> fiscal oversight summary
                            </h2>
                            <div className="financial-grid">
                                <div className="stat-premium-card">
                                    <p className="stat-label">Outstanding Liability</p>
                                    <p className="stat-value value--danger">
                                        {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(client.current_debt)}
                                    </p>
                                </div>
                                <div className="stat-premium-card">
                                    <p className="stat-label">Total Remittances</p>
                                    <p className="stat-value value--success">
                                        {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(client.total_paid)}
                                    </p>
                                </div>
                                <div className="stat-premium-card">
                                    <p className="stat-label">Subject Capitalization</p>
                                    <p className="stat-value value--info">
                                        {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(client.lifetime_revenue)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-4 mt-8">
                                <button onClick={() => setIsAdjustingDebt(true)} className="btn btn-secondary flex-1 border-info text-info font-black">
                                    MANUAL DEBT ADJUSTMENT
                                </button>
                                <button onClick={() => setIsRecordingPayment(true)} className="btn btn-secondary flex-1 font-black">
                                    RECORD EXTERNAL PAYMENT
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar Column */}
                    <div className="sidebar-cards">
                        <div className="card">
                            <h2 className="text-sm font-black mb-6 flex items-center gap-2 text-primary uppercase tracking-widest">
                                <FiClock /> activity ledger
                            </h2>
                            <div className="flex flex-col gap-1">
                                {client.transactions && client.transactions.length > 0 ? (
                                    client.transactions.slice(0, 5).map((t: any) => (
                                        <div key={t.id} className="flex justify-between items-center p-4 rounded-lg bg-bg-tertiary border border-divider hover:border-accent-primary-light transition-colors">
                                            <div>
                                                <p className="font-bold text-primary text-xs capitalize">{t.transaction_type}</p>
                                                <p className="text-[10px] text-disabled font-bold">{new Date(t.created_at).toLocaleDateString()}</p>
                                            </div>
                                            <p className={`font-black text-xs ${t.transaction_type === 'payment' ? 'text-success' : 'text-danger'}`}>
                                                {t.transaction_type === 'payment' ? '-' : '+'}{t.amount}
                                            </p>
                                        </div>
                                    ))
                                ) : (
                                    <div className="p-8 text-center text-disabled italic text-xs bg-bg-tertiary rounded-lg border border-dashed border-divider">
                                        non-transactional period data.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="card text-left">
                             <h2 className="text-sm font-black mb-6 flex items-center gap-2 text-primary uppercase tracking-widest">
                                <FiActivity /> hardware diagnostics
                            </h2>
                            <div className="health-item">
                                <span className="health-label">total tanks</span>
                                <span className="health-value">{client.tanks?.length || 0}</span>
                            </div>
                             <div className="health-item">
                                <span className="health-label">active telemetry tanks</span>
                                <span className="health-value text-success">{client.tanks?.filter((t:any)=>t.status==='active').length || 0}</span>
                            </div>
                             <div className="health-item">
                                <span className="health-label">system integrity</span>
                                <span className="health-value text-info">stable</span>
                            </div>
                            
                            <hr className="my-6 border-divider" />
                            
                            <div className="flex flex-col gap-2">
                                <h3 className="text-[10px] font-black text-disabled uppercase tracking-widest mb-2">connected tanks</h3>
                                {client.tanks?.map((tank: any) => (
                                    <div key={tank.id} className="flex justify-between items-center p-3 rounded-lg bg-bg-tertiary border border-divider text-xs">
                                        <div>
                                            <p className="font-bold text-primary">{tank.tank_name}</p>
                                            <p className="text-[9px] text-disabled uppercase">{tank.fuel_type}</p>
                                        </div>
                                        <p className="font-black text-accent-primary">{tank.tank_capacity}l</p>
                                    </div>
                                ))}
                                <button onClick={() => setIsAddingTank(true)} className="btn btn-secondary btn-sm mt-2 gap-2 w-full justify-center text-[10px] font-black border-dashed">
                                    <FiPlus /> add new tank
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {isAddingTank && (
                    <div className="modal-overlay-premium" onClick={() => setIsAddingTank(false)}>
                        <div className="modal-content-premium" onClick={e => e.stopPropagation()}>
                            <header className="mb-8">
                                <h2 className="text-xl font-black text-primary uppercase tracking-tight">provision new tank</h2>
                                <p className="text-xs text-secondary mt-2">
                                    initialize a new tank endpoint for {client.station_name}.
                                </p>
                            </header>
                            
                            <div className="flex flex-col gap-6">
                                <div className="input-group-premium">
                                    <label>tank identifier</label>
                                    <input 
                                        type="text" 
                                        className="input-premium"
                                        placeholder="e.g. tank 4 (diesel)" 
                                        value={newTank.name}
                                        onChange={(e) => setNewTank({ ...newTank, name: e.target.value })}
                                    />
                                </div>
                                <div className="input-group-premium">
                                    <label>fuel specification</label>
                                    <select 
                                        className="input-premium"
                                        value={newTank.type}
                                        onChange={(e) => setNewTank({ ...newTank, type: e.target.value })}
                                    >
                                        <option>super petrol (unleaded premium)</option>
                                        <option>diesel (automotive gas oil)</option>
                                        <option>kerosene (illuminating paraffin)</option>
                                        <option>liquefied petroleum gas (lpg/cooking gas)</option>
                                        <option>compressed natural gas (cng)</option>
                                        <option>premium/premium additive fuels</option>
                                    </select>
                                </div>
                                <div className="input-group-premium">
                                    <label>total capacity (litres)</label>
                                    <input 
                                        type="number" 
                                        className="input-premium"
                                        value={newTank.capacity}
                                        onChange={(e) => setNewTank({ ...newTank, capacity: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                                <div className="flex gap-4 mt-4">
                                    <button type="button" onClick={() => setIsAddingTank(false)} className="btn btn-secondary flex-1">cancel</button>
                                    <button onClick={async () => {
                                        try {
                                            await clientsService.addTank({
                                                station_id: client.station_id,
                                                site_id: client.sites?.[0]?.id,
                                                tank_name: newTank.name,
                                                fuel_type: newTank.type,
                                                tank_capacity: newTank.capacity
                                            });
                                            const data = await clientsService.getClientById(client.station_id);
                                            setClient(data);
                                            setIsAddingTank(false);
                                            window.dispatchEvent(new CustomEvent('system-toast', {
                                                detail: {
                                                    title: 'Tank Initialized',
                                                    message: `New storage endpoint "${newTank.name}" has been provisioned.`,
                                                    type: 'success'
                                                }
                                            }));
                                        } catch (err: any) {
                                            window.dispatchEvent(new CustomEvent('system-toast', {
                                                detail: {
                                                    title: 'Provisioning Error',
                                                    message: err.message,
                                                    type: 'error'
                                                }
                                            }));
                                        }
                                    }} className="btn btn-primary flex-1 font-black">initialize tank</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {isAdjustingDebt && (
                    <div className="modal-overlay-premium" onClick={() => setIsAdjustingDebt(false)}>
                        <div className="modal-content-premium" onClick={e => e.stopPropagation()}>
                            <header className="mb-8">
                                <h2 className="text-xl font-black text-primary uppercase tracking-tight">Debt Adjustment Protocol</h2>
                                <p className="text-xs text-secondary mt-2">
                                    All modifications are recorded permanently in the audit trail. Use signed integers for directional adjustments.
                                </p>
                            </header>
                            
                            <form onSubmit={handleAdjustDebt} className="flex flex-col gap-6">
                                <div className="input-group-premium">
                                    <label>Adjustment Magnitude (KES)</label>
                                    <input 
                                        type="number" 
                                        className="input-premium"
                                        placeholder="e.g. 1500.00" 
                                        required
                                        value={adjustmentAmount}
                                        onChange={(e) => setAdjustmentAmount(e.target.value)}
                                    />
                                </div>
                                <div className="input-group-premium">
                                    <label>Authorized Justification</label>
                                    <textarea 
                                        rows={3} 
                                        required
                                        className="input-premium"
                                        placeholder="Technical or financial rationale for this operation..."
                                        value={adjustmentReason}
                                        onChange={(e) => setAdjustmentReason(e.target.value)}
                                    />
                                </div>
                                <div className="flex gap-4 mt-4">
                                    <button type="button" onClick={() => setIsAdjustingDebt(false)} className="btn btn-secondary flex-1">ABORT</button>
                                    <button type="submit" className="btn btn-primary flex-1 font-black">COMMIT ADJUSTMENT</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {isUpdatingProfile && (
                    <div className="modal-overlay-premium" onClick={() => setIsUpdatingProfile(false)}>
                        <div className="modal-content-premium" onClick={e => e.stopPropagation()}>
                            <header className="mb-8">
                                <h2 className="text-xl font-black text-primary uppercase tracking-tight">Update Station Profile</h2>
                                <p className="text-xs text-secondary mt-2">Modify the master registration details for this subject.</p>
                            </header>
                            <form onSubmit={handleUpdateProfile} className="flex flex-col gap-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="input-group-premium">
                                        <label>Station Name</label>
                                        <input type="text" className="input-premium" value={profileUpdates.station_name} onChange={e => setProfileUpdates({...profileUpdates, station_name: e.target.value})} required />
                                    </div>
                                    <div className="input-group-premium">
                                        <label>Email Address</label>
                                        <input type="email" className="input-premium" value={profileUpdates.email} onChange={e => setProfileUpdates({...profileUpdates, email: e.target.value})} required />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="input-group-premium">
                                        <label>Phone Number</label>
                                        <input type="text" className="input-premium" value={profileUpdates.phone} onChange={e => setProfileUpdates({...profileUpdates, phone: e.target.value})} />
                                    </div>
                                    <div className="input-group-premium">
                                        <label>County</label>
                                        <input type="text" className="input-premium" value={profileUpdates.county} onChange={e => setProfileUpdates({...profileUpdates, county: e.target.value})} />
                                    </div>
                                </div>
                                <div className="input-group-premium">
                                    <label>Specific Location</label>
                                    <input type="text" className="input-premium" value={profileUpdates.station_location} onChange={e => setProfileUpdates({...profileUpdates, station_location: e.target.value})} />
                                </div>
                                <div className="flex gap-4 mt-4">
                                    <button type="button" onClick={() => setIsUpdatingProfile(false)} className="btn btn-secondary flex-1">CANCEL</button>
                                    <button type="submit" className="btn btn-primary flex-1 font-black">SAVE CHANGES</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {isRecordingPayment && (
                    <div className="modal-overlay-premium" onClick={() => setIsRecordingPayment(false)}>
                        <div className="modal-content-premium" onClick={e => e.stopPropagation()}>
                            <header className="mb-8">
                                <h2 className="text-xl font-black text-primary uppercase tracking-tight">Record External Remittance</h2>
                                <p className="text-xs text-secondary mt-2">Manually register a payment received outside the automated billing pipeline.</p>
                            </header>
                            <form onSubmit={handleRecordPayment} className="flex flex-col gap-6">
                                <div className="input-group-premium">
                                    <label>Amount (KES)</label>
                                    <input type="number" className="input-premium" value={paymentData.amount} onChange={e => setPaymentData({...paymentData, amount: e.target.value})} required />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="input-group-premium">
                                        <label>Payment Method</label>
                                        <select className="input-premium" value={paymentData.method} onChange={e => setPaymentData({...paymentData, method: e.target.value})}>
                                            <option>M-PESA</option>
                                            <option>Bank Transfer (RTGS/EFT)</option>
                                            <option>Cash Deposit</option>
                                            <option>Cheque</option>
                                        </select>
                                    </div>
                                    <div className="input-group-premium">
                                        <label>Transaction Reference</label>
                                        <input type="text" className="input-premium" value={paymentData.reference} onChange={e => setPaymentData({...paymentData, reference: e.target.value})} required />
                                    </div>
                                </div>
                                <div className="flex gap-4 mt-4">
                                    <button type="button" onClick={() => setIsRecordingPayment(false)} className="btn btn-secondary flex-1">DISCARD</button>
                                    <button type="submit" className="btn btn-primary flex-1 font-black">RECORD PAYMENT</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </Layout>
    );
};

export default ClientDetails;
