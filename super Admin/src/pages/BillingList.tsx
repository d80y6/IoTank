import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Layout from '../components/Layout';
import { billingService, RevenueStats, DebtAging } from '../services/billingService';
import { supabase } from '../config/supabase';
import { 
    FiDollarSign, FiActivity, FiAlertCircle, FiPieChart, 
    FiArrowUpRight, FiArrowDownRight, FiClock, FiCheckCircle,
    FiFileText, FiSettings, FiBarChart2, FiCalendar, FiSearch, 
    FiFilter, FiDownload, FiZap, FiChevronLeft, FiChevronRight,
    FiExternalLink, FiLoader, FiPlus, FiX
} from 'react-icons/fi';
import { formatMoney } from '@shared/lib/jurisdiction';
import './BillingList.css';

// Internal Pagination Component (Standardized)
const TablePagination = ({ 
    currentPage, 
    totalItems, 
    pageSize, 
    onPageChange 
}: { 
    currentPage: number, 
    totalItems: number, 
    pageSize: number, 
    onPageChange: (p: number) => void 
}) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);

    return (
        <div className="table-pagination-footer">
            <div className="pagination-info">
                Showing <b>{start}</b> to <b>{end}</b> of <b>{totalItems}</b> entries
            </div>
            <div className="pagination-controls">
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                >
                    <FiChevronLeft /> Previous
                </button>
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next <FiChevronRight />
                </button>
            </div>
        </div>
    );
};

const loadPaymentSettings = () => {
    try {
        const raw = localStorage.getItem('iotank.admin.payment.settings');
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                shortcode: typeof parsed.shortcode === 'string' ? parsed.shortcode : '',
                consumerKey: typeof parsed.consumerKey === 'string' ? parsed.consumerKey : ''
            };
        }
    } catch (error) {
        console.error('Error reading payment settings:', error);
    }
    return { shortcode: '', consumerKey: '' };
};

const notify = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    window.dispatchEvent(new CustomEvent('system-toast', { detail: { title, message, type } }));
};

