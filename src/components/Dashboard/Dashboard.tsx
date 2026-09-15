import React, { useState } from 'react';
// import { useNavigate } from 'react-router-dom';
import { Tank } from '@/types';
import { useTanks, useAlerts, useAllLatestReadings, useSites } from '@/hooks/useSupabase';
import { useAuth } from '@/hooks/useAuth';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useDeliveries } from '@/hooks/useDeliveries';

import { TankGrid } from './TankGrid';
import { MarketLens } from './MarketLens';
import { DashboardStats } from './DashboardStats';
import { FiAlertCircle } from 'react-icons/fi';
import { ActionQueue } from './ActionQueue';
import { TelemetryErrorBoundary } from '../Common/TelemetryErrorBoundary';
import { useTelemetryQueue } from '@/contexts/TelemetryQueueContext';
import { SystemIntegrityCard } from './SystemIntegrityCard';
import { EPRALivePriceCard } from './EPRALivePriceCard';

import { ExecutiveOverview } from './ExecutiveOverview';

import { AddTankModal } from '../Inventory/AddTankModal';
import { SkeletonDashboard } from '../Common/SkeletonLoader';
import { LazyComponent } from '../Common/LazyComponent';
import '../Common/DesignSystemCards.css';
import './Dashboard.css';

import { useShiftStatus } from '@/hooks/useShiftStatus';

export const Dashboard: React.FC = () => {
    const { currentUser } = useAuth();
    const { pushEvent } = useTelemetryQueue();
    // const navigate = useNavigate(); // Unused in this build
    const stationId = currentUser?.stationId || '';

    const { tanks, loading: tanksLoading, error: tanksError } = useTanks(stationId);
    useShiftStatus();
    
    // Fetch latest readings for all tanks to get RSSI
    const { readings } = useAllLatestReadings(stationId, (tanks || []).map((t: import('@/types').Tank) => t.id));
    
    // Use the new dashboard data hook that hits our Supabase helper function
    const { error: summaryError, refetch: refetchSummary } = useDashboardData();

    const { alerts } = useAlerts(stationId, false);
    const { deliveries } = useDeliveries(stationId);
    const { sites } = useSites(stationId);
    const [showAddModal, setShowAddModal] = useState(false);
    const hasPushedError = React.useRef(false);

    // Report initialization errors to telemetry queue
    React.useEffect(() => {
        if ((tanksError || summaryError) && !hasPushedError.current) {
            pushEvent({
                type: 'system_error',
                message: `Failed to initialize telemetry: ${tanksError?.message || summaryError?.message || 'Database connection error'}`,
                actionLabel: 'Retry',
                onAction: () => {
                    hasPushedError.current = false;
                    refetchSummary();
                    window.location.reload();
                }
            });
            hasPushedError.current = true;
        } else if (!tanksError && !summaryError) {
        }
    }, [tanksError, summaryError, pushEvent, refetchSummary]);

    // Onboarding Gate: Trigger modal if 0 tanks exist (Only for Admins/Owners Level 5)
    const { canSee } = useAuth();
    React.useEffect(() => {
        if (!tanksLoading && tanks.length === 0 && canSee(5)) {
            setShowAddModal(true);
        }
    }, [tanks.length, tanksLoading, canSee]);


    const ghostTank: Tank = {
        id: 'ghost-tank',
        stationId: stationId,
        siteId: 'pending',
        name: 'Pending Configuration',
        location: 'Hardware Not Linked',
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
        isActive: false
    };

    if (tanksLoading && tanks.length === 0) {
        return <SkeletonDashboard />;
    }

    const displayTanks = tanks.length > 0 ? tanks : [ghostTank];

    return (
        <div className="dashboard-container">


            <header className="dashboard-premium-header">
                <div className="header-left">
                    <div className="title-row">
                        <h1 className="premium-title">Dashboard</h1>
                        <div className="live-status-pill">
                            <div className="pulse-dot" />
                            <span>LIVE TERMINAL</span>
                        </div>
                    </div>
                    <p className="premium-subtitle">
                        Real-time intelligence across <strong>{displayTanks.length} nodes</strong>. Monitoring terminal health and forensic audit summaries.
                    </p>
                </div>
            </header>

            <ExecutiveOverview 
                tanks={displayTanks} 
                readings={readings} 
                stationId={stationId} 
                alerts={alerts} 
                deliveries={deliveries}
            />

            <div className="dashboard-grid">
                {/* Main HUD Area */}
                <section className="tanks-section">
                    <div className={displayTanks.length === 1 ? 'single-tank-view' : ''}>
                        <TelemetryErrorBoundary
                            fallback={
                                <div className="p-8 bg-red-50 border border-red-100 rounded-xl text-center">
                                    <FiAlertCircle className="mx-auto text-red-500 mb-2" size={24} />
                                    <p className="text-red-800 font-bold">Inventory Hub Glitch</p>
                                    <p className="text-red-600 text-xs">High data volume detected. Attempting to recover...</p>
                                    <button onClick={() => window.location.reload()} className="mt-4 text-xs font-bold text-red-700 underline">Reload Component</button>
                                </div>
                            }
                        >
                            <TankGrid tanks={displayTanks} stationId={stationId} readings={readings} />
                        </TelemetryErrorBoundary>
                    </div>

                    {/* Integrated Operational Statistics */}
                    <div className="mt-8">
                        <LazyComponent minHeight="200px">
                            <TelemetryErrorBoundary
                                fallback={<div className="h-32 bg-slate-50 rounded animate-pulse" />}
                            >
                                <DashboardStats
                                    tanks={displayTanks}
                                    stationId={stationId}
                                    alerts={alerts}
                                />
                            </TelemetryErrorBoundary>
                        </LazyComponent>
                    </div>


                    {showAddModal && (
                        <AddTankModal 
                            isOpen={showAddModal}
                            sites={sites}
                            onClose={() => setShowAddModal(false)}
                            onSuccess={() => {
                                localStorage.setItem('iotank_initial_tanks_provisioned', 'true');
                                pushEvent({
                                    type: 'suggested',
                                    message: 'Terminal Node Provisioned Successfully. Initializing telemetry sync.',
                                });
                            }}
                        />
                    )}
                </section>

                {/* Sidebar Intelligence & Health - PERSISTENT */}
                <aside className="dashboard-sidebar">
                    <TelemetryErrorBoundary>
                        <ActionQueue />
                    </TelemetryErrorBoundary>

                    <LazyComponent minHeight="300px">
                        <TelemetryErrorBoundary>
                            <MarketLens stationId={stationId} />
                        </TelemetryErrorBoundary>
                    </LazyComponent>

                    <LazyComponent minHeight="300px">
                        <TelemetryErrorBoundary>
                            <SystemIntegrityCard 
                                stationId={stationId} 
                                tanks={displayTanks} 
                                alerts={alerts} 
                            />
                            <EPRALivePriceCard stationId={stationId} />
                        </TelemetryErrorBoundary>
                    </LazyComponent>
                </aside>
            </div>

        </div>
    );
};
