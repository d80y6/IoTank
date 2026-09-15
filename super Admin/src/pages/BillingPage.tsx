import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { billingService, RevenueStats, DebtAging } from '../services/billingService';
import { 
    FiDollarSign, FiActivity, FiAlertCircle, FiPieChart, 
    FiArrowUpRight, FiArrowDownRight, FiClock, FiCheckCircle,
    FiFileText, FiSettings, FiBarChart2, FiCalendar, FiSearch, FiFilter
} from 'react-icons/fi';
import './BillingPage.css';

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

    useEffect(() => {
        const fetchStats = async () => {
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
        };

        fetchStats();
    }, [statusFilter, typeFilter]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-KE', {
            style: 'currency',
            currency: 'KES',
            minimumFractionDigits: 0
        }).format(amount);
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

    const paymentBreakdown = React.useMemo(() => {
        const methodCounts = transactions.reduce((acc: Record<string, number>, tx: any) => {
            const method = String(tx.payment_method || 'unknown').toLowerCase();
            acc[method] = (acc[method] || 0) + 1;
            return acc;
        }, {});
        const total = Object.values(methodCounts).reduce((sum, n) => sum + n, 0) || 1;
        const pct = (k: string) => Math.round(((methodCounts[k] || 0) / total) * 100);
        return {
            mpesa: pct('mpesa'),
            bank: pct('bank'),
            card: pct('card')
        };
    }, [transactions]);

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
                        <div className="flex items-center justify-around h-48">
                            <div className="method-item">
                                <div className="method-dot bg-mpesa"></div>
                                <span>M-Pesa ({paymentBreakdown.mpesa}%)</span>
                            </div>
                            <div className="method-item">
                                <div className="method-dot bg-bank"></div>
                                <span>Bank ({paymentBreakdown.bank}%)</span>
                            </div>
                            <div className="method-item">
                                <div className="method-dot bg-card"></div>
                                <span>Card ({paymentBreakdown.card}%)</span>
                            </div>
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

                    <button className="btn-secondary flex items-center gap-2">
                        <FiFilter /> More Filters
                    </button>
                </div>
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
                            {transactions.filter(tx => 
                                tx.id.includes(searchTerm) || 
                                tx.station?.station_name?.toLowerCase().includes(searchTerm.toLowerCase())
                            ).map((tx) => (
                                <tr key={tx.id}>
                                    <td className="font-mono text-xs opacity-70">
                                        TXN-{new Date(tx.created_at).toISOString().slice(0,10).replace(/-/g,'')}-{tx.id.slice(0,5).toUpperCase()}
                                    </td>
                                    <td>
                                        <div className="text-sm">{new Date(tx.created_at).toLocaleDateString()}</div>
                                        <div className="text-xs opacity-50">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                    </td>
                                    <td>
                                        <div className="font-bold">{tx.station?.station_name || 'System'}</div>
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
                                            <button className="icon-btn" title="View Detail"><FiFileText size={14}/></button>
                                            <button className="icon-btn" title="Download Receipt"><FiArrowDownRight size={14}/></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {transactions.length === 0 && (
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
                <button className="btn-secondary text-xs">Bulk Retry All</button>
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
                                <td><div className="font-bold">{tx.station?.station_name}</div></td>
                                <td className="font-bold text-danger">{formatCurrency(tx.amount)}</td>
                                <td>{new Date(tx.created_at).toLocaleDateString()}</td>
                                <td className="text-xs opacity-70 italic">{"Insufficient funds / Processor error"}</td>
                                <td className="text-center font-bold">2</td>
                                <td className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <button className="btn-primary py-1 px-3 text-xs">Retry Now</button>
                                        <button className="btn-secondary py-1 px-3 text-xs">Contact</button>
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
                                <td className="text-xs opacity-70">{"Billing error correction"}</td>
                                <td>{new Date(adj.created_at).toLocaleDateString()}</td>
                                <td className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <button className="bg-success text-white py-1 px-3 rounded text-xs font-bold">Approve</button>
                                        <button className="bg-danger text-white py-1 px-3 rounded text-xs font-bold">Reject</button>
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

    const renderUsage = () => (
        <div className="usage-view animate-fade-in">
            <h4 className="font-900 uppercase tracking-widest text-sm mb-6 opacity-70">Client Resource Consumption</h4>
            <div className="glass-card p-0 overflow-hidden">
                <table className="billing-table">
                    <thead>
                        <tr>
                            <th>Client / Account</th>
                            <th className="text-center">Active Tanks</th>
                            <th className="text-center">Active Workers</th>
                            <th>Tier</th>
                            <th>Base Monthly</th>
                            <th>Usage Surcharge</th>
                            <th className="text-right">Total Owed</th>
                        </tr>
                    </thead>
                    <tbody>
                        {usageLogs.map(log => (
                            <tr key={log.id}>
                                <td><div className="font-bold">{log.station_name}</div></td>
                                <td className="text-center">12</td>
                                <td className="text-center">8</td>
                                <td><span className="badge-blue">Enterprise</span></td>
                                <td>{formatCurrency(25000)}</td>
                                <td className="text-amber-500 font-bold">+{formatCurrency(4500)}</td>
                                <td className="text-right font-black">{formatCurrency(29500)}</td>
                            </tr>
                        ))}
                        {usageLogs.length === 0 && (
                            <tr><td colSpan={7} className="py-20 text-center opacity-40">No usage metrics detected for the current cycle.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

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
                                        <button className="icon-btn" title="View PDF"><FiFileText size={14}/></button>
                                        <button className="icon-btn text-blue-400" title="Send Reminder"><FiArrowUpRight size={14}/></button>
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
                        <input type="text" className="config-input" defaultValue="400200" />
                    </div>
                    <div className="config-field">
                        <label>Consumer Key</label>
                        <input type="password" className="config-input" defaultValue="••••••••••••••••" />
                    </div>
                    <button className="btn-secondary w-full mt-6 text-xs font-bold">Update Credentials</button>
                </div>

                <div className="gateway-card glass-card">
                    <div className="flex justify-between items-start mb-6">
                        <div className="text-xl font-black">BANK TRANSFER</div>
                        <span className="gateway-status status-active">Enabled</span>
                    </div>
                    <div className="config-field">
                        <label>Account Number</label>
                        <input type="text" className="config-input" defaultValue="0110022334455" />
                    </div>
                    <div className="config-field">
                        <label>Swift Code</label>
                        <input type="text" className="config-input" defaultValue="KCBKKEN" />
                    </div>
                    <button className="btn-secondary w-full mt-6 text-xs font-bold">Update Details</button>
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
                    <button className="btn-primary ml-auto text-xs">Generate</button>
                </div>

                <div className="report-type-card glass-card">
                    <FiClock className="report-icon" />
                    <div>
                        <h5 className="font-bold text-lg">Client Debt Aging Report</h5>
                        <p className="text-sm opacity-60">Audit of outstanding balances across all station owners.</p>
                    </div>
                    <button className="btn-primary ml-auto text-xs">Generate</button>
                </div>

                <div className="report-type-card glass-card border-dashed">
                    <FiArrowUpRight className="report-icon" />
                    <div>
                        <h5 className="font-bold text-lg">Tax & Reconciliation Statement</h5>
                        <p className="text-sm opacity-60">Annual financial statement for accounting and compliance.</p>
                    </div>
                    <button className="btn-secondary ml-auto text-xs">Export CSV</button>
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
                            <button className="btn-secondary flex items-center gap-2">
                                <FiFileText /> Export Statement
                            </button>
                            <button className="btn-primary flex items-center gap-2">
                                <FiArrowUpRight /> New Adjustment
                            </button>
                        </div>
                    </div>

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
        </Layout>
    );
};

export default BillingPage;
