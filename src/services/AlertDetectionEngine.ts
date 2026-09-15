/**
 * AlertDetectionEngine â€” Client-side alert detection for IoTank (Supabase/Postgres).
 *
 * Runs entirely in the browser using:
 *  - Tank data + latest readings from Supabase Realtime
 *  - On-load scan + 60s polling interval (orchestrated by useAlertEngine hook)
 *  - Writes to Supabase only when no duplicate active alert exists
 *
 * Detection triggers:
 *  1. Level threshold breach (critical / low)
 *  2. Connectivity lost (last reading too old)
 *  3. Delivery variance (invoice vs measured %)
 *  4. Sensor failure (signal quality < 30)
 *  5. SHIFT-AWARE Forensic Logic:
 *      - Closed Shift: Any drop is an anomaly (Theft vs Leak)
 *      - Open Shift: Drop rate > Max Pump Capacity (Parallel Pull Theft)
 */

import type { Tank, TankReading, Alert } from '@/types';
import { THRESHOLDS } from '@/constants/forensicThresholds';
import { scoreByType } from './AlertScoringEngine';

export interface DetectionContext {
    tank: Tank;
    latestReading: TankReading | null;
    previousReading?: TankReading | null; // For rate calculation (L/hr)
    isShiftOpen?: boolean;           // From useShiftStatus
    telemetryGapMinutes?: number;   // from user thresholds, default 30
    deliveryVarianceThreshold?: number; // % default 5
    refillDetectionThreshold?: number;  // % or L, default 10
    nightDrawdownSensitivity?: 'high' | 'standard' | 'conservative';
    maxPumpFlowRateLpm?: number;     // Max Liters Per Minute of terminal pumps
}

export interface DraftAlert {
    tankId: string;
    siteId: string;
    type: string;
    title: string;
    description: string;
    message: string;
    severity: Alert['severity'];
    severityLabel: string;
    score: number;
    source: 'system';
    state: 'ACTIVE';
    resolved: boolean;
    detectionMethod: string;
    aiConfidence?: number;
    rootCauseLink?: { type: string; id: string; label: string };
    metadata?: any;
}

/**
 * Run all detection checks for a single tank and return draft alerts.
 * Does NOT write to Supabase â€” that is the caller's responsibility.
 */
