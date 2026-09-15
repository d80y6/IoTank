import { 
    FiActivity, FiCpu, FiZap, 
    FiCloud, FiCheckCircle,
    FiBarChart2, FiInfo
} from 'react-icons/fi';
import { Tank, TankReading, Alert, DeliveryDocument } from '@/types';
import { useAuth } from '@/hooks/useAuth';

import './ExecutiveOverview.css';

interface ExecutiveOverviewProps {
    tanks: Tank[];
    readings: Record<string, TankReading>;
    stationId: string;
    alerts?: Alert[];
    deliveries?: DeliveryDocument[];
}

export const ExecutiveOverview: React.FC<ExecutiveOverviewProps> = ({ 
    tanks, 
    readings, 
    stationId, 
    alerts = [],
    deliveries = []
}) => {
    const { canSee } = useAuth();
    
    // Dynamically Calculate Metrics from Props
    const activeTanks = tanks.filter(t => t.isActive);

    // 1. Telemetry Integrity Algorithm
    // Checks RSSI, Reporting Frequency, and Data Jitter
    let totalSignal = 0;
    let offlineCount = 0;
    let lateNodes = 0;
    let anySafetyTriggered = false;
    let activeNodes = 0;
    let theftAlert = false;

    activeTanks.forEach(tank => {
        if (!tank?.id) return;
        const reading = readings[tank.id];
        
        const getSignalScore = (quality: string | number | undefined): number => {
            if (typeof quality === 'number') return quality;
            switch(quality) {
                case 'Excellent': return 100;
                case 'Good': return 75;
                case 'Fair': return 50;
                case 'Weak': return 25;
                default: return 0;
            }
        };

        const signal = getSignalScore(reading?.signalQuality ?? (tank as any).telemetryIntegrity);
        
        if (reading) {
            const ageMs = Date.now() - (reading.timestamp || 0);
            const isFresh = ageMs < 5 * 60 * 1000; // 5 mins
            const isStale = ageMs > 15 * 60 * 1000; // 15 mins
            
            // Algorithm: Weighted Integrity
            let integrity = signal;
            if (isStale) integrity *= 0.5;
            if (reading.signalQuality === 'Weak') integrity *= 0.8;
            
            totalSignal += integrity;

            if (isFresh) activeNodes++;
            else if (isStale) offlineCount++;
            else lateNodes++;

            // Forensic Security Check
            if (reading.metadata?.relayStatus === 'TRIGGERED' || tank.currentState === 'leak_suspicion') {
                anySafetyTriggered = true;
            }
            if (tank.currentState === 'rapid_defill') theftAlert = true;
        } else {
            offlineCount++;
            totalSignal += 0;
        }
    });

    const avgSignal = Math.round(activeTanks.length > 0 ? (totalSignal / activeTanks.length) : 0);
    const telemetryValue = activeTanks.length === 0 ? '0%' : `${avgSignal}%`;
    const telemetryStatus = activeTanks.length === 0 ? 'No Data' : 
                          (offlineCount > 0 ? 'Interference' : (lateNodes > 0 ? 'Latency' : 'Optimal'));

    // 2. Safety Relay Status
    const relayValue = theftAlert ? 'THEFT DETECTED' : (anySafetyTriggered ? 'TRIGGERED' : 'ACTIVE');
    const relayStatus = theftAlert ? 'Critical' : (anySafetyTriggered ? 'Secure Mode' : 'Secure');

    // 3. Sensor Health Algorithm
    // Checks for reporting consistency and hardware status
    const healthPcnt = activeTanks.length > 0 ? Math.round((activeNodes / activeTanks.length) * 100) : 0;
    const sensorHealthValue = `${healthPcnt}%`;
    const sensorStatus = offlineCount > 0 ? 'Attention Needed' : (lateNodes > 0 ? 'Check Nodes' : 'Excellent');

    // 4. Delivery Recon (Variance Analysis)
    // Algorithm: Reconciliation of ATG delta vs BOL (Bill of Lading) claimed volume.
    // Flag if any recent delivery has > 0.5% variance or if restock is critical.
    
    let highVarianceFound = false;
    let pendingRestocks = 0;
    
    // Check recent deliveries (last 7 days) for variance
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentDeliveries = deliveries.filter(d => new Date(d.ts).getTime() > sevenDaysAgo);
    recentDeliveries.forEach(d => {
        if (Math.abs(d.variance?.pct || 0) > 0.5) highVarianceFound = true;
    });

    activeTanks.forEach(tank => {
        const reading = readings[tank.id];
        const vol = reading?.volumeCorrected || reading?.volume || tank.currentVolume || 0;
        const lowThreshold = (tank.lowLevelThreshold || 15) * tank.capacity / 100;
        if (vol < lowThreshold) pendingRestocks++;
    });
    
    const deliveryValue = highVarianceFound ? 'Variance!' : (pendingRestocks > 0 ? `${pendingRestocks} Pending` : 'Balanced');
    const deliveryStatus = highVarianceFound ? 'Short Drop?' : (pendingRestocks > 0 ? 'Pending Restock' : 'All Clear');

    // 5. Compliance Algorithm
    // Checks for unresolved critical alerts and audit gaps
    const criticalAlerts = alerts.filter(a => a.severity === 'critical' && !a.resolved);
    const complianceValue = criticalAlerts.length > 0 ? 'At Risk' : '100%';
    const complianceStatus = criticalAlerts.length > 0 ? `${criticalAlerts.length} Violations` : 'Compliant';

    // 6. Market Risk Algorithm
    // Checks for price volatility signals and retail price mismatches
    let priceMismatches = 0;
    activeTanks.forEach(tank => {
        const price = Number((tank as any).metadata?.retailPrice) || 0;
        if (price <= 0) priceMismatches++;
    });
    
    // Simulation: High risk if many tanks lack prices or if there are market volatility alerts
    const riskValue = priceMismatches > 0 ? 'High' : 'Low';
    const riskStatus = priceMismatches > 0 ? 'Missing Prices' : 'Verified';

    const isLoading = activeTanks.length === 0 && stationId !== '';

    const getMetricsState = (val: number | string, isLoader: boolean, customType?: string) => {
        if (isLoader || val === '...') return 'loading';
        if (customType === 'delivery' && highVarianceFound) return 'critical';
        if (customType === 'compliance' && criticalAlerts.length > 0) return 'critical';
        
        const num = typeof val === 'string' ? parseInt(val) : val;
        if (num >= 85) return 'optimal';
        if (num >= 60) return 'fair';
        return 'critical';
    };
    
    const metrics = [
        { 
            label: 'Telemetry Integrity', 
            value: isLoading ? '...' : telemetryValue, 
            status: isLoading ? 'Linking...' : telemetryStatus, 
            icon: <FiCloud />, 
            state: getMetricsState(avgSignal, isLoading),
            desc: 'Real-time node connectivity and data signal stability.'
        },
        { 
            label: 'Safety Relay Status', 
            value: isLoading ? '...' : relayValue, 
            status: isLoading ? 'Linking...' : relayStatus, 
            icon: <FiZap />, 
            state: theftAlert ? 'critical' : (anySafetyTriggered ? 'critical' : (isLoading ? 'loading' : 'secure')),
            desc: 'Intrusion detection and electronic relay shutdown status.'
        },
        ...(canSee(6) ? [
            { 
                label: 'Delivery Recon', 
                value: isLoading ? '...' : deliveryValue, 
                status: isLoading ? 'Linking...' : deliveryStatus, 
                icon: <FiCheckCircle />, 
                state: getMetricsState(100, isLoading, 'delivery'),
                desc: 'Reconciliation of Bill of Lading vs ATG Measured volume.'
            },
            { 
                label: 'Compliance', 
                value: isLoading ? '...' : complianceValue, 
                status: isLoading ? 'Linking...' : complianceStatus, 
                icon: <FiActivity />, 
                state: getMetricsState(100, isLoading, 'compliance'),
                desc: 'Adherence to safety protocols and unresolved critical alerts.'
            }
        ] : []),
        { 
            label: 'Sensor Health', 
            value: isLoading ? '...' : sensorHealthValue, 
            status: isLoading ? 'Linking...' : sensorStatus, 
            icon: <FiCpu />, 
            state: getMetricsState(healthPcnt, isLoading),
            desc: 'Hardware operational status and reporting frequency.'
        },
        ...(canSee(6) ? [
            { 
                label: 'Market Risk', 
                value: isLoading ? '...' : riskValue, 
                status: isLoading ? 'Linking...' : riskStatus, 
                icon: <FiBarChart2 />, 
                state: priceMismatches > 0 ? 'critical' : (isLoading ? 'loading' : 'optimal'),
                desc: 'Financial exposure to price shifts and retail pricing accuracy.'
            }
        ] : []),
    ];

    return (
        <div className="metrics-grid-premium">
            {metrics.map((m, i) => (
                <div key={i} className={`mini-stat-module state-${m.state}`} title={m.desc}>
                    <div className="mini-icon">{m.icon}</div>
                    <div className="mini-content">
                        <div className="flex items-center gap-1">
                            <span className="mini-label">{m.label}</span>
                            <FiInfo size={10} className="text-slate-400 opacity-50" />
                        </div>
                        <div className="mini-value-row">
                            <span className="mini-value">{m.value}</span>
                            <span className="mini-status">
                                {m.status}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};
