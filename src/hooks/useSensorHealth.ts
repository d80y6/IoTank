import { useState, useEffect, useMemo } from 'react';
import { Tank } from '@/types';
import { useAllLatestReadings } from './useSupabase';

export interface SensorHealthStatus {
    tankId: string;
    tankName: string;
    status: 'HEALTHY' | 'DELAYED' | 'OFFLINE';
    latencyMs: number;
    lastSeen: string | null;
}

/**
 * [FORENSIC PROACTIVE MONITOR]
 * Monitors the real-time health of station sensors.
 * Health Rules:
 * - HEALTHY: < 5 minutes since last report
 * - DELAYED: 5-30 minutes since last report
 * - OFFLINE: > 30 minutes since last report
 */
export function useSensorHealth(stationId: string, tanks: Tank[]) {
    const { readings, loading } = useAllLatestReadings(stationId, tanks.map(t => t.id));
    const [now, setNow] = useState(Date.now());

    // Tick every 30s to update latency displays
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(interval);
    }, []);

    const healthData = useMemo(() => {
        return tanks.map(tank => {
            const reading = readings[tank.id];
            // 'timestamp' is the normalized field from mapReading() — raw 'captured_at' does not exist on the mapped object
            const lastSeenTime = reading?.timestamp || 0;
            const latencyMs = lastSeenTime ? now - lastSeenTime : Infinity;
            const lastSeen = lastSeenTime ? new Date(lastSeenTime).toISOString() : null;

            let status: 'HEALTHY' | 'DELAYED' | 'OFFLINE' = 'OFFLINE';
            if (latencyMs < 5 * 60 * 1000) status = 'HEALTHY';
            else if (latencyMs < 30 * 60 * 1000) status = 'DELAYED';

            return {
                tankId: tank.id,
                tankName: tank.name,
                status,
                latencyMs: latencyMs === Infinity ? 0 : latencyMs,
                lastSeen
            } as SensorHealthStatus;
        });
    }, [tanks, readings, now]);

    const globalStatus = useMemo(() => {
        if (healthData.length === 0) return 'UNKNOWN';
        if (healthData.some(h => h.status === 'OFFLINE')) return 'CRITICAL';
        if (healthData.some(h => h.status === 'DELAYED')) return 'WARNING';
        return 'OPTIMAL';
    }, [healthData]);

    return {
        healthData,
        globalStatus,
        loading
    };
}