export function detectTankAlerts(ctx: DetectionContext): DraftAlert[] {
    const { tank, latestReading } = ctx;
    const drafts: DraftAlert[] = [];
    const now = Date.now();

    const telemetryGapMs = (ctx.telemetryGapMinutes ?? THRESHOLDS.TELEMETRY.OFFLINE_WARNING_MINS) * 60 * 1000;
    
    // Safety check
    if (!tank || !latestReading) return [];

    const fuelLevel = (() => {
        const raw = latestReading.fuelLevel;
        if (raw !== undefined && raw > 0) return raw;
        
        // [FIX]: Forensic Fallback - Calculate level if missing or 0 but volume exists
        const vol = latestReading.volumeCorrected || latestReading.volume || 0;
        if (vol > 0 && tank.capacity) {
            const calculated = (vol / tank.capacity) * 100;
            return Math.min(100, Math.max(0, calculated));
        }
        return raw;
    })();

    // â”€â”€ 1. CRITICAL LEVEL BREACH (5%) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (fuelLevel !== undefined && fuelLevel <= THRESHOLDS.LEVEL.CRITICAL_LOW) {
        const { score, label } = scoreByType('low_level_critical', 0.95);
        drafts.push({
            tankId: tank.id,
            siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
            type: 'low_level',
            title: `CRITICAL LOW: ${tank.name} (Dead Stock Breach)`,
            description: `Level at ${fuelLevel.toFixed(1)}%. Pump protection activated at ${THRESHOLDS.LEVEL.CRITICAL_LOW}%. Shutdown imminent.`,
            message: `${tank.name} level critical: ${fuelLevel.toFixed(1)}%`,
            severity: 'critical',
            severityLabel: label,
            score,
            source: 'system',
            state: 'ACTIVE',
            resolved: false,
            detectionMethod: 'deterministic',
            aiConfidence: 0.95,
            rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
        });
    }
    // â”€â”€ 2. LOW LEVEL WARNING (20%) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    else if (
        fuelLevel !== undefined &&
        fuelLevel > THRESHOLDS.LEVEL.CRITICAL_LOW &&
        fuelLevel <= THRESHOLDS.LEVEL.WARNING_LOW
    ) {
        const { score, label } = scoreByType('low_level_warning', 0.80);
        drafts.push({
            tankId: tank.id,
            siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
            type: 'low_level',
            title: `LOW LEVEL: ${tank.name} Reorder Point`,
            description: `Level at ${fuelLevel.toFixed(1)}%. Recommend reordering fuel to maintain operations. Threshold: ${THRESHOLDS.LEVEL.WARNING_LOW}%.`,
            message: `${tank.name} fuel level low: ${fuelLevel.toFixed(1)}%`,
            severity: 'warning',
            severityLabel: label,
            score,
            source: 'system',
            state: 'ACTIVE',
            resolved: false,
            detectionMethod: 'deterministic',
            aiConfidence: 0.80,
            rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
        });
    }

    // â”€â”€ 2.6 HIGH LEVEL & OVERFILL (95% / 98%) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (fuelLevel !== undefined && fuelLevel >= THRESHOLDS.LEVEL.CRITICAL_HIGH) {
        const { score, label } = scoreByType('composite_supply_risk', 0.98);
        drafts.push({
            tankId: tank.id,
            siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
            type: 'overfill',
            title: `CRITICAL OVERFILL: ${tank.name}`,
            description: `Level at ${fuelLevel.toFixed(1)}%. Immediate spill risk. Halt all delivery operations. Threshold: ${THRESHOLDS.LEVEL.CRITICAL_HIGH}%.`,
            message: `CRITICAL OVERFILL: ${tank.name} at ${fuelLevel.toFixed(1)}%`,
            severity: 'critical',
            severityLabel: label,
            score,
            source: 'system',
            state: 'ACTIVE',
            resolved: false,
            detectionMethod: 'deterministic',
            aiConfidence: 0.98,
            rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
        });
    } else if (fuelLevel !== undefined && fuelLevel >= THRESHOLDS.LEVEL.WARNING_HIGH) {
        const { score, label } = scoreByType('composite_supply_risk', 0.85);
        drafts.push({
            tankId: tank.id,
            siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
            type: 'warning_high',
            title: `HIGH LEVEL: ${tank.name}`,
            description: `Level at ${fuelLevel.toFixed(1)}%. Monitoring required. Threshold: ${THRESHOLDS.LEVEL.WARNING_HIGH}%.`,
            message: `HIGH LEVEL: ${tank.name} at ${fuelLevel.toFixed(1)}%`,
            severity: 'warning',
            severityLabel: label,
            score,
            source: 'system',
            state: 'ACTIVE',
            resolved: false,
            detectionMethod: 'deterministic',
            aiConfidence: 0.85,
            rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
        });
    }

    // â”€â”€ 3. CONNECTIVITY LOST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const readingTimestamp = typeof latestReading.timestamp === 'string' 
        ? new Date(latestReading.timestamp).getTime() 
        : latestReading.timestamp;

    if (latestReading && (now - readingTimestamp) > telemetryGapMs) {
        const gapMinutes = Math.round((now - readingTimestamp) / 60000);
        const { score, label } = scoreByType('telemetry_gap', 0.85);
        
        // [FORENSIC UPGRADE]: Detect 3-Day (4320 mins) Sensor Blackout
        const isBlackout = gapMinutes >= 4320; 
        const isCritical = gapMinutes >= THRESHOLDS.TELEMETRY.OFFLINE_CRITICAL_MINS;
        
        drafts.push({
            tankId: tank.id,
            siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
            type: isBlackout ? 'sensor-blackout' : 'connectivity-lost',
            title: isBlackout ? `SENSOR BLACKOUT: ${tank.name}` : (isCritical ? `CRITICAL OFFLINE: ${tank.name}` : `Offline: ${tank.name}`),
            description: isBlackout 
                ? `CRITICAL DOWNTIME: ${tank.name} sensor has been blacked out for ${formatForensicDuration(gapMinutes)}. This indicates total power/link failure for 3+ consecutive days.`
                : `Real-time link interrupted. ${tank.name} hardware has been unreachable for ${formatForensicDuration(gapMinutes)}. Monitoring paused.`,
            message: isBlackout 
                ? `SENSOR BLACKOUT: ${tank.name} unreachable for 3+ days`
                : `Offline: ${tank.name} connection lost for ${formatForensicDuration(gapMinutes)}`,
            severity: (isCritical || isBlackout) ? 'critical' : 'warning',
            severityLabel: (isCritical || isBlackout) ? 'CRITICAL' : label,
            score: isBlackout ? 100 : (isCritical ? 98 : score),
            source: 'system',
            state: 'ACTIVE',
            resolved: false,
            detectionMethod: 'deterministic',
            aiConfidence: 0.95,
            rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
            metadata: { 
                type: isBlackout ? 'SENSOR_BLACKOUT' : 'CONNECTIVITY_LOST',
                telemetryGapMinutes: gapMinutes 
            },
        });
    }

    // â”€â”€ 4. SENSOR FAILURE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isQualityFailing = (quality: string | number) => {
        if (typeof quality === 'number') return quality < 30;
        return quality === 'Weak' || quality === 'Unusable' || quality === 'Offline';
    };

    if (latestReading && isQualityFailing(latestReading.signalQuality)) {
        const { score, label } = scoreByType('sensor_failure', 0.78);
        drafts.push({
            tankId: tank.id,
            siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
            type: 'sensor_failure',
            title: `Sensor degradation on ${tank.name}`,
            description: `Signal quality at ${latestReading.signalQuality}%. Readings may be unreliable.`,
            message: `${tank.name}: sensor signal quality ${latestReading.signalQuality}%`,
            severity: 'warning',
            severityLabel: label,
            score,
            source: 'system',
            state: 'ACTIVE',
            resolved: false,
            detectionMethod: 'deterministic',
            aiConfidence: 0.78,
            rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
        });
    }

    // â”€â”€ 5. SHIFT-AWARE ANOMALIES (THEFT, LEAK, PARALLEL PULL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { isShiftOpen = false, previousReading } = ctx;

    if (latestReading && previousReading) {
        const prevVol = previousReading.volumeCorrected || previousReading.volume || 0;
        const currVol = latestReading.volumeCorrected || latestReading.volume || 0;
        
        const prevTime = typeof previousReading.timestamp === 'string' 
            ? new Date(previousReading.timestamp).getTime() 
            : previousReading.timestamp;
            
        const currTime = typeof latestReading.timestamp === 'string' 
            ? new Date(latestReading.timestamp).getTime() 
            : latestReading.timestamp;

        const volumeDrop = prevVol - currVol; // Positive if consuming
        
        // [FIX]: Enforce a minimum time delta (5 minutes) for extrapolation to prevent 
        // mathematically explosive L/hr rates (e.g. 282,000 L/hr) caused by sensor jitter 
        // delivering two packets with a very small time gap.
        const rawTelemetryGapHr = Math.abs(currTime - prevTime) / (1000 * 60 * 60);
        const effectiveGapHr = Math.max(rawTelemetryGapHr, 5 / 60); // Minimum 5 min denominator
        
        const dropRate = volumeDrop > 0 ? (volumeDrop / effectiveGapHr) : 0; 
        // [PHASE 3]: Backfill Anomaly Guard
        // If the gap between readings is too large (e.g., > 2 hours), the dropRate calculation 
        // for "Rapid Drawdown" is unreliable. We skip theft detection to avoid false positives.
        const telemetryGapHr = Math.abs(currTime - prevTime) / (1000 * 60 * 60);
        const isBackfilledBatch = telemetryGapHr > 2.0; 

        // Heuristics
        const rapidDropThreshold = tank.rapidDefillThreshold || THRESHOLDS.FORENSICS.RAPID_DEFILL_LHR; 
        const leakThreshold = tank.leakageThreshold || THRESHOLDS.FORENSICS.LEAK_DETECTION_LHR;
        
        const maxPumpFlow = (ctx.maxPumpFlowRateLpm || THRESHOLDS.FORENSICS.MAX_PUMP_FLOW_LPM) * 60; // L/hr

        if (!isShiftOpen) {
            // CASE A: Shift is CLOSED. Any drop is suspicious.
            if (!isBackfilledBatch && volumeDrop > THRESHOLDS.FORENSICS.MIN_THEFT_VOLUME_L && dropRate > rapidDropThreshold) {
                const { score, label } = scoreByType('composite_supply_risk', 0.98);
                drafts.push({
                    tankId: tank.id,
                    siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
                    type: 'theft_detected',
                    title: `THEFT DETECTED: ${tank.name}`,
                    description: `Unauthorized rapid drop of ${volumeDrop.toFixed(1)}L while shift is CLOSED. Intensity: ${dropRate.toFixed(0)} L/hr.`,
                    message: `CRITICAL: Rapid drawdown on ${tank.name} (Closed Shift)`,
                    severity: 'critical',
                    severityLabel: label,
                    score,
                    source: 'system',
                    state: 'ACTIVE',
                    resolved: false,
                    detectionMethod: 'deterministic',
                    aiConfidence: 0.98,
                    rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
                    metadata: { type: 'theft_closed', dropRate, volumeLost: volumeDrop }
                });
            } else if (dropRate > leakThreshold) {
                const { score, label } = scoreByType('leak_detected', 0.85);
                drafts.push({
                    tankId: tank.id,
                    siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
                    type: 'leak_detected',
                    title: `LEAK SUSPICION: ${tank.name}`,
                    description: `Persistent volume decline of ${dropRate.toFixed(2)} L/hr during 'Quiet Hours' (Closed Shift). Possible infrastructure failure.`,
                    message: `WARNING: Forensic leak detection on ${tank.name}`,
                    severity: 'warning',
                    severityLabel: label,
                    score,
                    source: 'system',
                    state: 'ACTIVE',
                    resolved: false,
                    detectionMethod: 'deterministic',
                    aiConfidence: 0.85,
                    rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
                    metadata: { type: 'leak_suspicion', dropRate }
                });
            }
        } else {
            // CASE B: Shift is OPEN. Drop is expected, but siphoning (Parallel Pull) is theft.
            if (!isBackfilledBatch && volumeDrop > THRESHOLDS.FORENSICS.MIN_THEFT_VOLUME_L && dropRate > maxPumpFlow) {
                const { score, label } = scoreByType('composite_supply_risk', 0.95);
                drafts.push({
                    tankId: tank.id,
                    siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
                    type: 'theft_detected',
                    title: `PARALLEL PULL THEFT: ${tank.name}`,
                    description: `Anomalous discharge of ${dropRate.toFixed(0)} L/hr detected. This exceeds the maximum physical capacity of the terminal pumps (${maxPumpFlow} L/hr). Siphoning suspected during operations.`,
                    message: `CRITICAL: Parallel theft suspected on ${tank.name} (Open Shift)`,
                    severity: 'critical',
                    severityLabel: label,
                    score,
                    source: 'system',
                    state: 'ACTIVE',
                    resolved: false,
                    detectionMethod: 'deterministic',
                    aiConfidence: 0.95,
                    rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
                    metadata: { type: 'THEFT_OPEN_PARALLEL', dropRate, maxPumpFlow }
                });
            }
        }

        // --- 6. REFILL DETECTION (Automated Delivery Sensing) ---
        //
        // [WARNING] OWNERSHIP NOTE
        // All volume-increase events (whether authorized (open shift) or
        // unauthorized (closed shift)) are exclusively tracked and finalized
        // by the STATEFUL engine in useAlertEngine.ts.
        //
        // That engine:
        //   - applies multi-cycle confirmation (eliminates sensor noise)
        //   - captures accurate start/end volumes across the delivery window
        //   - writes the single, definitive alert to the database
        //
        // This stateless engine must NOT emit 'unauthorized_refill' or normal
        // 'refill_detected' drafts for volume increases, as doing so creates
        // duplicate alerts and race conditions in the notification pipeline.
        //
        // OFFLINE BACKFILL GUARD
        // If the gap between the two readings is > 2 hours (isBackfilledBatch),
        // the volume jump is caused by historical data syncing after the hardware
        // came back online. Skip all refill alerting entirely to prevent a flood
        // of false anomaly alerts on reconnect.
        //
        const refillThreshold = ctx.tank.capacity ? (ctx.tank.capacity * 0.01) : (ctx.refillDetectionThreshold || 20);
        const volumeIncrease = currVol - prevVol;

        if (!isBackfilledBatch && volumeIncrease > refillThreshold) {
            // The ONLY case where the stateless engine emits a refill-related
            // draft is a true physical INTEGRITY BREACH: where the measured
            // volume exceeds the tank's known physical capacity by > 2%.
            // This cannot be confirmed by the stateful engine (which tracks
            // relative deltas), so it is kept here as a hard-limit guard.
            const isOverCapacity = tank.capacity && (currVol > tank.capacity * 1.02);

            if (isOverCapacity) {
                const { score, label } = scoreByType('composite_supply_risk', 0.98);
                drafts.push({
                    tankId: tank.id,
                    siteId: tank.siteId || '', // MED-02: siteId may be undefined; fallback to empty string
                    type: 'anomaly',
                    title: `INTEGRITY BREACH: Over-Capacity on ${tank.name}`,
                    description: `Critical integrity error: Tank level (${currVol.toFixed(1)}L) exceeds physical capacity (${tank.capacity}L). This indicates severe calibration drift or sensor malfunction.`,
                    message: `CRITICAL: ${tank.name} measured volume exceeds physical capacity. Integrity breach.`,
                    severity: 'critical',
                    severityLabel: label,
                    score,
                    source: 'system',
                    state: 'ACTIVE',
                    resolved: false,
                    detectionMethod: 'deterministic',
                    aiConfidence: 0.98,
                    rootCauseLink: { type: 'tank', id: tank.id, label: tank.name },
                    metadata: {
                        type: 'INTEGRITY_BREACH',
                        volumeIncrease,
                        startVolume: prevVol,
                        endVolume: currVol,
                        startTimestamp: prevTime,
                        endTimestamp: currTime,
                        tankCapacity: tank.capacity
                    }
                });
            }
            // All other refill types (normal + unauthorized) are owned
            // exclusively by the stateful tracker in useAlertEngine.ts.
        }
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Final output filter
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Suppress any draft types that are exclusively owned by the stateful
    // engine in useAlertEngine.ts to guarantee zero duplicate alerts:
    //   - 'refill_detected'   â†’ handled by stateful tracker
    //   - 'unauthorized_refill' â†’ handled by stateful tracker
    // 'anomaly' type for over-capacity is the ONLY exception and is kept.
    return drafts.filter(d => d.type !== 'refill_detected' && d.type !== 'unauthorized_refill');
}