const downloadCSV = (filename: string, headers: string[], rows: Record<string, unknown>[]) => {
    const escapeCell = (value: unknown) => {
        const s = String(value === null || value === undefined ? '' : value);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(','), ...rows.map(row => headers.map(h => escapeCell(row[h])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};

const BillingList: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'failed' | 'adjustments' | 'usage' | 'invoices' | 'plans' | 'settings' | 'reports'>('dashboard');
    const [stats, setStats] = useState<RevenueStats | null>(null);
    const [aging, setAging] = useState<DebtAging | null>(null);
    const [loading, setLoading] = useState(true);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [failedPayments, setFailedPayments] = useState<any[]>([]);
    const [pendingAdjustments, setPendingAdjustments] = useState<any[]>([]);
    const [adjustments, setAdjustments] = useState<any[]>([]);
    const [usageLogs, setUsageLogs] = useState<any[]>([]);
    const [invoices, setInvoices] = useState<any[]>([]);
    const [detailTx, setDetailTx] = useState<any | null>(null);
    const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
    const [adjStationId, setAdjStationId] = useState('');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjReason, setAdjReason] = useState('');
    const [paymentSettings, setPaymentSettings] = useState(() => loadPaymentSettings());
    const [plans, setPlans] = useState<any[]>([]);
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [plansLoading, setPlansLoading] = useState(false);
    const [draftSettings, setDraftSettings] = useState(() => {
        const saved = loadPaymentSettings();
        return { shortcode: saved.shortcode, consumerKey: saved.consumerKey };
    });
    
    // Controls
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 8;

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [revenueData, agingData, txData, failedData, adjustData, usageData, invoiceData] = await Promise.all([
                billingService.getRevenueDashboard(),
                billingService.getDebtAging(),
                billingService.getTransactions({ status: statusFilter === 'all' ? undefined : statusFilter }),
                billingService.getTransactions({ status: 'failed' }),
                billingService.getTransactions({ type: 'adjustment', status: 'pending' }),
                billingService.getUsageLogs(),
                billingService.getInvoices()
            ]);
            const adjResult = await supabase
                .from('transactions')
                .select('*, station:fuel_stations!inner(station_name)')
                .in('transaction_type', ['adjustment', 'credit', 'refund'])
                .order('created_at', { ascending: false })
                .limit(50);
            setStats(revenueData);
            setAging(agingData);
            setTransactions(txData.data || []);
            setFailedPayments(failedData.data || []);
            setPendingAdjustments(adjustData.data || []);
            setAdjustments(adjResult.data || []);
            setUsageLogs(usageData.data || []);
            setInvoices(invoiceData.data || []);
            const [plansResult, subsResult] = await Promise.all([
                supabase.from('billing_plans').select('*').order('created_at', { ascending: false }),
                supabase.from('billing_subscriptions').select('*, plan:billing_plans(name, amount, currency, interval)').order('created_at', { ascending: false })
            ]);
            setPlans(plansResult.data || []);
            setSubscriptions(subsResult.data || []);
        } catch (error) {
            console.error('Error fetching billing stats:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const formatCurrency = (amount: number) => {
        return formatMoney(amount, { currency: 'USD', currencySymbol: '$', locale: 'en' });
    };

    const getStatusClass = (status: string) => {
        switch (status.toLowerCase()) {
            case 'completed': return 'status--completed';
            case 'pending': return 'status--pending';
            case 'failed': return 'status--failed';
            case 'reversed': return 'status--reversed';
            default: return '';
        }
    };

    const handleExportArchive = () => {
        downloadCSV('iotank-transactions-archive.csv',
            ['id', 'station', 'type', 'amount', 'status', 'method', 'created_at'],
            filteredTransactions.map(tx => ({
                id: tx.id,
                station: tx.station?.station_name || tx.fuel_stations?.station_name || 'System Registry',
                type: tx.transaction_type,
                amount: tx.amount,
                status: tx.payment_status,
                method: tx.payment_method || 'Internal',
                created_at: tx.created_at
            }))
        );
        notify('Archive Exported', `Downloaded ${filteredTransactions.length} transactions as CSV.`, 'success');
    };

    const handleRetryPulse = async () => {
        notify('Retry Pulse Initiated', 'Re-synchronizing the financial pipeline.', 'info');
        await loadAll();
    };

    const handleSubmitAdjustment = async () => {
        const stationId = adjStationId || usageLogs[0]?.station_id;
        const amount = Number(adjAmount);
        if (!stationId) {
            notify('Station Required', 'Select a station for the adjustment.', 'warning');
            return;
        }
        if (!amount || amount <= 0 || !adjReason.trim()) {
            notify('Invalid Adjustment', 'Provide a positive amount and a reason.', 'warning');
            return;
        }
        try {
            const { error } = await supabase.from('transactions').insert({
                station_id: stationId,
                transaction_type: 'adjustment',
                amount,
                description: adjReason.trim(),
                payment_status: 'pending'
            });
            if (error) throw error;
            notify('Adjustment Created', `Recorded an adjustment of ${formatCurrency(amount)}.`, 'success');
            setShowAdjustmentForm(false);
            setAdjAmount('');
            setAdjReason('');
            await loadAll();
        } catch (error) {
            console.error('Error creating adjustment:', error);
            notify('Adjustment Failed', 'Could not record the adjustment. Check the console.', 'error');
        }
    };

    const handleSavePaymentSettings = () => {
        try {
            localStorage.setItem('iotank.admin.payment.settings', JSON.stringify(draftSettings));
            setPaymentSettings(draftSettings);
            notify('Credentials Saved', 'Payment gateway credentials persisted locally.', 'success');
        } catch (error) {
            console.error('Error saving payment settings:', error);
            notify('Save Failed', 'Could not persist payment credentials.', 'error');
        }
    };

    const handleCancelPaymentSettings = () => {
        setDraftSettings({ ...paymentSettings });
        notify('Changes Discarded', 'Payment credentials reverted to last saved values.', 'info');
    };

    const filteredTransactions = useMemo(() => {
        return transactions.filter(tx => 
            tx.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            tx.fuel_stations?.station_name?.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [transactions, searchTerm]);

    const paginatedTransactions = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredTransactions.slice(start, start + pageSize);
    }, [filteredTransactions, currentPage]);

    const renderDashboard = () => (
        <div className="billing-dashboard animate-fade-in">
            <div className="dp-stats-grid">
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob">
                        <FiDollarSign />
                    </div>
                    <div className="stat-content">
                        <label>Daily Liquidity</label>
                        <h3>{formatCurrency(stats?.today || 0)}</h3>
                        <div className="stat-trend up">
                            <FiZap size={10} /> Live synchronization
                        </div>
                    </div>
                </div>

                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#f5f3ff', color: '#8b5cf6' }}>
                        <FiActivity />
                    </div>
                    <div className="stat-content">
                        <label>Weekly Velocity</label>
                        <h3>{formatCurrency(stats?.thisWeek.current || 0)}</h3>
                        <div className={`stat-trend ${(stats?.thisWeek.percentChange || 0) >= 0 ? 'up' : 'down'}`}>
                            {(stats?.thisWeek.percentChange || 0) >= 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
                            {Math.abs(stats?.thisWeek.percentChange || 0).toFixed(1)}% vs. prior
                        </div>
                    </div>
                </div>

                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfdf5', color: '#10b981' }}>
                        <FiCalendar />
                    </div>
                    <div className="stat-content">
                        <label>Monthly Volume</label>
                        <h3>{formatCurrency(stats?.thisMonth.current || 0)}</h3>
                        <div className={`stat-trend ${(stats?.thisMonth.percentChange || 0) >= 0 ? 'up' : 'down'}`}>
                            {(stats?.thisMonth.percentChange || 0) >= 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
                            {Math.abs(stats?.thisMonth.percentChange || 0).toFixed(1)}% vs. prior
                        </div>
                    </div>
                </div>

                <div className="dp-premium-stat-card highlight-card">
                    <div className="stat-icon-blob" style={{ background: '#fffbeb', color: '#f59e0b' }}>
                        <FiBarChart2 />
                    </div>
                    <div className="stat-content">
                        <label>Projected MRR</label>
                        <h3>{formatCurrency(stats?.mrr || 0)}</h3>
                        <div className="stat-trend">
                            ANNUAL: {formatCurrency((stats?.mrr || 0) * 12)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="billing-layout-row">
                <div className="tdv-transaction-table-container flex-[2]">
                    <div className="table-header-toolbar">
                        <div className="table-title">
                            <FiActivity className="text-amber-500" /> Recent Activity Stream
                        </div>
                        <button className="text-[10px] font-black uppercase text-amber-600" onClick={() => setActiveTab('transactions')}>View Full Ledger</button>
                    </div>
                    <table className="tdv-transaction-table">
                        <thead>
                            <tr>
                                <th>Subject</th>
                                <th>Classification</th>
                                <th>Magnitude</th>
                                <th>Channel</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.slice(0, 5).map((tx) => (
                                <tr key={tx.id}>
                                    <td className="font-bold">{tx.fuel_stations?.station_name || 'System Registry'}</td>
                                    <td><span className="text-[10px] font-black uppercase opacity-60">{tx.transaction_type.replace('_', ' ')}</span></td>
                                    <td className="font-black">{formatCurrency(tx.amount)}</td>
                                    <td className="text-[10px] font-bold uppercase">{tx.payment_method || 'Internal'}</td>
                                    <td>
                                        <span className={`status-pill ${getStatusClass(tx.payment_status)}`}>
                                            {tx.payment_status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="debt-aging-box flex-1">
                    <div className="aging-header">
                        <div className="table-title"><FiAlertCircle className="text-rose-500" /> Debt Exposure</div>
                        <span className="text-xl font-black text-rose-600">{formatCurrency(aging?.total || 0)}</span>
                    </div>
                    
                    <div className="aging-item-premium">
                        <label><span>0–15 Days</span> <b>{formatCurrency(aging?.zeroToFifteen.amount || 0)}</b></label>
                        <div className="aging-bar-premium"><div className="aging-fill fill--info" style={{width: `${(aging?.zeroToFifteen.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                    </div>
                    <div className="aging-item-premium">
                        <label><span>16–30 Days</span> <b>{formatCurrency(aging?.sixteenToThirty.amount || 0)}</b></label>
                        <div className="aging-bar-premium"><div className="aging-fill fill--warning" style={{width: `${(aging?.sixteenToThirty.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                    </div>
                    <div className="aging-item-premium">
                        <label><span>31–60 Days</span> <b>{formatCurrency(aging?.thirtyOneToSixty.amount || 0)}</b></label>
                        <div className="aging-bar-premium"><div className="aging-fill fill--orange" style={{width: `${(aging?.thirtyOneToSixty.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                    </div>
                    <div className="aging-item-premium">
                        <label><span>60+ Days</span> <b>{formatCurrency(aging?.sixtyPlus.amount || 0)}</b></label>
                        <div className="aging-bar-premium"><div className="aging-fill fill--danger" style={{width: `${(aging?.sixtyPlus.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderTransactions = () => (
        <div className="transactions-view animate-fade-in">
            <div className="table-header-toolbar !bg-transparent !p-0 !mb-6">
                <div className="header-search-box">
                    <FiSearch className="search-icon" />
                    <input 
                        type="text" 
                        placeholder="Search TXID or Client..." 
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    />
                </div>
                
                <div className="filter-pill-cloud">
                    {['all', 'completed', 'pending', 'failed'].map(s => (
                        <button 
                            key={s} 
                            className={`filter-btn ${statusFilter === s ? 'active' : ''}`}
                            onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            <div className="tdv-transaction-table-container">
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Transaction Ref</th>
                            <th>Timestamp</th>
                            <th>Subject Entity</th>
                            <th>Magnitude</th>
                            <th>Channel</th>
                            <th>Status</th>
                            <th className="text-right">Command</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedTransactions.map((tx) => (
                            <tr key={tx.id}>
                                <td className="font-mono text-[10px] font-black opacity-50">
                                    TX-{tx.id.slice(0,12).toUpperCase()}
                                </td>
                                <td className="text-xs">
                                    <div className="font-black">{new Date(tx.created_at).toLocaleDateString()}</div>
                                    <div className="opacity-50 uppercase text-[9px]">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                </td>
                                <td>
                                    <div className="font-bold">{tx.fuel_stations?.station_name || 'System Registry'}</div>
                                    <div className="text-[10px] opacity-60 uppercase">{tx.transaction_type.replace('_', ' ')}</div>
                                </td>
                                <td className="font-black">{formatCurrency(tx.amount)}</td>
                                <td className="text-[10px] font-bold uppercase opacity-60">{tx.payment_method || 'Internal'}</td>
                                <td>
                                    <span className={`status-pill ${getStatusClass(tx.payment_status)}`}>
                                        {tx.payment_status}
                                    </span>
                                </td>
                                <td className="text-right">
                                    <div className="flex justify-end pr-2">
                                        <button className="action-circle view" title="View Audit" onClick={() => setDetailTx(tx)}>
                                            <FiExternalLink size={16}/>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <TablePagination 
                    currentPage={currentPage}
                    totalItems={filteredTransactions.length}
                    pageSize={pageSize}
                    onPageChange={setCurrentPage}
                />
            </div>
        </div>
    );

    const renderFailedPayments = () => (
        <div className="failed-view animate-fade-in">
            <div className="tdv-transaction-table-container">
                <div className="table-header-toolbar">
                    <div className="table-title"><FiAlertCircle className="text-rose-500" /> Critical Failure Queue</div>
                </div>
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Entity</th>
                            <th>Magnitude</th>
                            <th>Incident Date</th>
                            <th>Incident Diagnostic</th>
                            <th className="text-right">Remediation</th>
                        </tr>
                    </thead>
                    <tbody>
                        {failedPayments.map(tx => (
                            <tr key={tx.id}>
                                <td className="font-bold">{tx.fuel_stations?.station_name}</td>
                                <td className="font-black text-rose-600">{formatCurrency(tx.amount)}</td>
                                <td className="text-xs font-bold">{new Date(tx.created_at).toLocaleDateString()}</td>
                                <td className="text-[10px] italic opacity-60 uppercase font-bold">{tx.description || 'Network timeout / Insufficient funds'}</td>
                                <td className="text-right">
                                    <button className="bg-rose-600 text-white px-3 py-1 rounded-md text-[10px] font-black uppercase" onClick={handleRetryPulse}>Retry Pulse</button>
                                </td>
                            </tr>
                        ))}
                        {failedPayments.length === 0 && (
                            <tr><td colSpan={5} className="py-20 text-center text-xs font-bold opacity-30 uppercase tracking-widest">Financial pipeline stabilized (No failures)</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderAdjustmentsContent = () => (
        <div className="adjustments-view animate-fade-in">
            <div className="tdv-transaction-table-container">
                <div className="table-header-toolbar">
                    <div className="table-title"><FiSettings className="text-amber-500" /> Adjustment Register</div>
                </div>
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Reference</th>
                            <th>Station</th>
                            <th>Magnitude</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Timestamp</th>
                        </tr>
                    </thead>
                    <tbody>
                        {adjustments.map(tx => (
                            <tr key={tx.id}>
                                <td className="font-mono text-[10px] font-black opacity-50">ADJ-{tx.id.slice(0, 12).toUpperCase()}</td>
                                <td className="font-bold">{tx.station?.station_name || 'System Registry'}</td>
                                <td className="font-black">{tx.amount >= 0 ? '' : '-'}{formatCurrency(Math.abs(tx.amount))}</td>
                                <td className="text-[10px] font-black uppercase opacity-60">{tx.transaction_type.replace('_', ' ')}</td>
                                <td>
                                    <span className={`status-pill ${getStatusClass(tx.payment_status)}`}>
                                        {tx.payment_status}
                                    </span>
                                </td>
                                <td className="text-xs">
                                    <div className="font-bold">{new Date(tx.created_at).toLocaleDateString()}</div>
                                    <div className="opacity-50 uppercase text-[9px]">{new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                </td>
                            </tr>
                        ))}
                        {adjustments.length === 0 && (
                            <tr><td colSpan={6} className="py-20 text-center text-xs font-bold opacity-30 uppercase tracking-widest">No adjustment activity recorded</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderUsageContent = () => (
        <div className="usage-view animate-fade-in">
            <div className="tdv-transaction-table-container">
                <div className="table-header-toolbar">
                    <div className="table-title"><FiActivity className="text-amber-500" /> Usage & Debt Ledger</div>
                </div>
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Station</th>
                            <th>Current Debt</th>
                            <th>Account Status</th>
                            <th>Last Payment</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {usageLogs.map(log => (
                            <tr key={log.station_id || log.id}>
                                <td className="font-bold">{log.station_name}</td>
                                <td className="font-black">{formatCurrency(log.current_debt || 0)}</td>
                                <td>
                                    <span className={`status-pill ${getStatusClass(log.account_status || 'active')}`}>
                                        {log.account_status || 'active'}
                                    </span>
                                </td>
                                <td className="text-xs font-bold">{log.last_payment_date ? new Date(log.last_payment_date).toLocaleDateString() : '—'}</td>
                                <td className="text-xs font-bold">{log.created_at ? new Date(log.created_at).toLocaleDateString() : '—'}</td>
                            </tr>
                        ))}
                        {usageLogs.length === 0 && (
                            <tr><td colSpan={5} className="py-20 text-center text-xs font-bold opacity-30 uppercase tracking-widest">No usage metrics detected</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderInvoicesContent = () => (
        <div className="invoices-view animate-fade-in">
            <div className="tdv-transaction-table-container">
                <div className="table-header-toolbar">
                    <div className="table-title"><FiFileText className="text-amber-500" /> Official Invoicing Ledger</div>
                </div>
                <table className="tdv-transaction-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Station</th>
                            <th>Magnitude</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Due Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map(inv => (
                            <tr key={inv.id}>
                                <td className="font-mono text-[10px] font-black opacity-50">{inv.invoice_number || inv.id.slice(0, 12)}</td>
                                <td className="font-bold">{inv.station?.station_name || 'System Registry'}</td>
                                <td className="font-black">{formatCurrency(inv.amount_due || 0)}</td>
                                <td>
                                    <span className={`status-pill ${getStatusClass(inv.status)}`}>
                                        {inv.status}
                                    </span>
                                </td>
                                <td className="text-xs font-bold">{new Date(inv.created_at || inv.billing_period_start).toLocaleDateString()}</td>
                                <td className="text-xs font-bold">{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}</td>
                            </tr>
                        ))}
                        {invoices.length === 0 && (
                            <tr><td colSpan={6} className="py-20 text-center text-xs font-bold opacity-30 uppercase tracking-widest">No invoices generated for the current cycle</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderReportsContent = () => (
        <div className="reports-view animate-fade-in">
            <div className="dp-stats-grid">
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob"><FiDollarSign /></div>
                    <div className="stat-content">
                        <label>Today</label>
                        <h3>{formatCurrency(stats?.today || 0)}</h3>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#f5f3ff', color: '#8b5cf6' }}><FiActivity /></div>
                    <div className="stat-content">
                        <label>This Week</label>
                        <h3>{formatCurrency(stats?.thisWeek.current || 0)}</h3>
                        <div className={`stat-trend ${(stats?.thisWeek.percentChange || 0) >= 0 ? 'up' : 'down'}`}>
                            {(stats?.thisWeek.percentChange || 0) >= 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
                            {Math.abs(stats?.thisWeek.percentChange || 0).toFixed(1)}% vs. prior
                        </div>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#ecfdf5', color: '#10b981' }}><FiCalendar /></div>
                    <div className="stat-content">
                        <label>This Month</label>
                        <h3>{formatCurrency(stats?.thisMonth.current || 0)}</h3>
                        <div className={`stat-trend ${(stats?.thisMonth.percentChange || 0) >= 0 ? 'up' : 'down'}`}>
                            {(stats?.thisMonth.percentChange || 0) >= 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
                            {Math.abs(stats?.thisMonth.percentChange || 0).toFixed(1)}% vs. prior
                        </div>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#eff6ff', color: '#3b82f6' }}><FiBarChart2 /></div>
                    <div className="stat-content">
                        <label>This Year</label>
                        <h3>{formatCurrency(stats?.thisYear || 0)}</h3>
                    </div>
                </div>
                <div className="dp-premium-stat-card">
                    <div className="stat-icon-blob" style={{ background: '#fdf2f8', color: '#db2777' }}><FiClock /></div>
                    <div className="stat-content">
                        <label>MRR</label>
                        <h3>{formatCurrency(stats?.mrr || 0)}</h3>
                    </div>
                </div>
                <div className="dp-premium-stat-card highlight-card">
                    <div className="stat-icon-blob" style={{ background: '#fffbeb', color: '#f59e0b' }}><FiPieChart /></div>
                    <div className="stat-content">
                        <label>ARR</label>
                        <h3>{formatCurrency(stats?.arr || 0)}</h3>
                        <div className="stat-trend up">
                            <FiZap size={10} /> Annualized projection
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderSettingsContent = () => (
        <div className="settings-view animate-fade-in">
            <div className="max-w-lg bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <div className="table-title mb-1"><FiSettings className="text-amber-500" /> Payment Credentials</div>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-6">Provider shortcode & consumer key</p>
                <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl text-[10px] font-bold text-amber-700">
                    These credentials are stored locally in this admin console and require server-side provisioning to take effect.
                </div>
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Shortcode / Paybill</label>
                        <input
                            type="text"
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500"
                            value={draftSettings.shortcode}
                            onChange={(e) => setDraftSettings({ ...draftSettings, shortcode: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Consumer Key</label>
                        <input
                            type="password"
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500"
                            value={draftSettings.consumerKey}
                            onChange={(e) => setDraftSettings({ ...draftSettings, consumerKey: e.target.value })}
                        />
                    </div>
                </div>
                <div className="flex gap-3">
                    <button className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition-all shadow-md shadow-amber-500/20" onClick={handleSavePaymentSettings}>
                        Save Credentials
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all" onClick={handleCancelPaymentSettings}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );

    const renderPlansContent = () => (
        <div className="plans-content animate-fade-in space-y-8">
            <div className="tdv-transaction-table-container">
                <div className="table-header-toolbar">
                    <div className="table-title">Billing Plans (billing_plans)</div>
                </div>
                <table className="tdv-transaction-table">
                    <thead>
                        <tr><th>Station</th><th>Plan</th><th>Amount</th><th>Currency</th><th>Interval</th><th>Description</th><th>Created</th></tr>
                    </thead>
                    <tbody>
                        {plans.map((p) => (
                            <tr key={p.id}>
                                <td className="font-mono text-[10px] opacity-60">{p.station_id?.slice(0, 8)}…</td>
                                <td className="font-bold">{p.name}</td>
                                <td className="font-black">{p.amount ?? '—'}</td>
                                <td>{p.currency || '—'}</td>
                                <td className="uppercase text-[10px] font-black">{p.interval || '—'}</td>
                                <td className="text-xs text-slate-500 max-w-[260px] truncate">{p.description || '—'}</td>
                                <td className="font-mono text-[10px]">{p.paystack_plan_code || p.created_at?.slice(0, 10)}</td>
                            </tr>
                        ))}
                        {plans.length === 0 && (
                            <tr><td colSpan={7} className="py-12 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">No billing plans registered</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="tdv-transaction-table-container">
                <div className="table-header-toolbar">
                    <div className="table-title">Active Subscriptions (billing_subscriptions)</div>
                </div>
                <table className="tdv-transaction-table">
                    <thead>
                        <tr><th>Station</th><th>Plan</th><th>Amount</th><th>Status</th><th>Next Payment</th><th>Paystack Code</th></tr>
                    </thead>
                    <tbody>
                        {subscriptions.map((s) => (
                            <tr key={s.id}>
                                <td className="font-mono text-[10px] opacity-60">{s.station_id?.slice(0, 8)}…</td>
                                <td className="font-bold">{(s.plan as any)?.name || s.plan_id?.slice(0, 8)}</td>
                                <td className="font-black">{(s.plan as any)?.amount ?? '—'} {(s.plan as any)?.currency || ''}</td>
                                <td><span className={`badge ${s.status === 'active' ? 'badge-blue' : 'badge-red'}`}>{s.status || '—'}</span></td>
                                <td className="font-mono text-[10px]">{s.next_payment_date ? new Date(s.next_payment_date).toLocaleDateString() : '—'}</td>
                                <td className="font-mono text-[10px]">{s.paystack_subscription_code || '—'}</td>
                            </tr>
                        ))}
                        {subscriptions.length === 0 && (
                            <tr><td colSpan={6} className="py-12 text-center text-[10px] font-black uppercase text-slate-300 tracking-widest">No active subscriptions found</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <Layout>
            <div className="billing-page">
                <header className="dp-header">
                    <div className="dp-title-group">
                        <h1 className="lowercase">clients and billing</h1>
                        <div className="dp-subtitle">Consolidated Financial Hub & Usage Monitoring</div>
                    </div>
                    
                    <div className="dp-header-actions">
                        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all" onClick={handleExportArchive}>
                            <FiDownload /> Export Archive
                        </button>
                        <button className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition-all shadow-md shadow-amber-500/20" onClick={() => setShowAdjustmentForm(prev => !prev)}>
                            <FiPlus /> New Adjustment
                        </button>
                    </div>

                    {showAdjustmentForm && (
                        <div className="bg-white border border-amber-200 rounded-3xl p-6 shadow-sm mb-6 animate-fade-in">
                            <div className="flex items-center justify-between mb-5">
                                <div className="table-title"><FiPlus className="text-amber-500" /> New Adjustment</div>
                                <button className="action-circle view" title="Close" onClick={() => setShowAdjustmentForm(false)}>
                                    <FiX size={16} />
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Station</label>
                                    <select
                                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500 bg-white"
                                        value={adjStationId || (usageLogs[0]?.station_id ?? '')}
                                        onChange={(e) => setAdjStationId(e.target.value)}
                                    >
                                        {usageLogs.map((log) => (
                                            <option key={log.station_id} value={log.station_id}>{log.station_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Amount</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0.00"
                                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500"
                                        value={adjAmount}
                                        onChange={(e) => setAdjAmount(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Reason</label>
                                    <input
                                        type="text"
                                        placeholder="Adjustment rationale..."
                                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-500"
                                        value={adjReason}
                                        onChange={(e) => setAdjReason(e.target.value)}
                                    />
                                </div>
                            </div>
                            <button className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition-all shadow-md shadow-amber-500/20" onClick={handleSubmitAdjustment}>
                                <FiPlus /> Record Adjustment
                            </button>
                        </div>
                    )}
                </header>

                <div className="billing-tabs-container">
                    {[
                        { id: 'dashboard', label: 'Overview' },
                        { id: 'transactions', label: 'Transactions' },
                        { id: 'failed', label: 'Failed Payments' },
                        { id: 'adjustments', label: 'Adjustments' },
                        { id: 'usage', label: 'Usage tracking' },
                        { id: 'invoices', label: 'Invoices' },
                        { id: 'plans', label: 'Plans & Subs' },
                        { id: 'settings', label: 'Gateways' },
                        { id: 'reports', label: 'Reports' }
                    ].map(tab => (
                        <button 
                            key={tab.id}
                            className={`billing-tab-btn ${activeTab === tab.id ? 'active' : ''}`} 
                            onClick={() => setActiveTab(tab.id as any)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-40">
                        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Synchronizing financial logic...</p>
                    </div>
                ) : (
                    <>
                        {activeTab === 'dashboard' && renderDashboard()}
                        {activeTab === 'transactions' && renderTransactions()}
                        {activeTab === 'failed' && renderFailedPayments()}
                        {activeTab === 'adjustments' && renderAdjustmentsContent()}
                        {activeTab === 'usage' && renderUsageContent()}
                        {activeTab === 'invoices' && renderInvoicesContent()}
                        {activeTab === 'plans' && renderPlansContent()}
                        {activeTab === 'settings' && renderSettingsContent()}
                        {activeTab === 'reports' && renderReportsContent()}
                    </>
                )}
            </div>

            {detailTx && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setDetailTx(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Transaction Audit</h3>
                            <button className="action-circle view" title="Close" onClick={() => setDetailTx(null)}>
                                <FiX size={16} />
                            </button>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reference</span><b className="font-mono">TX-{detailTx.id.slice(0, 12).toUpperCase()}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Station</span><b>{detailTx.station?.station_name || detailTx.fuel_stations?.station_name || 'System Registry'}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Type</span><b className="uppercase">{detailTx.transaction_type?.replace('_', ' ')}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Amount</span><b>{formatCurrency(detailTx.amount)}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Channel</span><b className="uppercase">{detailTx.payment_method || 'Internal'}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</span><b>{detailTx.payment_status}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reference No</span><b className="font-mono text-xs">{detailTx.payment_reference || '—'}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Created</span><b>{new Date(detailTx.created_at).toLocaleString()}</b></div>
                            <div className="flex justify-between"><span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description</span><b className="text-right">{detailTx.description || '—'}</b></div>
                        </div>
                    </div>
                </div>
            )}
        </Layout>
    );
};

export default BillingList;
