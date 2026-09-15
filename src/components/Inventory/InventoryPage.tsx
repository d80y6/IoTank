/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import { Tank } from '@/types';
import { useSearchParams } from 'react-router-dom';
import './InventoryPage.css';
import { useAuth } from '@/hooks/useAuth';
import { useTransactions } from '@/hooks/useTransactions';
import { useTanks, useSites } from '@/hooks/useSupabase';
import { FiAlertTriangle, FiGrid, FiList, FiPlus } from 'react-icons/fi';
import { TankDetailsView } from './TankDetailsView';
import { PageHeader } from '../Common/PageHeader';
import { FleetSummaryStrip } from './FleetSummaryStrip';
import { TankGridView } from './TankGridView';
import { TankSelectorTabs } from './TankSelectorTabs';
import { AddTankModal } from './AddTankModal';
import { useShiftStatus } from '@/hooks/useShiftStatus';
import { useModals } from '@/contexts/ModalContext';
import { Toast } from '../Common/Toast';
import { SkeletonDashboard } from '../Common/SkeletonLoader';

export const InventoryPage: React.FC = () => {
    const { currentUser } = useAuth();
    const [searchParams] = useSearchParams();
    const selectedTankId = searchParams.get('tankId');

    const stationId = currentUser?.stationId || '';
    const { tanks, loading: tanksLoading } = useTanks(stationId);
    const { transactions, loading: txLoading } = useTransactions(stationId);
    const { sites } = useSites(stationId);
    // Replaced deprecated useRefuelMonitor with live alert check from AlertDetectionEngine
    // isRefuelling is true if any active refill/delivery alert exists across all tanks

    // View Management
    const [viewMode, setViewMode] = useState<'grid' | 'detailed'>('detailed');
    const [activeTankId, setActiveTankId] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [isInternalLoading, setIsInternalLoading] = useState(true);
    const { status: shiftStatus } = useShiftStatus();
    const { openModal } = useModals();

    // Simulated internal transition loading
    useEffect(() => {
        setIsInternalLoading(true);
        const timer = setTimeout(() => setIsInternalLoading(false), 600);
        return () => clearTimeout(timer);
    }, [viewMode, activeTankId]);
    const [toast, setToast] = useState<{ 
        message: string, 
        type: 'info' | 'warning' | 'success' | 'error',
        actionLabel?: string,
        onAction?: () => void
    } | null>(null);

    // Sync activeTankId with tanks or URL
    useEffect(() => {
        if (tanks.length > 0 && !activeTankId) {
            setActiveTankId(selectedTankId || tanks[0].id);
        }
    }, [tanks, selectedTankId]);

    // Scroll into view if tankId is present
    useEffect(() => {
        if (selectedTankId) {
            const el = document.getElementById(`tank-${selectedTankId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [selectedTankId, tanks.length]);

    const ghostTank: Tank = {
        id: 'ghost-tank',
        stationId: stationId,
        siteId: 'pending',
        name: 'Standard Capacity Tank',
        location: 'Calibration Required',
        capacity: 10000,
        fuelType: 'diesel',
        shape: 'cylinder',
        height: 200,
        lowLevelThreshold: 15,
        highLevelThreshold: 90,
        criticalLevelThreshold: 10,
        rapidDefillThreshold: 50,
        leakageThreshold: 2,
        temperatureAlertThreshold: 40,
        leakDetectionSensitivity: 0.1,
        thermalCoefficient: 0.00084,
        density: 0.832,
        sensorOffset: 0,
        sensorHeight: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isActive: false,
        currentVolume: 0
    };

    // Aggregations
    const stats = transactions.reduce((acc, tx) => {
        if (tx.type === 'sale') acc.totalSale += tx.amount * (tx.metadata?.pricePerLiter || 0);
        if (tx.type === 'purchase') acc.totalPurchase += tx.amount * (tx.metadata?.pricePerLiter || 0);
        if (tx.type === 'delivery') acc.totalPurchase += tx.amount * (tx.metadata?.pricePerLiter || 0);
        return acc;
    }, { totalSale: 0, totalPurchase: 0, totalProfit: 0 });

    stats.totalProfit = stats.totalSale - stats.totalPurchase;

    const tanksToRender = tanks.length > 0 ? tanks : [ghostTank];
    const isGhostMode = tanks.length === 0;
    const activeTank = tanksToRender.find((t: Tank) => t.id === (activeTankId || tanksToRender[0].id)) || tanksToRender[0];

    if ((tanksLoading || txLoading) && tanks.length === 0) {
        return <div className="inventory-page-container"><SkeletonDashboard /></div>;
    }

    return (
        <div className="inventory-page-container">
            {/* Page Header */}
            <PageHeader
                title="Inventory"
                description="Monitor tank levels, sensor health, and stock details across all nodes."
            />

            {/* Fleet Intelligence Strip */}
            {tanks.length > 0 && <FleetSummaryStrip tanks={tanks} />}

            {/* Controls Bar */}
            <div className="inventory-controls">
                <div className="view-mode-toggle-modern">
                    <button
                        className={`toggle-btn-modern ${viewMode === 'grid' ? 'active' : ''}`}
                        onClick={() => setViewMode('grid')}
                    >
                        <div className="btn-content">
                            <FiGrid className="icon" />
                            <div className="text-stack">
                                <span className="label">Grid View</span>
                                <span className="sub">Fleet Overview</span>
                            </div>
                        </div>
                    </button>
                    <button
                        className={`toggle-btn-modern ${viewMode === 'detailed' ? 'active' : ''}`}
                        onClick={() => setViewMode('detailed')}
                    >
                        <div className="btn-content">
                            <FiList className="icon" />
                            <div className="text-stack">
                                <span className="label">Detailed View</span>
                                <span className="sub">Analysis Deep Dive</span>
                            </div>
                        </div>
                    </button>
                </div>

                <div className="page-actions">
                    <button
                        className="btn-premium-action"
                        onClick={() => {
                            if (shiftStatus !== 'open') {
                                setToast({
                                    message: 'No active shift found. Please start a shift first.',
                                    type: 'warning',
                                    actionLabel: 'Start New Shift',
                                    onAction: () => openModal('shift-open')
                                });
                            } else {
                                setShowAddModal(true);
                            }
                        }}
                    >
                        <FiPlus />
                        Add New Tank
                    </button>
                </div>
            </div>

            {/* Refuel Alert Banner — driven by AlertDetectionEngine refill events */}
            {tanks.length > 0 && tanks.some((t: import('@/types').Tank) => t.currentState === 'delivery') && (
                <div className="refuel-alert-banner">
                    <FiAlertTriangle className="animate-pulse" />
                    <span>
                        <strong>Refuelling Detected!</strong> High-rate volume increase detected. Please confirm delivery details.
                    </span>
                </div>
            )}

            {/* Main Inventory Content */}
            <div className="inventory-content min-h-[600px]">
                {isInternalLoading ? (
                    <SkeletonDashboard />
                ) : viewMode === 'grid' ? (
                    /* ── Grid View ── */
                    <TankGridView
                        tanks={tanksToRender}
                        onSelectTank={(id) => {
                            setActiveTankId(id);
                            setViewMode('detailed');
                        }}
                    />
                ) : (
                    /* ── Split-Pane Detailed HUD ── */
                    <div className={`detailed-inventory-view ${isGhostMode ? 'ghost-mode' : ''}`}>
                        {/* Left: Tank Selector Panel */}
                            <div className="tank-selector-panel">
                                <div className="tank-selector-header">
                                    <h4>Active Tanks</h4>
                                    <p>{isGhostMode ? 'No tanks provisioned' : `${tanks.length} tank${tanks.length !== 1 ? 's' : ''} monitored`}</p>
                                </div>
                                <div className="flex items-center gap-4 flex-1">
                                    <TankSelectorTabs
                                        tanks={tanksToRender}
                                        selectedTankId={activeTankId || tanksToRender[0].id}
                                        onSelectTank={setActiveTankId}
                                    />
                                    {!isGhostMode && (
                                        <button 
                                            className="tank-tab-btn placeholder"
                                            onClick={() => {
                                                if (shiftStatus !== 'open') {
                                                    setToast({
                                                        message: 'No active shift found. Please start a shift first.',
                                                        type: 'warning',
                                                        actionLabel: 'Start New Shift',
                                                        onAction: () => openModal('shift-open')
                                                    });
                                                } else {
                                                    setShowAddModal(true);
                                                }
                                            }}
                                            style={{ minWidth: '130px' }}
                                        >
                                            <span className="tab-tank-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <FiPlus size={10} /> Provision
                                            </span>
                                            <span className="tab-tank-fuel">Next Node</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                        {/* Right: Tank Detail Pane */}
                        <div className="active-tank-container animate-fade-in">
                            <TankDetailsView
                                tank={activeTank}
                                stationId={stationId}
                                tanks={tanksToRender}
                                transactions={transactions}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Add Tank Modal */}
            {showAddModal && (
                <AddTankModal
                    isOpen={showAddModal}
                    sites={sites}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={(newTank) => {
                        setActiveTankId(newTank.id);
                        setViewMode('detailed');
                    }}
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