/**
 * Forensic Time Formatter: Converts minutes into a professional, high-density 
 * string (e.g., 3h 10mins or 1d 4h), skipping units that are zero.
 */
export function formatForensicDuration(minutes: number): string {
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}mins`;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours < 24) {
        let res = `${hours}h`;
        if (mins > 0) res += ` ${mins}mins`;
        return res;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    
    let res = `${days}d`;
    if (remainingHours > 0) res += ` ${remainingHours}h`;
    if (mins > 0) res += ` ${mins}mins`;
    return res;
}

/**
 * Filter out draft alerts that are already active in the system to avoid spam.
 */
export function filterDuplicates(drafts: DraftAlert[], activeAlerts: Alert[]): DraftAlert[] {
    return drafts.filter(draft => {
        return !activeAlerts.some(active => {
            // Defensive: handle both raw DB rows (alert_type) and mapped Alert objects (type)
            const activeType = (active as any).alert_type ?? active.type;
            return (
                active.tankId === draft.tankId &&
                activeType === draft.type &&
                !active.resolved
            );
        });
    });
}


/**
 * MED-09 FIX: Implemented correlation logic — groups co-occurring alerts (3+) for the
 * same tank into a composite 'correlated' alert with the highest severity and score.
 * Previously this was an identity no-op function (return alerts) that added overhead
 * on every render without any benefit.
 *
 * Tanks with fewer than 3 alerts pass through unchanged.
 */
export function correlateAlerts(alerts: Alert[]): Alert[] {
    // Group by tank
    const byTank = new Map<string, Alert[]>();
    const noTank: Alert[] = [];

    for (const alert of alerts) {
        if (!alert.tankId) { noTank.push(alert); continue; }
        const group = byTank.get(alert.tankId) || [];
        group.push(alert);
        byTank.set(alert.tankId, group);
    }

    const result: Alert[] = [...noTank];

    for (const [tankId, group] of byTank.entries()) {
        if (group.length < 3) {
            // Not enough alerts to correlate — pass through unchanged
            result.push(...group);
        } else {
            // Build a single composite alert from the group
            const topAlert = group.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a));
            const composite: Alert = {
                ...topAlert,
                id: `correlated:${tankId}`,
                type: 'correlated' as any,
                title: `${group.length} Active Alerts — ${topAlert.title}`,
                message: group.map(a => a.title).join(' · '),
                score: Math.min(100, (topAlert.score ?? 0) + group.length * 2),
                metadata: {
                    ...topAlert.metadata,
                    correlatedCount: group.length,
                    correlatedIds: group.map(a => a.id).filter(Boolean),
                    correlatedTypes: group.map(a => a.type)
                }
            };
            result.push(composite);
        }
    }

    // Re-sort by score descending
    return result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
