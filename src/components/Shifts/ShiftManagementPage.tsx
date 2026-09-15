import React, { useMemo } from 'react';
import { FiActivity, FiShield, FiTrendingUp, FiCheckCircle } from 'react-icons/fi';
import { MdOutlineEventNote } from 'react-icons/md';
import { useAuth } from '@/hooks/useAuth';
import { useTanks } from '@/hooks/useSupabase';
import { useShifts, useActiveShift } from '@/hooks/useShifts';
import { ShiftAnalyticsTable } from '@/components/Analytics/ShiftAnalyticsTable';
import { format, differenceInMinutes } from 'date-fns';
import './ShiftManagementPage.css';

export const ShiftManagementPage: React.FC = () => {
    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId || '';
    
    const { loading: tanksLoading } = useTanks(stationId);
    const { shifts, loading: shiftsLoading } = useShifts(stationId);
    const { activeShift, loading: activeLoading } = useActiveShift(stationId);

    const stats = useMemo(() => {
        const total = shifts.length;
        const critical = shifts.filter(s => Math.abs(s.variance_data?.amount || 0) > 500).length;
        const avgVariance = total > 0 
            ? shifts.reduce((acc, s) => acc + Math.abs(s.variance_data?.amount || 0), 0) / total 
            : 0;
        return { total, critical, avgVariance };
    }, [shifts]);

    const [activeDuration, setActiveDuration] = React.useState(0);

    React.useEffect(() => {
        if (!activeShift?.created_at) {
            setActiveDuration(0);
            return;
        }
        
        const updateTimer = () => {
            setActiveDuration(differenceInMinutes(new Date(), new Date(activeShift.created_at)));
        };
        
        updateTimer();
        const interval = setInterval(updateTimer, 60000); // Update every minute
        
        return () => clearInterval(interval);
    }, [activeShift?.created_at]);

    const isLive = activeShift?.status === 'OPEN';

    if (tanksLoading && shiftsLoading && activeLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500 border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="shift-hub-page">
            {/* PAGE HEADER */}
            <header className="shift-hub-header">
                <div className="shift-hub-title">
                    <h1>
                        <MdOutlineEventNote size={22} />
                        Shift Audit Hub
                    </h1>
                    <p>Track, reconcile and review all shift records and operational logs.</p>
                </div>
                <div className={`meta-chip ${isLive ? 'active' : ''}`}>
                    {isLive ? <div className="pulse-indicator" /> : <FiCheckCircle size={12} />}
                    {isLive ? 'Live Session' : 'No Active Shift'}
                </div>
            </header>

            {/* STATS CARDS ROW */}
            <div className="stats-gallery-row">
                {/* 1. Session */}
                <div className={`stat-card-tactical ${isLive ? 'active' : ''}`}>
                    <div className="card-label">
                        <FiActivity size={13} className="text-indigo-400" />
                        Current Session
                    </div>
                    {isLive ? (
                        <>
                            <div className="main-value">
                                {Math.floor(activeDuration / 60)}h {activeDuration % 60}m
                            </div>
                            <div className="sub-info">
                                Started at {format(new Date(activeShift.created_at), 'HH:mm, MMM d')}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="main-value" style={{ color: '#9ca3af', fontSize: '1.25rem' }}>
                                No active shift
                            </div>
                            <div className="sub-info">Begin a shift from the dashboard</div>
                        </>
                    )}
                </div>

                {/* 2. Total Shifts */}
                <div className="stat-card-tactical">
                    <div className="card-label">
                        <FiTrendingUp size={13} className="text-blue-400" />
                        Total Shifts
                    </div>
                    <div className="main-value">{stats.total}</div>
                    <div className="sub-info">Recorded and reconciled</div>
                </div>

                {/* 3. Mean Variance */}
                <div className={`stat-card-tactical ${stats.avgVariance > 1000 ? 'warning' : ''}`}>
                    <div className="card-label">
                        <FiTrendingUp size={13} className="text-emerald-400" />
                        Mean Variance
                    </div>
                    <div className="main-value">
                        Ksh {stats.avgVariance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="sub-info">Average across all shifts</div>
                </div>

                {/* 4. Critical Flags */}
                <div className={`stat-card-tactical ${stats.critical > 0 ? 'warning' : ''}`}>
                    <div className="card-label">
                        <FiShield size={13} className="text-red-400" />
                        Critical Flags
                    </div>
                    <div className="main-value" style={{ color: stats.critical > 0 ? '#dc2626' : '#111827' }}>
                        {stats.critical}
                    </div>
                    <div className="sub-info">Shifts with variance &gt; Ksh 500</div>
                </div>
            </div>

            {/* OPERATIONAL LOGS TABLE */}
            <section className="shift-audit-section">
                <ShiftAnalyticsTable />
            </section>
        </div>
    );
};
