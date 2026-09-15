import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/config/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { NebulaLoader } from '@/components/Common/NebulaLoader';
import { 
    FaMoneyBillWave, 
    FaHistory, 
    FaShieldAlt, 
    FaChartBar, 
    FaExclamationTriangle,
    FaExchangeAlt,
    FaPhone,
    FaCreditCard
} from 'react-icons/fa';
import { FiArrowRight, FiActivity } from 'react-icons/fi';
import { logger } from '@/utils/logger';
import './BillingPage.css';

interface BillingInfo {
    station_id: string; 
    current_debt: number;
    total_paid: number;
    account_status: string;
    next_billing_date: string;
    station_name: string;
    sub_tier?: 'BASIC' | 'PRO' | 'ENTERPRISE';
    sub_status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'PROVISIONING';
    sub_expires_at?: string;
    phone?: string;
    telemetry_usage_mb?: number;
}

interface Transaction {
    id: string;
    transaction_type: string;
    amount: number;
    description: string;
    payment_status: string;
    payment_method: string;
    payment_reference?: string;
    created_at: string;
    completed_at: string;
    provider?: string;
    provider_ref?: string;
    status: string;
}

// Mock data removed. Component now strictly relies on dynamic database telemetry.

export const BillingPage: React.FC = () => {
    const { currentUser, canSee } = useAuth();
    const navigate = useNavigate();

    const [billing, setBilling] = useState<BillingInfo | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [ledgerLoading, setLedgerLoading] = useState(true);
    const [payAmount, setPayAmount] = useState('');
    const [payPhone, setPayPhone] = useState(currentUser?.phoneNumber || '');
    const [paying, setPaying] = useState(false);
    const [payFeedback, setPayFeedback] = useState('');
    const [stationId, setStationId] = useState<string | null>(null);
    const [readingCount, setReadingCount] = useState(0);

    useEffect(() => {
        const fetchBilling = async () => {
            if (!currentUser?.authUserId) return;
            setLoading(true);

            try {
                let query = supabase.from('fuel_stations').select('*');

                if (currentUser.stationId && currentUser.stationId !== 'SYSTEM_GOVERNANCE') {
                    query = query.eq('station_id', currentUser.stationId);
                } else if (currentUser.isSystemAccount) {
                    setLoading(false);
                    return;
                } else {
                    query = query.eq('owner_id', currentUser.authUserId);
                }

                const { data: cbData, error: billingError } = await query.maybeSingle();

                if (billingError) throw billingError;

                if (cbData) {
                    setBilling(cbData);
                    setStationId(cbData.station_id);
                    setPayPhone(cbData.phone || currentUser?.phoneNumber || '');
                    setLoading(false); // [UX OPTIMIZATION]: Unlock header/metrics immediately

                    setLedgerLoading(true);
                    const [txRes, readingRes] = await Promise.all([
                        supabase.from('transactions').select('*').eq('station_id', cbData.station_id).order('created_at', { ascending: false }).limit(20),
                        supabase.from('sensor_readings_partitioned').select('*', { count: 'exact', head: true }).eq('station_id', cbData.station_id)
                    ]);

                    setTransactions(txRes.data || []);
                    setReadingCount(readingRes.count || 0);
                    setLedgerLoading(false); // [UX OPTIMIZATION]: Unlock ledger list

                    // [LIVE RECONCILIATION]: Subscribe to transaction updates
                    const channel = supabase
                        .channel(`billing:${cbData.station_id}`)
                        .on('postgres_changes', { 
                            event: 'UPDATE', 
                            schema: 'public', 
                            table: 'transactions',
                            filter: `station_id=eq.${cbData.station_id}`
                        }, (payload) => {
                            if (payload.new.payment_status === 'completed') {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Payment Confirmed',
                                        message: `M-Pesa payment of KSh ${payload.new.amount} has been successfully reconciled.`,
                                        type: 'success',
                                        attribution: 'BILLING_SENSE'
                                    }
                                }));
                                // Refresh list
                                setTransactions(prev => [payload.new as Transaction, ...prev.filter(t => t.id !== payload.new.id)]);
                            } else if (payload.new.payment_status === 'failed') {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Payment Failed',
                                        message: `M-Pesa transaction failed: ${payload.new.metadata?.errorMessage || 'Declined by provider'}`,
                                        type: 'error',
                                        attribution: 'BILLING_SENSE'
                                    }
                                }));
                                // Refresh list to show failure
                                setTransactions(prev => [payload.new as Transaction, ...prev.filter(t => t.id !== payload.new.id)]);
                            }
                        })
                        .subscribe();

                    return () => {
                        supabase.removeChannel(channel);
                    };
                } else {
                    setBilling(null);
                    setLoading(false);
                }
            } catch (err) {
                logger.error("[BILLING_SYSTEM_FAILURE]", err);
                setBilling(null);
                setLoading(false);
            } finally {
                setLedgerLoading(false);
            }
        };
        fetchBilling();
    }, [currentUser]);

    if (!canSee(5)) {
        return (
            <div className="billing-restricted-view" role="alert">
                <div className="restricted-icon-wrap" aria-hidden="true">
                    <FaShieldAlt size={48} className="restricted-shield-icon" />
                </div>
                <h2>Security Protocol Enforced</h2>
                <p>Finance and Governance modules are limited to Administrators.</p>
                <div className="restricted-actions">
                    <button onClick={() => navigate('/dashboard')} className="btn-primary-premium">Return to Hub</button>
                </div>
            </div>
        );
    }

    // Quick provision removed

    const handleStkPush = async () => {
        if (!payAmount || parseFloat(payAmount) <= 0) { setPayFeedback('⚠️ Enter amount'); return; }
        if (!payPhone || payPhone.length < 10) { setPayFeedback('⚠️ Enter valid phone'); return; }
        if (!stationId) { setPayFeedback('⚠️ ID missing'); return; }

        setPaying(true);
        setPayFeedback(`📲 Initiating Push...`);

        // [LIVE FEEDBACK]: Trigger persistent M-Pesa Lifecycle Toast
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'M-Pesa STK Push',
                message: `Initiating KSh ${payAmount} payment on ${payPhone}. Please check your handset.`,
                type: 'info',
                persistent: true, // Stay until cleared or replaced
                attribution: 'BILLING_SENSE'
            }
        }));

        try {
            const amount = parseFloat(payAmount);
            const ref = 'STK_' + Math.random().toString(36).substring(2, 10).toUpperCase();

            const { data, error } = await supabase.functions.invoke('mpesa-proxy', {
                body: { phone: payPhone, amount: amount, reference: ref, stationId: stationId }
            });

            if (error) throw error;

            await supabase.from('transactions').insert({
                station_id: stationId,
                amount: amount,
                transaction_type: 'payment',
                payment_method: 'MPESA',
                payment_reference: data.CheckoutRequestID || ref,
                payment_status: 'pending',
                description: `M-Pesa STK Push initiated for KSh ${amount}`
            });

            setPayFeedback(`✅ Request Sent!`);
            setPayAmount('');

            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'STK Push Sent',
                    message: `Payment request dispatched to ${payPhone}. Complete the PIN entry on your phone.`,
                    type: 'success',
                    persistent: false,
                    attribution: 'BILLING_SENSE'
                }
            }));
        } catch (err: any) {
            setPayFeedback(`❌ Failed: ${err.message}`);
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Payment Failed',
                    message: `Could not initiate STK push: ${err.message}`,
                    type: 'error',
                    persistent: false,
                    attribution: 'BILLING_SENSE'
                }
            }));
        } finally {
            setPaying(false);
        }
    };

    const handlePaystackPayment = async () => {
        const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
        if (!publicKey || publicKey === 'pk_test_placeholder') {
            setPayFeedback('❌ Config error');
            return;
        }
        if (!payAmount || parseFloat(payAmount) <= 0) {
            setPayFeedback('⚠️ Enter amount');
            return;
        }
        // CRIT-07 FIX: Removed @ts-ignore which could suppress legitimate type errors.
        const PaystackPop = (window as any).PaystackPop;
        if (!PaystackPop) {
            setPayFeedback('❌ SDK not loaded');
            return;
        }

        try {
            const handler = PaystackPop.setup({
                key: publicKey,
                email: currentUser?.email || 'finance@iotank.com',
                amount: parseFloat(payAmount) * 100,
                currency: 'KES',
                ref: 'PSTK_' + Math.random().toString(36).substring(2, 10).toUpperCase(),
                callback: (response: any) => {
                    setPaying(true);
                    setPayFeedback('⏳ Verifying...');
                    const verify = async () => {
                        try {
                            const { error } = await supabase.rpc('process_payment', {
                                p_station_id: stationId,
                                p_amount: parseFloat(payAmount),
                                p_payment_method: 'PAYSTACK',
                                p_payment_reference: response.reference,
                                p_description: 'Paystack Card Settlement'
                            });
                            if (error) throw error;
                            setPayFeedback('✅ Success!');
                            setTimeout(() => window.location.reload(), 2000);
                        } catch (err: any) {
                            setPayFeedback(`❌ Failed: ${err.message}`);
                            setPaying(false);
                        }
                    };
                    verify();
                },
                onClose: () => {
                    setPayFeedback('ℹ️ Closed.');
                    setPaying(false);
                }
            });
            handler.openIframe();
        } catch (err: any) {
            setPayFeedback(`❌ Init Error: ${err.message}`);
        }
    };

    const formatDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '—';
    const txIcon = (type: string) => ['payment', 'credit', 'MPESA', 'PAYSTACK'].includes(type) ? <FaHistory /> : <FiActivity />;

    if (loading) {
        return (
            <div className="billing-container">
                <div className="billing-layout">
                    <header className="billing-header-premium">
                        <div className="flex flex-col">
                            <h1 className="animate-pulse">Billing Hub</h1>
                            <p className="billing-subtitle-premium">Synchronizing security protocols...</p>
                        </div>
                    </header>
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-slate-400 font-bold tracking-widest text-xs uppercase animate-pulse">Initializing Baseline...</div>
                    </div>
                </div>
            </div>
        );
    }

    if (!billing) {
        if (currentUser?.isSystemAccount) {
            return (
                <div className="billing-container">
                    <div className="billing-layout">
                        <header className="billing-header-premium">
                            <div className="flex flex-col">
                                <h1>System Governance Hub</h1>
                                <p className="billing-subtitle-premium">Global Infrastructure & Financial Oversight</p>
                            </div>
                        </header>
                        <div className="stat-card-clean mt-8">
                            <div className="stat-header">
                                <span className="stat-card-label">Governance Mode</span>
                                <div className="metric-icon-box metric-icon-box--security"><FaShieldAlt /></div>
                            </div>
                            <h2 className="stat-main-value text-amber-500">READ ONLY</h2>
                            <p className="text-slate-500 text-sm mt-2">Individual station ledgers are not accessible from the global governance view. Please select a specific node to view its financial matrix.</p>
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className="billing-container">
                <div className="billing-layout">
                    <header className="billing-header-premium">
                        <div className="flex flex-col">
                            <h1>Ledger Missing</h1>
                            <p className="billing-subtitle-premium">Protocol Reconciliation Failure</p>
                        </div>
                    </header>
                    <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
                        <FaExclamationTriangle size={48} className="text-amber-500 mb-4" />
                        <p className="text-slate-500 max-w-md">The ledger for this node could not be retrieved. This may occur if the station is not yet provisioned for billing.</p>
                        <button onClick={() => window.location.reload()} className="btn-primary-premium mt-6">Retry Sync</button>
                    </div>
                </div>
            </div>
        );
    }

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: { y: 0, opacity: 1 }
    };

    return (
        <motion.div 
            initial="hidden" 
            animate="visible" 
            variants={containerVariants}
            className="billing-container"
        >
            <div className="billing-layout">
                <header className="billing-header-premium">
                    <div className="flex flex-col">
                        <motion.h1 variants={itemVariants}>Billing Hub</motion.h1>
                        <motion.p variants={itemVariants} className="billing-subtitle-premium">Financial Matrix & Ledger Management</motion.p>
                    </div>
                    <motion.div variants={itemVariants} className="billing-status-pill">
                        <div className="status-dot-pulse" />
                        <span>{billing.account_status}</span>
                    </motion.div>
                </header>

                <div className="billing-metric-grid">
                    <motion.div variants={itemVariants} className="stat-card-clean">
                        <div className="stat-header">
                            <span className="stat-card-label">Account Liability</span>
                            <div className="metric-icon-box metric-icon-box--debt"><FaMoneyBillWave /></div>
                        </div>
                        <h2 className="stat-main-value text-rose-500">KSh {billing.current_debt.toLocaleString()}</h2>
                        <div className="stat-sub-row">
                            <span className="stat-sub-label">Next Cycle</span>
                            <span className="text-[11px] font-bold text-slate-500 uppercase">{formatDate(billing.next_billing_date)}</span>
                        </div>
                    </motion.div>

                    <motion.div variants={itemVariants} className="stat-card-clean">
                        <div className="stat-header">
                            <span className="stat-card-label">Total Settlements</span>
                            <div className="metric-icon-box metric-icon-box--usage"><FaShieldAlt /></div>
                        </div>
                        <h2 className="stat-main-value text-emerald-500">KSh {(billing.total_paid || 0).toLocaleString()}</h2>
                        <div className="stat-sub-row">
                            <span className="stat-sub-label">Historical Pay</span>
                            <span className="text-[11px] font-bold text-slate-500 uppercase">Confirmed</span>
                        </div>
                    </motion.div>

                    <motion.div variants={itemVariants} className="stat-card-clean">
                        <div className="stat-header">
                            <span className="stat-card-label">Telemetry Usage</span>
                            <div className="metric-icon-box metric-icon-box--usage"><FaChartBar /></div>
                        </div>
                        <h2 className="stat-main-value">{(billing.telemetry_usage_mb || 0).toFixed(2)} MB</h2>
                        <div className="stat-sub-row">
                            <span className="stat-sub-label">Integrity</span>
                            <span className="text-[11px] font-bold text-slate-500 uppercase">{readingCount.toLocaleString()} SIGNALS</span>
                        </div>
                    </motion.div>
                </div>

                <div className="billing-main-grid">
                    <motion.div variants={itemVariants} className="ds-card-panel">
                        <div className="card-title-group">
                            <h3 className="card-title-v3"><FaExchangeAlt className="card-title-icon" /> Transaction Ledger</h3>
                            <div className="billing-status-pill">LIVE SYNC</div>
                        </div>
                        <div className="ledger-table-wrapper">
                            {ledgerLoading ? (
                                <div className="flex flex-col items-center justify-center py-20">
                                    <NebulaLoader message="Syncing Ledger" subtitle="Fetching signed settlements..." />
                                </div>
                            ) : transactions.length > 0 ? (
                                <table className="ledger-table-v3">
                                    <thead>
                                        <tr>
                                            <th>Channel</th>
                                            <th>Reference</th>
                                            <th>Amount</th>
                                            <th>Status</th>
                                            <th>Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map((tx, idx) => (
                                            <motion.tr 
                                                key={tx.id} 
                                                variants={itemVariants}
                                                custom={idx}
                                                className="ledger-row-v3"
                                            >
                                                <td>
                                                    <div className="tx-channel-box">
                                                        <div className="tx-icon-v3">{txIcon(tx.payment_method || tx.transaction_type)}</div>
                                                        <span className="font-bold text-xs">{tx.payment_method || tx.transaction_type}</span>
                                                    </div>
                                                </td>
                                                <td className="font-mono text-[10px] text-slate-500 uppercase tracking-tighter">
                                                    {tx.payment_reference || tx.id.slice(0, 8)}
                                                </td>
                                                <td className="font-bold text-slate-700">KSh {tx.amount.toLocaleString()}</td>
                                                <td>
                                                    <span className={`status-pill-v3 status-pill-v3--${(tx.payment_status || 'pending').toLowerCase()}`}>
                                                        {tx.payment_status || 'Pending'}
                                                    </span>
                                                </td>
                                                <td className="text-[11px] text-slate-400 font-medium uppercase">{formatDate(tx.created_at)}</td>
                                            </motion.tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="empty-ledger-v3">
                                    <FaExclamationTriangle size={48} />
                                    <p className="font-bold uppercase tracking-widest text-xs">No Historical Data Found</p>
                                </div>
                            )}
                        </div>
                    </motion.div>

                    <motion.div variants={itemVariants} className="ds-card-panel">
                        <div className="card-title-group">
                            <h3 className="card-title-v3">Settle Liability</h3>
                        </div>
                        <div className="command-center-v3">
                            <AnimatePresence>
                                {payFeedback && (
                                    <motion.div 
                                        initial={{ scale: 0.9, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        exit={{ scale: 0.9, opacity: 0 }}
                                        className={`p-4 rounded-xl text-[11px] font-bold uppercase tracking-widest text-center ${payFeedback.includes('✅') ? 'bg-emerald-50/50 text-emerald-600 border border-emerald-100' : 'bg-rose-50/50 text-rose-600 border border-rose-100'}`}
                                    >
                                        {payFeedback}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div className="saas-input-group">
                                <label className="saas-label-v3">M-Pesa Gateway</label>
                                <div className="relative">
                                    <input type="tel" className="saas-input-v3" value={payPhone} onChange={e => setPayPhone(e.target.value)} placeholder="07XX XXX XXX" />
                                    <FaPhone className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" />
                                </div>
                            </div>

                            <div className="saas-input-group">
                                <label className="saas-label-v3">Settlement Amount</label>
                                <div className="relative">
                                    <input type="number" className="saas-input-v3 saas-input-v3--amount" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" />
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">KES</div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 mt-2">
                                <button onClick={handleStkPush} disabled={paying} className="btn-primary-premium">
                                    {paying ? 'PROCESSING...' : 'STK DIRECT PUSH'} <FiArrowRight />
                                </button>
                                <button onClick={handlePaystackPayment} disabled={paying} className="btn-secondary-premium">
                                    <FaCreditCard /> GLOBAL GATEWAY
                                </button>
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-100 flex items-center gap-4">
                                <FaShieldAlt className="text-emerald-500 text-lg" />
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-bold uppercase text-slate-500">Secured Infrastructure</span>
                                    <span className="text-[9px] text-slate-400 font-medium">END-TO-END ENCRYPTED VIA TLS 1.3</span>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>
        </motion.div>
    );
};

export default BillingPage;
