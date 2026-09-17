import React, { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout';
import { billingService, RevenueStats, DebtAging } from '../services/billingService';
import { supabase } from '../config/supabase';
import { formatMoney } from '@shared/lib/jurisdiction';
import { 
    FiDollarSign, FiActivity, FiAlertCircle, FiPieChart, 
    FiArrowUpRight, FiArrowDownRight, FiClock, FiCheckCircle,
    FiFileText, FiSettings, FiBarChart2, FiCalendar, FiSearch, FiFilter, FiX
} from 'react-icons/fi';
import './BillingPage.css';

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

const readPaymentSettings = (): Record<string, string> => {
    try {
        const raw = localStorage.getItem('iotank.admin.payment.settings');
        if (raw) {
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        }
    } catch (error) {
        console.error('Error reading payment settings:', error);
    }
    return {};
};

const BillingPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'failed' | 'adjustments' | 'usage' | 'invoices' | 'settings' | 'reports'>('dashboard');
    const [stats, setStats] = useState<RevenueStats | null>(null);
    const [aging, setAging] = useState<DebtAging | null>(null);
    const [loading, setLoading] = useState(true);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [failedPayments, setFailedPayments] = useState<any[]>([]);
    const [pendingAdjustments, setPendingAdjustments] = useState<any[]>([]);
    const [usageLogs, setUsageLogs] = useState<any[]>([]);
    const [invoices, setInvoices] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [showMoreFilters, setShowMoreFilters] = useState(false);
    const [methodFilter, setMethodFilter] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [detailTx, setDetailTx] = useState<any | null>(null);
    const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
    const [adjStationId, setAdjStationId] = useState('');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjReason, setAdjReason] = useState('');
    const [bulkRetrying, setBulkRetrying] = useState(false);
    const mpesaShortcodeRef = useRef<HTMLInputElement>(null);
    const mpesaKeyRef = useRef<HTMLInputElement>(null);
    const bankAccountRef = useRef<HTMLInputElement>(null);
    const bankSwiftRef = useRef<HTMLInputElement>(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [revenueData, agingData, txData, failedData, adjustData, usageData, invoiceData] = await Promise.all([
                billingService.getRevenueDashboard(),
                billingService.getDebtAging(),
                billingService.getTransactions({ status: statusFilter, type: typeFilter }),
                billingService.getTransactions({ status: 'failed' }),
                billingService.getTransactions({ type: 'adjustment', status: 'pending' }),
                billingService.getUsageLogs(),
                billingService.getInvoices()
            ]);
            setStats(revenueData);
            setAging(agingData);
            setTransactions(txData.data || []);
            setFailedPayments(failedData.data || []);
            setPendingAdjustments(adjustData.data || []);
            setUsageLogs(usageData.data || []);
            setInvoices(invoiceData.data || []);
        } catch (error) {
            console.error('Error fetching billing stats:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, typeFilter]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const filteredTransactions = React.useMemo(() => {
        return transactions.filter(tx => {
            const station = (tx.station?.station_name || tx.fuel_stations?.station_name || '').toLowerCase();
            const matchesSearch = tx.id.includes(searchTerm) || station.includes(searchTerm.toLowerCase());
            const matchesMethod = !methodFilter || String(tx.payment_method || '').toLowerCase() === methodFilter.toLowerCase();
            const matchesMin = minAmount === '' || Number(tx.amount) >= Number(minAmount);
            const matchesMax = maxAmount === '' || Number(tx.amount) <= Number(maxAmount);
            return matchesSearch && matchesMethod && matchesMin && matchesMax;
        });
    }, [transactions, searchTerm, methodFilter, minAmount, maxAmount]);

    const formatCurrency = (amount: number) => {
        return formatMoney(amount, { currency: 'USD', currencySymbol: '$', locale: 'en' });
    };

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'completed': return 'bg-success-soft text-success';
            case 'pending': return 'bg-warning-soft text-warning';
            case 'failed': return 'bg-danger-soft text-danger';
            case 'reversed': return 'bg-purple-soft text-purple';
            default: return 'bg-secondary-soft text-secondary';
        }
    };

    const exportTransactionsCSV = (filename: string, txs: any[]) => {
        downloadCSV(filename,
            ['id', 'station', 'type', 'amount', 'status', 'method', 'created_at'],
            txs.map((tx: any) => ({
                id: tx.id,
                station: tx.station?.station_name || tx.fuel_stations?.station_name || 'System',
                type: tx.transaction_type,
                amount: tx.amount,
                status: tx.payment_status,
                method: tx.payment_method || 'N/A',
                created_at: tx.created_at
            }))
        );
    };

    const handleBulkRetryAll = async () => {
        setBulkRetrying(true);
        try {
            const { data } = await billingService.getTransactions({ status: 'failed' });
            const failed = data || [];
            const ids = failed.map((tx: any) => tx.id);
            if (ids.length > 0) {
                const { error } = await supabase
                    .from('transactions')
                    .update({ payment_status: 'pending', updated_at: new Date().toISOString() })
                    .in('id', ids)
                    .eq('payment_status', 'failed');
                if (error) throw error;
            }
            const refreshed = await billingService.getTransactions({ status: 'failed' });
            setFailedPayments(refreshed.data || []);
            notify('Bulk Retry Complete', `${ids.length} failed payment(s) re-queued for processing.`, 'success');
            await loadAll();
        } catch (error) {
            console.error('Error retrying failed payments:', error);
            notify('Bulk Retry Failed', 'Could not re-queue the failure pipeline.', 'error');
        } finally {
            setBulkRetrying(false);
        }
    };

    const handleRetryNow = async (tx: any) => {
        try {
            const { error } = await supabase
                .from('transactions')
                .update({ payment_status: 'pending', updated_at: new Date().toISOString() })
                .eq('id', tx.id)
                .eq('payment_status', 'failed');
            if (error) throw error;
            setFailedPayments(prev => prev.filter(p => p.id !== tx.id));
            notify('Retry Dispatched', `Payment for ${tx.station?.station_name || 'station'} re-queued for processing.`, 'success');
            await loadAll();
        } catch (error) {
            console.error('Error retrying payment:', error);
            notify('Retry Failed', 'Could not re-queue this payment.', 'error');
        }
    };

    const handleContactStation = async (tx: any) => {
        let email = '';
        if (tx.station_id) {
            const { data } = await supabase.from('fuel_stations').select('email').eq('station_id', tx.station_id).single();
            email = (data as any)?.email || '';
        }
        if (email) {
            const subject = encodeURIComponent('IoTank Payment Failure');
            const body = encodeURIComponent(`The ${formatCurrency(tx.amount)} payment for ${tx.station?.station_name || 'your station'} failed. Please review.`);
            window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
        } else {
            notify('No Contact Found', 'Could not resolve a contact email for this station.', 'warning');
        }
    };

    const handleAdjustmentDecision = async (adjId: string, status: 'completed' | 'reversed') => {
        try {
            const { error } = await supabase.from('transactions').update({ payment_status: status }).eq('id', adjId);
            if (error) throw error;
            notify('Adjustment Updated', `Adjustment ${adjId.slice(0, 8).toUpperCase()} marked as ${status}.`, 'success');
            await loadAll();
        } catch (error) {
            console.error('Error updating adjustment:', error);
            notify('Update Failed', 'Could not update the adjustment status.', 'error');
        }
    };

    const handleUpdateCredentials = () => {
        try {
            const settings = {
                ...readPaymentSettings(),
                shortcode: mpesaShortcodeRef.current?.value || '',
                consumerKey: mpesaKeyRef.current?.value || ''
            };
            localStorage.setItem('iotank.admin.payment.settings', JSON.stringify(settings));
            notify('Credentials Updated', 'Payment gateway credentials persisted locally.', 'success');
        } catch (error) {
            console.error('Error updating credentials:', error);
            notify('Update Failed', 'Could not persist the credentials.', 'error');
        }
    };

    const handleUpdateDetails = () => {
        try {
            const settings = {
                ...readPaymentSettings(),
                bankAccount: bankAccountRef.current?.value || '',
                bankSwift: bankSwiftRef.current?.value || ''
            };
            localStorage.setItem('iotank.admin.payment.settings', JSON.stringify(settings));
            notify('Details Updated', 'Bank transfer details persisted locally.', 'success');
        } catch (error) {
            console.error('Error updating details:', error);
            notify('Update Failed', 'Could not persist the bank details.', 'error');
        }
    };

    const handleReportExport = (label: string) => {
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (label.includes('Revenue')) {
            downloadCSV(`iotank-${slug}.csv`,
                ['metric', 'amount'],
                [
                    { metric: 'Today', amount: stats?.today || 0 },
                    { metric: 'This Week', amount: stats?.thisWeek.current || 0 },
                    { metric: 'This Month', amount: stats?.thisMonth.current || 0 },
                    { metric: 'This Year', amount: stats?.thisYear || 0 },
                    { metric: 'Monthly Recurring Revenue', amount: stats?.mrr || 0 },
                    { metric: 'Annual Recurring Revenue', amount: stats?.arr || (stats?.mrr || 0) * 12 }
                ]);
            notify('Report Exported', 'Revenue summary CSV generated.', 'success');
            return;
        }
        if (label.includes('Debt')) {
            downloadCSV(`iotank-${slug}.csv`,
                ['bucket', 'amount', 'count'],
                [
                    { bucket: '0-15 Days', amount: aging?.zeroToFifteen.amount || 0, count: aging?.zeroToFifteen.count || 0 },
                    { bucket: '16-30 Days', amount: aging?.sixteenToThirty.amount || 0, count: aging?.sixteenToThirty.count || 0 },
                    { bucket: '31-60 Days', amount: aging?.thirtyOneToSixty.amount || 0, count: aging?.thirtyOneToSixty.count || 0 },
                    { bucket: '60+ Days', amount: aging?.sixtyPlus.amount || 0, count: aging?.sixtyPlus.count || 0 },
                    { bucket: 'Total Outstanding', amount: aging?.total || 0, count: 0 }
                ]);
            notify('Report Exported', 'Debt aging CSV generated.', 'success');
            return;
        }
        if (label.includes('Tax') || label.includes('Reconciliation')) {
            const taxRows = transactions.filter(tx => ['charge', 'payment', 'usage_charge'].includes(tx.transaction_type) && tx.payment_status === 'completed');
            exportTransactionsCSV(`iotank-${slug}.csv`, taxRows);
            notify('Report Exported', `Reconciliation CSV generated from ${taxRows.length} settled transactions.`, 'success');
            return;
        }
        exportTransactionsCSV(`iotank-${slug}.csv`, transactions);
        notify('Report Exported', `Generated a CSV of ${transactions.length} transactions.`, 'success');
    };

    const handleViewInvoice = (inv: any) => {
        if (inv.pdf_url) {
            window.open(inv.pdf_url, '_blank', 'noopener,noreferrer');
            return;
        }
        downloadCSV(`invoice-${(inv.invoice_number || inv.id || 'statement').toString().replace(/[^a-z0-9]+/gi, '-')}.csv`,
            ['invoice_number', 'client', 'period_start', 'period_end', 'amount_due', 'amount_paid', 'status', 'due_date'],
            [{
                invoice_number: inv.invoice_number,
                client: inv.station?.station_name || '',
                period_start: inv.billing_period_start,
                period_end: inv.billing_period_end,
                amount_due: inv.amount_due,
                amount_paid: inv.amount_paid,
                status: inv.status,
                due_date: inv.due_date
            }]);
        notify('Invoice Exported', `Invoice ${inv.invoice_number} exported as CSV.`, 'success');
    };

    const handleSendInvoiceReminder = async (inv: any) => {
        try {
            const { error } = await supabase
                .from('invoices')
                .update({ status: 'overdue', updated_at: new Date().toISOString() })
                .eq('id', inv.id)
                .in('status', ['unpaid', 'partially_paid']);
            if (error) throw error;
            notify('Reminder Sent', `Payment reminder issued for invoice ${inv.invoice_number}.`, 'success');
            await loadAll();
        } catch (error) {
            console.error('Error sending reminder:', error);
            notify('Reminder Failed', 'Could not dispatch the invoice reminder.', 'error');
        }
    };

    const handleDownloadReceipt = (tx: any) => {
        downloadCSV(`receipt-${tx.id.slice(0, 8).toUpperCase()}.csv`,
            ['id', 'station', 'type', 'amount', 'status', 'method', 'created_at', 'description'],
            [{
                id: tx.id,
                station: tx.station?.station_name || tx.fuel_stations?.station_name || 'System',
                type: tx.transaction_type,
                amount: tx.amount,
                status: tx.payment_status,
                method: tx.payment_method || 'N/A',
                created_at: tx.created_at,
                description: tx.description || ''
            }]
        );
        notify('Receipt Downloaded', `Receipt for ${tx.id.slice(0, 8).toUpperCase()} saved as CSV.`, 'success');
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

    const renderDashboard = () => (
        <div className="billing-dashboard animate-fade-in">
            {/* 4.1 Key Metrics */}
            <div className="metrics-grid">
                <div className="metric-card glass-card">
                    <div className="metric-icon-box bg-cyan-soft">
                        <FiDollarSign className="icon-cyan" />
                    </div>
                    <div className="metric-info">
                        <span className="metric-label">Today's Revenue</span>
                        <h3 className="metric-value">{formatCurrency(stats?.today || 0)}</h3>
                        <span className="metric-subtext">Real-time update</span>
                    </div>
                </div>

                <div className="metric-card glass-card">
                    <div className="metric-icon-box bg-purple-soft">
                        <FiActivity className="icon-purple" />
                    </div>
                    <div className="metric-info">
                        <span className="metric-label">This Week</span>
                        <h3 className="metric-value">{formatCurrency(stats?.thisWeek.current || 0)}</h3>
                        <div className={`trend-indicator ${(stats?.thisWeek.percentChange || 0) >= 0 ? 'trend-up' : 'trend-down'}`}>
                            {(stats?.thisWeek.percentChange || 0) >= 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
                            <span>{Math.abs(stats?.thisWeek.percentChange || 0).toFixed(1)}% vs last week</span>
                        </div>
                    </div>
                </div>

                <div className="metric-card glass-card">
                    <div className="metric-icon-box bg-blue-soft">
                        <FiCalendar className="icon-blue" />
                    </div>
                    <div className="metric-info">
                        <span className="metric-label">This Month</span>
                        <h3 className="metric-value">{formatCurrency(stats?.thisMonth.current || 0)}</h3>
                        <div className={`trend-indicator ${(stats?.thisMonth.percentChange || 0) >= 0 ? 'trend-up' : 'trend-down'}`}>
                            {(stats?.thisMonth.percentChange || 0) >= 0 ? <FiArrowUpRight /> : <FiArrowDownRight />}
                            <span>{Math.abs(stats?.thisMonth.percentChange || 0).toFixed(1)}% vs last month</span>
                        </div>
                    </div>
                </div>

                <div className="metric-card glass-card highlight-card">
                    <div className="metric-icon-box bg-amber-soft">
                        <FiArrowUpRight className="icon-amber" />
                    </div>
                    <div className="metric-info">
                        <span className="metric-label">Monthly Recurring Revenue</span>
                        <h3 className="metric-value">{formatCurrency(stats?.mrr || 0)}</h3>
                        <span className="metric-subtext">ARR: {formatCurrency((stats?.mrr || 0) * 12)}</span>
                    </div>
                    <div className="card-shine"></div>
                </div>
            </div>

            {/* Revenue Breakdown & Debt Aging */}
            <div className="dashboard-row mt-8">
                <div className="chart-container glass-card flex-[2]">
                    <div className="section-header">
                        <FiPieChart className="mr-2" />
                        <h4>Revenue Breakdown</h4>
                    </div>
                    <div className="chart-placeholder">
                        <div className="flex flex-col justify-center gap-6 h-48 px-2">
                            {[
                                { label: 'This Week', value: stats?.thisWeek.current || 0, barClass: 'bg-info' },
                                { label: 'This Month', value: stats?.thisMonth.current || 0, barClass: 'bg-warning' },
                                { label: 'This Year', value: stats?.thisYear || 0, barClass: 'bg-orange' }
                            ].map(item => {
                                const max = Math.max(stats?.thisYear || 0, stats?.thisMonth.current || 0, stats?.thisWeek.current || 0, 1);
                                const pct = max > 0 ? Math.round(((item.value || 0) / max) * 100) : 0;
                                return (
                                    <div key={item.label} className="flex items-center gap-3">
                                        <span className="method-item w-24 shrink-0">{item.label}</span>
                                        <div className="aging-bar-bg flex-1">
                                            <div className={`aging-bar ${item.barClass}`} style={{ width: `${pct}%` }}></div>
                                        </div>
                                        <b className="text-xs shrink-0">{formatCurrency(item.value || 0)}</b>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="debt-container glass-card flex-1">
                    <div className="section-header">
                        <FiAlertCircle className="mr-2 icon-danger" />
                        <h4>Outstanding Debt Summary</h4>
                    </div>
                    
                    <div className="debt-total-box">
                        <span className="total-label">Total Outstanding</span>
                        <h2 className="total-value text-danger">{formatCurrency(aging?.total || 0)}</h2>
                    </div>

                    <div className="aging-list">
                        <div className="aging-item">
                            <div className="aging-meta">
                                <span>0–15 Days</span>
                                <b>{formatCurrency(aging?.zeroToFifteen.amount || 0)}</b>
                            </div>
                            <div className="aging-bar-bg"><div className="aging-bar bg-info" style={{width: `${(aging?.zeroToFifteen.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                        </div>
                        <div className="aging-item warning">
                            <div className="aging-meta">
                                <span>16–30 Days</span>
                                <b>{formatCurrency(aging?.sixteenToThirty.amount || 0)}</b>
                            </div>
                            <div className="aging-bar-bg"><div className="aging-bar bg-warning" style={{width: `${(aging?.sixteenToThirty.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                        </div>
                        <div className="aging-item orange">
                            <div className="aging-meta">
                                <span>31–60 Days</span>
                                <b>{formatCurrency(aging?.thirtyOneToSixty.amount || 0)}</b>
                            </div>
                            <div className="aging-bar-bg"><div className="aging-bar bg-orange" style={{width: `${(aging?.thirtyOneToSixty.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                        </div>
                        <div className="aging-item critical">
                            <div className="aging-meta">
                                <span>60+ Days</span>
                                <b>{formatCurrency(aging?.sixtyPlus.amount || 0)}</b>
                            </div>
                            <div className="aging-bar-bg"><div className="aging-bar bg-danger" style={{width: `${(aging?.sixtyPlus.amount || 0) / (aging?.total || 1) * 100}%`}}></div></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderTransactions = () => (
        <div className="transactions-view animate-fade-in">
            {/* 4.2 Search & Filter */}
            <div className="filter-bar glass-card mb-6">
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="search-input-wrapper flex-1">
                        <FiSearch className="search-icon" />
                        <input 
                            type="text" 
                            placeholder="Search by Transaction ID or Client Name..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="billing-search-input"
                        />
                    </div>
                    
                    <select 
                        className="billing-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="">All Statuses</option>
                        <option value="completed">Completed</option>
                        <option value="pending">Pending</option>
                        <option value="failed">Failed</option>
                        <option value="reversed">Reversed</option>
                    </select>

                    <select 
                        className="billing-select"
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                    >
                        <option value="">All Types</option>
                        <option value="charge">Subscription Charge</option>
                        <option value="usage_charge">Usage Charge</option>
                        <option value="payment">Payment</option>
                        <option value="refund">Refund</option>
                        <option value="adjustment">Adjustment</option>
                    </select>

                    <button className="btn-secondary flex items-center gap-2" onClick={() => setShowMoreFilters(prev => !prev)}>
                        <FiFilter /> More Filters
                    </button>
                </div>
                {showMoreFilters && (
                    <div className="flex flex-wrap gap-4 items-center mt-4 pt-4 border-t border-white/5 animate-fade-in">
                        <select
                            className="billing-select"
                            value={methodFilter}
                            onChange={(e) => setMethodFilter(e.target.value)}
                        >
                            <option value="">All Methods</option>
                            <option value="mpesa">M-Pesa</option>
                            <option value="paystack">Paystack</option>
                            <option value="cash">Cash</option>
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="airtel_money">Airtel Money</option>
                        </select>
                        <div className="flex items-center gap-2">
                            <span className="text-xs opacity-60 font-bold uppercase">Min</span>
                            <input
                                type="number"
                                min="0"
                                placeholder="0"
                                value={minAmount}
                                onChange={(e) => setMinAmount(e.target.value)}
                                className="billing-select w-28"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs opacity-60 font-bold uppercase">Max</span>
                            <input
                                type="number"
                                min="0"
                                placeholder="∞"
                                value={maxAmount}
                                onChange={(e) => setMaxAmount(e.target.value)}
                                className="billing-select w-28"
                            />
                        </div>
                        <button className="btn-secondary text-xs" onClick={() => {
                            setMethodFilter('');
                            setMinAmount('');
                            setMaxAmount('');
                        }}>Clear Filters</button>
                    </div>
                )}
            </div>

            {/* Transactions Table */}
            <div className="glass-card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="billing-table">
                        <thead>
                            <tr>
                                <th>Transaction Ref</th>
                                <th>Date/Time</th>
                                <th>Client / Station</th>
                                <th>Type</th>
                                <th>Amount</th>
                                <th>Method</th>
                                <th>Status</th>
                                <th className="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTransactions.map((tx) => (
                                <tr key={tx.id}>
                                    <td className="font-mono text-xs opacity-70">
                                        TXN-{new Date(tx.created_at).toISOString().slice(0,10).replace(/-/g,'')}-{tx.id.slice(0,5).toUpperCase()}
                                    </td>
                                    <td>
                                        <div className="text-sm">{new Date(tx.created_at).toLocaleDateString()}</div>
                                        <div className="text-xs opacity-50">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                    </td>
                                    <td>
                                        <div className="font-bold">{tx.station?.station_name || tx.fuel_stations?.station_name || 'System'}</div>
                                    </td>
                                    <td>
                                        <span className="text-xs font-bold uppercase tracking-wider opacity-80">{tx.transaction_type.replace('_', ' ')}</span>
                                    </td>
                                    <td className="font-bold">
                                        {formatCurrency(tx.amount)}
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-2 text-xs uppercase font-bold opacity-70">
                                            {tx.payment_method || 'N/A'}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`status-badge ${getStatusColor(tx.payment_status)}`}>
                                            {tx.payment_status}
                                        </span>
                                    </td>
                                    <td className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <button className="icon-btn" title="View Detail" onClick={() => setDetailTx(tx)}><FiFileText size={14}/></button>
                                            <button className="icon-btn" title="Download Receipt" onClick={() => handleDownloadReceipt(tx)}><FiArrowDownRight size={14}/></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredTransactions.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="py-20 text-center opacity-40">
                                        No transactions found matching your audit criteria.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderFailedPayments = () => (
        <div className="failed-payments-view animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h4 className="font-900 uppercase tracking-widest text-sm opacity-70">Critical Failed Payments Queue</h4>
                <button className="btn-secondary text-xs" onClick={handleBulkRetryAll} disabled={bulkRetrying}>
                    {bulkRetrying ? 'Retrying…' : 'Bulk Retry All'}
                </button>
            </div>
            <div className="glass-card p-0 overflow-hidden">
                <table className="billing-table">
                    <thead>
                        <tr>
                            <th>Client / Station</th>
                            <th>Amount</th>
                            <th>Failed Date</th>
                            <th>Reason</th>
                            <th>Retry Count</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {failedPayments.map(tx => (
                            <tr key={tx.id}>
                                <td><div className="font-bold">{tx.station?.station_name || tx.fuel_stations?.station_name}</div></td>
                                <td className="font-bold text-danger">{formatCurrency(tx.amount)}</td>
                                <td>{new Date(tx.created_at).toLocaleDateString()}</td>
                                <td className="text-xs opacity-70 italic">{tx.description || "Insufficient funds / Processor error"}</td>
                                <td className="text-center font-bold">2</td>
                                <td className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <button className="btn-primary py-1 px-3 text-xs" onClick={() => handleRetryNow(tx)}>Retry Now</button>
                                        <button className="btn-secondary py-1 px-3 text-xs" onClick={() => handleContactStation(tx)}>Contact</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {failedPayments.length === 0 && (
                            <tr><td colSpan={6} className="py-20 text-center opacity-40">Financial pipeline clear. No failed payments found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderAdjustments = () => (
        <div className="adjustments-view animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h4 className="font-900 uppercase tracking-widest text-sm opacity-70">Adjustment Approvals</h4>
            </div>
            <div className="glass-card p-0 overflow-hidden">
                <table className="billing-table">
                    <thead>
                        <tr>
                            <th>Adjustment ID</th>
                            <th>Client</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Reason</th>
                            <th>Requested Date</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pendingAdjustments.map(adj => (
                            <tr key={adj.id}>
                                <td className="font-mono text-xs opacity-60">ADJ-{adj.id.slice(0,8).toUpperCase()}</td>
                                <td><div className="font-bold">{adj.station?.station_name}</div></td>
                                <td><span className="text-xs font-bold uppercase">{adj.transaction_type}</span></td>
                                <td className="font-bold text-blue-500">{formatCurrency(adj.amount)}</td>
                                <td className="text-xs opacity-70">{adj.description || "Billing error correction"}</td>
                                <td>{new Date(adj.created_at).toLocaleDateString()}</td>
                                <td className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <button className="bg-success text-white py-1 px-3 rounded text-xs font-bold" onClick={() => handleAdjustmentDecision(adj.id, 'completed')}>Approve</button>
                                        <button className="bg-danger text-white py-1 px-3 rounded text-xs font-bold" onClick={() => handleAdjustmentDecision(adj.id, 'reversed')}>Reject</button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {pendingAdjustments.length === 0 && (
                            <tr><td colSpan={7} className="py-20 text-center opacity-40">No pending adjustments requiring approval.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderUsage = () => {
        const totalOutstanding = usageLogs.reduce((sum, log) => sum + Number(log.current_debt || 0), 0);
        return (
        <div className="usage-view animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h4 className="font-900 uppercase tracking-widest text-sm opacity-70">Client Resource Consumption</h4>
                <span className="text-xs font-black uppercase tracking-widest text-danger">Total Outstanding: {formatCurrency(totalOutstanding)}</span>
            </div>
            <div className="glass-card p-0 overflow-hidden">
                <table className="billing-table">
                    <thead>
                        <tr>
                            <th>Client / Account</th>
                            <th>Tier</th>
                            <th>Onboarded</th>
                            <th>Total Paid</th>
                            <th>Subscription</th>
                            <th className="text-right">Outstanding Debt</th>
                        </tr>
                    </thead>
                    <tbody>
                        {usageLogs.map(log => (
                            <tr key={log.station_id || log.id}>
                                <td><div className="font-bold">{log.station_name || 'Unnamed account'}</div></td>
                                <td><span className="badge-blue">{log.sub_tier || log.subscription_status || 'BASIC'}</span></td>
                                <td className="text-xs opacity-70">{log.created_at ? new Date(log.created_at).toLocaleDateString() : '—'}</td>
                                <td>{formatCurrency(Number(log.total_paid || 0))}</td>
                                <td className="text-xs font-bold uppercase opacity-70">{log.account_status || 'active'}</td>
                                <td className="text-right font-black text-danger">{formatCurrency(Number(log.current_debt || 0))}</td>
                            </tr>
                        ))}
                        {usageLogs.length === 0 && (
                            <tr><td colSpan={6} className="py-20 text-center opacity-40">No usage metrics detected for the current cycle.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
        );
    };

    const handleGenerateInvoices = async () => {
        window.dispatchEvent(new CustomEvent('system-toast', {
            detail: {
                title: 'Confirm Batch Operation',
                message: 'Trigger monthly invoice generation for the current billing cycle? This will broadcast digital statements to all active station owners.',
                type: 'warning',
                persistent: true,
                actions: [
                    {
                        label: 'Abort',
                        onClick: () => {}
                    },
                    {
                        label: 'Generate Batch',
                        primary: true,
                        onClick: async () => {
                            setLoading(true);
                            try {
                                await billingService.generateMonthlyInvoices();
                                const invoiceData = await billingService.getInvoices();
                                setInvoices(invoiceData.data || []);
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Batch Complete',
                                        message: 'Monthly invoicing protocol has been successfully executed.',
                                        type: 'success'
                                    }
                                }));
                            } catch (error) {
                                console.error('Invoicing Error:', error);
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: 'Invoicing Failed',
                                        message: 'Failed to complete the monthly invoicing protocol. Check logs.',
                                        type: 'error'
                                    }
                                }));
                            } finally {
                                setLoading(false);
                            }
                        }
                    }
                ]
            }
        }));
    };

    const renderInvoices = () => (
        <div className="invoices-view animate-fade-in">
            <div className="flex justify-between items-center mb-6">
                <h4 className="font-900 uppercase tracking-widest text-sm opacity-70">Official Invoicing Ledger</h4>
                <button 
                    className="btn-primary text-xs flex items-center gap-2"
                    onClick={handleGenerateInvoices}
                >
                    <FiFileText/> Generate Monthly Batch
                </button>
            </div>
            <div className="glass-card p-0 overflow-hidden">
                <table className="billing-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Client</th>
                            <th>Period</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Due Date</th>
                            <th className="text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map(inv => (
                            <tr key={inv.id}>
                                <td className="font-bold">{inv.invoice_number}</td>
                                <td>{inv.station?.station_name}</td>
                                <td className="text-xs opacity-70">
                                    {new Date(inv.billing_period_start).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                                </td>
                                <td className="font-bold">{formatCurrency(inv.amount_due || 0)}</td>
                                <td>
                                    <span className={`status-badge ${
                                        inv.status === 'paid' ? 'bg-success-soft text-success' : 
                                        inv.status === 'overdue' ? 'bg-danger-soft text-danger' : 
                                        'bg-warning-soft text-warning'
                                    }`}>
                                        {inv.status}
                                    </span>
                                </td>
                                <td>{new Date(inv.due_date).toLocaleDateString()}</td>
                                <td className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <button className="icon-btn" title="View / Export Invoice" onClick={() => handleViewInvoice(inv)}><FiFileText size={14}/></button>
                                        <button className="icon-btn text-blue-400" title="Send Reminder" onClick={() => handleSendInvoiceReminder(inv)}><FiArrowUpRight size={14}/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {invoices.length === 0 && (
                            <tr><td colSpan={7} className="py-20 text-center opacity-40">No invoices generated for the selected period.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderSettings = () => (
        <div className="settings-view animate-fade-in">
            <h4 className="font-900 uppercase tracking-widest text-sm mb-6 opacity-70">Payment Gateway Configuration</h4>
            <div className="gateway-grid">
                <div className="gateway-card glass-card">
                    <div className="flex justify-between items-start mb-6">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/1/15/M-PESA_LOGO-01.svg" alt="M-Pesa" className="h-8" />
                        <span className="gateway-status status-active">Active</span>
                    </div>
                    <div className="config-field">
                        <label>Shortcode / Paybill</label>
                        <input type="text" className="config-input" placeholder="Shortcode / Paybill" defaultValue={readPaymentSettings().shortcode || ''} ref={mpesaShortcodeRef} />
                    </div>
                    <div className="config-field">
                        <label>Consumer Key</label>
                        <input type="password" className="config-input" placeholder="••••••••••••••••" defaultValue={readPaymentSettings().consumerKey || ''} ref={mpesaKeyRef} />
                    </div>
                    <button className="btn-secondary w-full mt-6 text-xs font-bold" onClick={handleUpdateCredentials}>Update Credentials</button>
                </div>

                <div className="gateway-card glass-card">
                    <div className="flex justify-between items-start mb-6">
                        <div className="text-xl font-black">BANK TRANSFER</div>
                        <span className="gateway-status status-active">Enabled</span>
                    </div>
                    <div className="config-field">
                        <label>Account Number</label>
                        <input type="text" className="config-input" placeholder="Account Number" defaultValue={readPaymentSettings().bankAccount || ''} ref={bankAccountRef} />
                    </div>
                    <div className="config-field">
                        <label>Swift Code</label>
                        <input type="text" className="config-input" placeholder="Swift Code" defaultValue={readPaymentSettings().bankSwift || ''} ref={bankSwiftRef} />
                    </div>
                    <button className="btn-secondary w-full mt-6 text-xs font-bold" onClick={handleUpdateDetails}>Update Details</button>
                </div>
            </div>
        </div>
    );

    const renderReports = () => (
        <div className="reports-view animate-fade-in">
            <div className="reports-dashboard">
                <h4 className="font-900 uppercase tracking-widest text-sm mb-8 opacity-70">Financial Reporting Engine</h4>
                
                <div className="report-type-card glass-card">
                    <FiBarChart2 className="report-icon" />
                    <div>
                        <h5 className="font-bold text-lg">Revenue Summary (Monthly)</h5>
                        <p className="text-sm opacity-60">Detailed breakdown of all income sources and growth metrics.</p>
                    </div>
                    <button className="btn-primary ml-auto text-xs" onClick={() => handleReportExport('Revenue Summary (Monthly)')}>Generate</button>
                </div>

                <div className="report-type-card glass-card">
                    <FiClock className="report-icon" />
                    <div>
                        <h5 className="font-bold text-lg">Client Debt Aging Report</h5>
                        <p className="text-sm opacity-60">Audit of outstanding balances across all station owners.</p>
                    </div>
                    <button className="btn-primary ml-auto text-xs" onClick={() => handleReportExport('Client Debt Aging Report')}>Generate</button>
                </div>

                <div className="report-type-card glass-card border-dashed">
                    <FiArrowUpRight className="report-icon" />
                    <div>
                        <h5 className="font-bold text-lg">Tax & Reconciliation Statement</h5>
                        <p className="text-sm opacity-60">Annual financial statement for accounting and compliance.</p>
                    </div>
                    <button className="btn-secondary ml-auto text-xs" onClick={() => handleReportExport('Tax Reconciliation Statement')}>Export CSV</button>
                </div>
            </div>
        </div>
    );

    return (
        <Layout>
            <div className="billing-page">
                <div className="p-8">
                    <div className="flex justify-between items-start mb-8">
                        <div>
                            <h1 className="text-3xl font-black text-primary tracking-tight lowercase">billing & payments</h1>
                            <p className="text-secondary font-bold text-sm mt-1 uppercase tracking-widest opacity-60">
                                (Financial Hub & usage-based billing)
                            </p>
                        </div>
                        
                        <div className="flex gap-3">
                            <button className="btn-secondary flex items-center gap-2" onClick={() => handleReportExport('Export Statement')}>
                                <FiFileText /> Export Statement
                            </button>
                            <button className="btn-primary flex items-center gap-2" onClick={() => setShowAdjustmentForm(prev => !prev)}>
                                <FiArrowUpRight /> New Adjustment
                            </button>
                        </div>
                    </div>

                    {showAdjustmentForm && (
                        <div className="glass-card mb-8 animate-fade-in">
                            <div className="flex justify-between items-center mb-4">
                                <h4 className="font-900 uppercase tracking-widest text-sm opacity-70">Record New Adjustment</h4>
                                <button className="icon-btn" title="Close" onClick={() => setShowAdjustmentForm(false)}><FiX size={14} /></button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="config-field mt-0">
                                    <label>Station</label>
                                    <select
                                        className="billing-select w-full"
                                        value={adjStationId || (usageLogs[0]?.station_id ?? '')}
                                        onChange={(e) => setAdjStationId(e.target.value)}
                                    >
                                        {usageLogs.map((log) => (
                                            <option key={log.station_id} value={log.station_id}>{log.station_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="config-field mt-0">
                                    <label>Amount</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0.00"
                                        className="config-input"
                                        value={adjAmount}
                                        onChange={(e) => setAdjAmount(e.target.value)}
                                    />
                                </div>
                                <div className="config-field mt-0">
                                    <label>Reason</label>
                                    <input
                                        type="text"
                                        placeholder="Adjustment rationale..."
                                        className="config-input"
                                        value={adjReason}
                                        onChange={(e) => setAdjReason(e.target.value)}
                                    />
                                </div>
                            </div>
                            <button className="btn-primary mt-6 text-xs" onClick={handleSubmitAdjustment}>Record Adjustment</button>
                        </div>
                    )}

                    <div className="billing-tabs neumorphic-pill mb-8">
                        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>Overview</button>
                        <button className={`tab-btn ${activeTab === 'transactions' ? 'active' : ''}`} onClick={() => setActiveTab('transactions')}>Transactions</button>
                        <button className={`tab-btn ${activeTab === 'failed' ? 'active' : ''}`} onClick={() => setActiveTab('failed')}>Failed Payments</button>
                        <button className={`tab-btn ${activeTab === 'adjustments' ? 'active' : ''}`} onClick={() => setActiveTab('adjustments')}>Adjustments</button>
                        <button className={`tab-btn ${activeTab === 'usage' ? 'active' : ''}`} onClick={() => setActiveTab('usage')}>Usage Tracking</button>
                        <button className={`tab-btn ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>Invoices</button>
                        <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Gateway Settings</button>
                        <button className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`} onClick={() => setActiveTab('reports')}>Financial Reports</button>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 opacity-40">
                            <div className="animate-spin mb-4"><FiClock size={32} /></div>
                            <p className="font-bold tracking-widest uppercase text-xs">Authenticating Financial Layer...</p>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'dashboard' && renderDashboard()}
                            {activeTab === 'transactions' && renderTransactions()}
                            {activeTab === 'failed' && renderFailedPayments()}
                            {activeTab === 'adjustments' && renderAdjustments()}
                            {activeTab === 'usage' && renderUsage()}
                            {activeTab === 'invoices' && renderInvoices()}
                            {activeTab === 'settings' && renderSettings()}
                            {activeTab === 'reports' && renderReports()}
                        </>
                    )}
                </div>
            </div>

            {detailTx && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setDetailTx(null)}>
                    <div className="glass-card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-5">
                            <h4 className="font-900 uppercase tracking-widest text-sm">Transaction Detail</h4>
                            <button className="icon-btn" title="Close" onClick={() => setDetailTx(null)}><FiX size={14} /></button>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Reference</span><b className="font-mono">TXN-{new Date(detailTx.created_at).toISOString().slice(0,10).replace(/-/g,'')}-{detailTx.id.slice(0,5).toUpperCase()}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Station</span><b>{detailTx.station?.station_name || detailTx.fuel_stations?.station_name || 'System'}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Type</span><b className="uppercase">{detailTx.transaction_type?.replace('_', ' ')}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Amount</span><b>{formatCurrency(detailTx.amount)}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Method</span><b className="uppercase">{detailTx.payment_method || 'N/A'}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Status</span><b>{detailTx.payment_status}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Reference No</span><b className="font-mono text-xs">{detailTx.payment_reference || '—'}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Created</span><b>{new Date(detailTx.created_at).toLocaleString()}</b></div>
                            <div className="flex justify-between"><span className="text-xs font-bold uppercase tracking-wider opacity-50">Description</span><b className="text-right">{detailTx.description || '—'}</b></div>
                        </div>
                    </div>
                </div>
            )}
        </Layout>
    );
};

export default BillingPage;
