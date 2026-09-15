import React, { useState, useMemo } from 'react';
import { 
    FiTruck, FiDownload, FiSearch, 
    FiAlertCircle, 
    FiFileText, FiDatabase,
    FiPlus, FiActivity, FiTrendingDown, FiAlertTriangle
} from 'react-icons/fi';
import { useDeliveries } from '@/hooks/useDeliveries';
import { useOrders } from '@/hooks/useOrders';
import { useAuth } from '@/hooks/useAuth';
import { ExportService } from '@/services/ExportService';
import { useShiftStatus } from '@/hooks/useShiftStatus';
import { useModals } from '@/contexts/ModalContext';
import { Toast } from '../Common/Toast';
import { OrderModal } from '../QuickActions/OrderModal';
import '../Common/DesignSystemCards.css';
import './DeliveriesPage.css';
import { DeliveryModal } from '../QuickActions/DeliveryModal';

// Pagination Component (Declared outside render to fix React state issues)
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
                    Previous
                </button>
                <button 
                    className="pagination-btn" 
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                >
                    Next
                </button>
            </div>
        </div>
    );
};

export const DeliveriesPage: React.FC = () => {
    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId || '';
    const orgName = currentUser?.companyName || 'Fuel Station Admin';
    // Data Hooks
    const { deliveries, error: deliveriesError } = useDeliveries(stationId);
    const { orders, error: ordersError } = useOrders(stationId);
    const { status: shiftStatus } = useShiftStatus();
    const { openModal } = useModals();

    // State
    const [ordersPage, setOrdersPage] = useState(1);
    const [deliveriesPage, setDeliveriesPage] = useState(1);
    const [orderSearch, setOrderSearch] = useState('');
    const [deliverySearch, setDeliverySearch] = useState('');
    const [toast, setToast] = useState<{ 
        message: string, 
        type: 'info' | 'warning' | 'success' | 'error',
        actionLabel?: string,
        onAction?: () => void
    } | null>(null);

    const itemsPerPage = 8;
    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
    const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);

    // Derived Data & Filtering
    const filteredOrders = useMemo(() => {
        return orders.filter(o => 
            o.supplier.toLowerCase().includes(orderSearch.toLowerCase()) ||
            o.product.toLowerCase().includes(orderSearch.toLowerCase()) ||
            o.id.toLowerCase().includes(orderSearch.toLowerCase())
        );
    }, [orders, orderSearch]);

    const filteredDeliveries = useMemo(() => {
        return deliveries.filter(d => 
            d.supplier?.toLowerCase().includes(deliverySearch.toLowerCase()) ||
            d.invoiceNo?.toLowerCase().includes(deliverySearch.toLowerCase()) ||
            d.product?.toLowerCase().includes(deliverySearch.toLowerCase())
        );
    }, [deliveries, deliverySearch]);

    // Paginated Data
    const paginatedOrders = useMemo(() => {
        const start = (ordersPage - 1) * itemsPerPage;
        return filteredOrders.slice(start, start + itemsPerPage);
    }, [ordersPage, filteredOrders]);

    const paginatedDeliveries = useMemo(() => {
        const start = (deliveriesPage - 1) * itemsPerPage;
        return filteredDeliveries.slice(start, start + itemsPerPage);
    }, [deliveriesPage, filteredDeliveries]);

    const stats = useMemo(() => {
        const totalInvoiced = deliveries.reduce((acc, d) => acc + (d.invoiceLiters || 0), 0);
        const totalMeasured = deliveries.reduce((acc, d) => acc + (d.measured?.standardizedLiters || 0), 0);
        const totalVariance = deliveries.reduce((acc, d) => acc + (d.variance?.liters || 0), 0);
        const discrepancyRate = deliveries.length > 0 
            ? ((deliveries.filter(d => d.status !== 'VERIFIED').length / deliveries.length) * 100).toFixed(1)
            : '0';

        return { totalInvoiced, totalMeasured, totalVariance, discrepancyRate };
    }, [deliveries]);

    // Handlers
    const handleExportExcel = () => {
        const summaryMetrics = {
            totalInvoiced: stats.totalInvoiced,
            totalMeasured: stats.totalMeasured,
            totalVariance: stats.totalVariance,
            discrepancyRate: stats.discrepancyRate,
            period: 'All Time'
        };
        ExportService.exportDeliveriesToExcel(deliveries, summaryMetrics, orgName);
    };


    if (deliveriesError || ordersError) {
        return (
            <div className="dp-error">
                <FiAlertCircle size={48} />
                <h2>Failed to sync logistics data</h2>
                <p>{deliveriesError || ordersError}</p>
            </div>
        );
    }

    return (
        <div className="dp-page animate-in fade-in duration-500">
            {/* Header Area */}
            <header className="dp-header">
                <div className="dp-header-left">
                    <div className="dp-icon-box">
                        <FiTruck size={24} />
                    </div>
                    <div>
                        <h1>Deliveries</h1>
                        <p className="dp-subtitle">Track orders, reconcile arrivals and review delivery history.</p>
                    </div>
                </div>
                <div className="dp-header-actions">
                    <button className="dp-btn dp-btn--primary" onClick={handleExportExcel}>
                        <FiDownload /> Export Bulk Data (.xlsx)
                    </button>
                    <div className="dp-meta-stats">
                        <div className="dp-meta-chip">
                            <FiDatabase size={12} /> {deliveries.length} Records
                        </div>
                    </div>
                    <div className="header-search-box">
                        <FiSearch className="search-icon" />
                        <input 
                            placeholder="Find logs, invoice or truck..." 
                            value={deliverySearch}
                            onChange={(e) => {
                                setDeliverySearch(e.target.value);
                                setOrderSearch(e.target.value);
                                setOrdersPage(1);
                                setDeliveriesPage(1);
                            }}
                        />
                    </div>
                </div>
            </header>

            {/* Premium Stats Cards */}
            <section className="dp-stats-grid">
                <div className="ds-card dp-premium-stat-card card-blue">
                    <div className="dp-stat-icon-wrapper">
                        <FiFileText size={22} />
                    </div>
                    <div className="dp-stat-content">
                        <span className="dp-stat-label">Invoiced Volume</span>
                        <span className="dp-stat-value">{stats.totalInvoiced.toLocaleString()} L</span>
                        <div className="dp-stat-footer">Cumulative Waybill</div>
                    </div>
                </div>

                <div className="ds-card dp-premium-stat-card card-emerald">
                    <div className="dp-stat-icon-wrapper">
                        <FiActivity size={22} />
                    </div>
                    <div className="dp-stat-content">
                        <span className="dp-stat-label">Measured Flow (VCF)</span>
                        <span className="dp-stat-value">{stats.totalMeasured.toLocaleString()} L</span>
                        <div className="dp-stat-footer">ATG Verified Intake @ 15°C</div>
                    </div>
                </div>

                <div className="ds-card dp-premium-stat-card card-rose">
                    <div className="dp-stat-icon-wrapper">
                        <FiTrendingDown size={22} />
                    </div>
                    <div className="dp-stat-content">
                        <span className="dp-stat-label">Variance Net</span>
                        <span className="dp-stat-value">{stats.totalVariance > 0 ? '+' : ''}{stats.totalVariance.toLocaleString()} L</span>
                        <div className="dp-stat-footer">Integrity Delta</div>
                    </div>
                </div>

                <div className="ds-card dp-premium-stat-card card-amber">
                    <div className="dp-stat-icon-wrapper">
                        <FiAlertTriangle size={22} />
                    </div>
                    <div className="dp-stat-content">
                        <span className="dp-stat-label">Discrepancy</span>
                        <span className="dp-stat-value">{stats.discrepancyRate}%</span>
                        <div className="dp-stat-footer">Audit Exception Rate</div>
                    </div>
                </div>
            </section>

            {/* Logistics Tables */}
            <div className="dp-bottom-tables-grid mt-6 space-y-10 px-8">
                {/* Procurement Area */}
                <div className="ds-card tdv-section-card pb-6">
                    <div className="section-header flex items-center justify-between p-6">
                        <div className="flex items-center gap-6">
                            <button className="btn-add-new flex items-center gap-2" onClick={() => {
                                if (shiftStatus !== 'open') {
                                    setToast({
                                        message: 'No active shift found. Please start a shift first.',
                                        type: 'warning',
                                        actionLabel: 'Start New Shift',
                                        onAction: () => openModal('shift-open')
                                    });
                                } else {
                                    setIsOrderModalOpen(true);
                                }
                            }}>
                                <div className="plus-icon"><FiPlus /></div>
                                <span>Add New Order</span>
                            </button>
                            <div className="flex items-center gap-3">
                                <h3 className="section-title">Procurement Log</h3>
                            </div>
                        </div>
                    </div>
                    
                    <div className="table-responsive max-h-15-rows custom-scrollbar">
                        <table className="tdv-transaction-table">
                            <thead>
                                <tr>
                                    <th>Order Ref</th>
                                    <th>Supplier</th>
                                    <th>Fuel Grade</th>
                                    <th>Quantity</th>
                                    <th>Expected</th>
                                    <th>Actor</th>
                                    <th>Priority</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="text-center py-10 text-slate-400 font-semibold">
                                            No procurement records found.
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedOrders.map((order) => (
                                        <tr key={order.id}>
                                            <td className="font-mono text-indigo-600 font-bold">{order.orderRef}</td>
                                            <td className="customer-name font-bold">{order.supplier}</td>
                                            <td className="text-slate-600 font-semibold">{order.product}</td>
                                            <td className="font-bold text-slate-800">{order.quantity.toLocaleString()} L</td>
                                            <td>{order.expectedDate}</td>
                                            <td className="text-[11px] text-slate-500 font-bold">{order.actorEmail}</td>
                                            <td>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                    order.priority === 'High' ? 'bg-rose-100 text-rose-600' : 
                                                    order.priority === 'Normal' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                    {order.priority}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                    order.status === 'Dispatched' ? 'bg-amber-100 text-amber-600' : 
                                                    order.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <TablePagination 
                        currentPage={ordersPage} 
                        totalItems={filteredOrders.length} 
                        pageSize={itemsPerPage} 
                        onPageChange={setOrdersPage} 
                    />
                </div>

                {/* Arrivals Area */}
                <div className="ds-card tdv-section-card pb-6">
                    <div className="section-header flex items-center justify-between p-6">
                        <div className="flex items-center gap-6">
                            <button className="btn-add-new flex items-center gap-2" onClick={() => {
                                if (shiftStatus !== 'open') {
                                    setToast({
                                        message: 'No active shift found. Please start a shift first.',
                                        type: 'warning',
                                        actionLabel: 'Start New Shift',
                                        onAction: () => openModal('shift-open')
                                    });
                                } else {
                                    setIsDeliveryModalOpen(true);
                                }
                            }}>
                                <div className="plus-icon"><FiPlus /></div>
                                <span>Add New Delivery</span>
                            </button>
                            <div className="flex items-center gap-3">
                                <h3 className="section-title">Arrivals Reconciliation</h3>
                            </div>
                        </div>
                    </div>

                    <div className="table-responsive max-h-15-rows custom-scrollbar">
                        <table className="tdv-transaction-table">
                            <thead>
                                <tr>
                                    <th>Invoice #</th>
                                    <th>Supplier / OMC</th>
                                    <th>Truck</th>
                                    <th>Product</th>
                                    <th>Invoiced</th>
                                    <th>ATG Delta</th>
                                    <th>Variance</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedDeliveries.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="text-center py-10 text-slate-400 font-semibold">
                                            No delivery records found.
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedDeliveries.map((delivery) => (
                                        <tr key={delivery.id}>
                                            <td className="font-mono text-emerald-600 font-bold">{delivery.invoiceNo}</td>
                                            <td className="customer-name font-bold">{delivery.supplier}</td>
                                            <td>
                                                <span className="font-bold text-slate-700">{generateDeterministicTruckName(delivery.id)}</span>
                                            </td>
                                            <td className="font-bold text-slate-600">
                                                <div className="flex items-center gap-2">
                                                    {delivery.product}
                                                    {delivery.bolPhotoUrl && (
                                                        <a 
                                                            href={delivery.bolPhotoUrl} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-indigo-400 hover:text-indigo-600 transition-colors"
                                                            title="View Bill of Lading"
                                                        >
                                                            <FiFileText size={14} />
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="font-bold">{(delivery.invoiceLiters || 0).toLocaleString()} L</td>
                                            <td className="font-bold text-slate-800">{(delivery.measured?.standardizedLiters || 0).toLocaleString()} L</td>
                                            <td className={`font-black ${(delivery.variance?.liters || 0) < -50 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {delivery.variance?.liters > 0 ? '+' : ''}{delivery.variance?.liters || 0} L
                                            </td>
                                            <td>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                    delivery.status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-600' : 
                                                    delivery.status === 'DISPUTED' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
                                                }`}>
                                                    {delivery.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <TablePagination 
                        currentPage={deliveriesPage} 
                        totalItems={filteredDeliveries.length} 
                        pageSize={itemsPerPage} 
                        onPageChange={setDeliveriesPage} 
                    />
                </div>
            </div>

            {/* Modal & Toast */}
            {isOrderModalOpen && (
                <OrderModal 
                    isOpen={isOrderModalOpen} 
                    onClose={() => setIsOrderModalOpen(false)}
                    onSuccess={(msg) => setToast({ message: msg, type: 'success' })}
                />
            )}

            {isDeliveryModalOpen && (
                <DeliveryModal 
                    isOpen={isDeliveryModalOpen} 
                    onClose={() => setIsDeliveryModalOpen(false)}
                    onSuccess={(msg) => setToast({ message: msg, type: 'success' })}
                />
            )}

            {toast && (
                <Toast 
                    message={toast.message} 
                    type={toast.type} 
                    actionLabel={toast.actionLabel}
                    onAction={toast.onAction}
                    onClose={() => setToast(null)} 
                />
            )}
        </div>
    );
};

// Internal utility to generate a stable truck name for display if not explicitly provided in DB
function generateDeterministicTruckName(id: string) {
    const seed = id.charCodeAt(0) + id.charCodeAt(1);
    const letters = ['KBZ', 'KCL', 'KDM', 'KEA', 'KCF'];
    return `${letters[seed % letters.length]} ${300 + seed}X`;
}
