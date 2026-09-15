/**
 * useAlertEngine — Spark-safe client-side alert monitoring hook.
 *
 * Responsibilities:
 * - Runs detection scan on component mount
 * - Re-runs every 60 seconds
 * - Writes new alerts to Firestore only if no duplicate active alert exists
 * - Computes and exposes the Risk Index for the executive summary card
 * - Supports dynamic threshold configuration from user preferences
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, TankReading, RiskIndex, Tank } from '@/types';
import { supabase } from '@/config/supabase';
import { logger } from '@/utils/logger';
import { useTanks } from './useSupabase';
import { useShiftStatus } from './useShiftStatus';
import { useAuth } from './useAuth';
import { NotificationService } from '../services/NotificationService';
import { EmailDispatchService } from '../services/EmailDispatchService';
import { SmsDispatchService } from '../services/SmsDispatchService';
import { NotificationPreferencesService } from '../services/NotificationPreferencesService';
import { detectTankAlerts, filterDuplicates, correlateAlerts } from '../services/AlertDetectionEngine';
import { useTelemetryQueue } from '@/contexts/TelemetryQueueContext';
import { THRESHOLDS } from '@/constants/forensicThresholds';
import { validateUUID } from '@/utils/sanitization';
import { classifyVolumeChange, VolumePoint } from '@/utils/refillClassifier';

export interface AlertEngineThresholds {
    telemetryGapMinutes: number;
    deliveryVarianceThreshold: number;
    nightDrawdownSensitivity: 'high' | 'standard' | 'conservative';
    refillDetectionThreshold: number;
}

const DEFAULT_THRESHOLDS: AlertEngineThresholds = {
    telemetryGapMinutes: THRESHOLDS.TELEMETRY.OFFLINE_WARNING_MINS,
    deliveryVarianceThreshold: 5,
    nightDrawdownSensitivity: 'standard',
    refillDetectionThreshold: 20, // 20L fallback
};

const SCAN_INTERVAL_MS = 60000; // 60 Seconds (Rapid detection for first alert)
const NOTIFICATION_DEBOUNCE_MS = 1800000; // 30 Minutes (Avoid consecutive alert noise)

function computeRiskIndex(activeAlerts: Alert[]): RiskIndex {
    const fuelAlerts = activeAlerts.filter(a => ['low_level', 'leak_detected', 'overfill', 'theft_detected', 'unauthorized_refill', 'refill'].includes(a.type));
    const systemAlerts = activeAlerts.filter(a => ['sensor_failure', 'telemetry_gap', 'connectivity_lost', 'high_temperature'].includes(a.type));
    const complianceAlerts = activeAlerts.filter(a => ['compliance_deadline', 'delivery_variance', 'market_news', 'regulatory_update'].includes(a.type));

    const topFuelScore = fuelAlerts.length > 0
        ? Math.max(...fuelAlerts.map(a => a.score ?? 0))
        : 0;
    const topSystemScore = systemAlerts.length > 0
        ? Math.max(...systemAlerts.map(a => a.score ?? 0))
        : 0;
    const topComplianceScore = complianceAlerts.length > 0
        ? Math.max(...complianceAlerts.map(a => a.score ?? 0))
        : 0;

    const toLabel = (s: number): 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' => {
        if (s >= 90) return 'CRITICAL';
        if (s >= 70) return 'HIGH';
        if (s >= 40) return 'MODERATE';
        return 'LOW';
    };

    const toComplianceLabel = (s: number): 'STABLE' | 'WATCH' | 'AT_RISK' => {
        if (s >= 70) return 'AT_RISK';
        if (s >= 40) return 'WATCH';
        return 'STABLE';
    };

    return {
        fuel: { score: topFuelScore, label: toLabel(topFuelScore) },
        system: { score: topSystemScore, label: toLabel(topSystemScore) },
        compliance: { score: topComplianceScore, label: toComplianceLabel(topComplianceScore) },
    };
}

export function useAlertEngine(
    stationId: string,
    thresholds: AlertEngineThresholds = DEFAULT_THRESHOLDS
) {
    const { currentUser } = useAuth();
    const { tanks } = useTanks(stationId);
    // ⚠️ HOOKS ORDER CRITICAL: useShiftStatus must come before all useRef/useState.
    // It internally calls useQuery (react-query) whose internal hook count can vary
    // under network errors. Placing it mid-block after refs caused hook slot drift.
    const { status: shiftStatus, isLoading: isShiftLoading } = useShiftStatus();
    const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
    const [riskIndex, setRiskIndex] = useState<RiskIndex>({
        fuel: { score: 0, label: 'LOW' },
        system: { score: 0, label: 'LOW' },
        compliance: { score: 0, label: 'STABLE' },
    });
    const [isScanning, setIsScanning] = useState(false);
    const isScanningRef = useRef(false);
    const [hasLoadedAlerts, setHasLoadedAlerts] = useState(false);
    const [lastScanTime, setLastScanTime] = useState<number>(() => {
        const saved = localStorage.getItem(`iotank_last_scan_${stationId}`);
        return saved ? parseInt(saved) : 0;
    });
    const latestReadingsRef = useRef<Record<string, TankReading | null>>({});
    const previousReadingsRef = useRef<Record<string, TankReading | null>>({});
    const runScanRef = useRef<() => void>(() => {}); // CRIT-04: stable ref so interval never captures stale closure
    const refillSessionsRef = useRef<Record<string, { 
        isActive: boolean; 
        startVolume: number; 
        startTime: number; 
        stableCount: number;
        lastInflowVolume: number;
        classification?: any;
    }>>({});
    const theftSessionsRef = useRef<Record<string, { 
        isActive: boolean; 
        startVolume: number; 
        lastTime: number; 
    }>>({});
    const readingHistoryRef = useRef<Record<string, VolumePoint[]>>({}); // useShiftStatus moved above
    // [PERSISTENCE UPGRADE]: Load from localStorage and purge stale entries (>24h)
    const [toastedAlerts, setToastedAlertsState] = useState<Map<string, number>>(() => {
        const saved = localStorage.getItem(`iotank_toast_memory_${stationId}`);
        if (saved) {
            try {
                const now = Date.now();
                const entries = JSON.parse(saved) as [string, number][];
                // Purge entries older than 24 hours
                const validEntries = entries.filter(([_, timestamp]) => (now - timestamp) < 86400000);
                return new Map(validEntries);
            } catch (e) {
                return new Map();
            }
        }
        return new Map();
    });

    const toastedAlertsRef = useRef<Map<string, number>>(toastedAlerts);
    const initialScanPerformedRef = useRef(false);
    const tankConfigsRef = useRef<Record<string, { height: number; offset: number }>>({});
    const pendingInsertsRef = useRef<Set<string>>(new Set()); // Track alerts currently being written

    // Sync ref and localStorage when state changes
    useEffect(() => {
        toastedAlertsRef.current = toastedAlerts;
        localStorage.setItem(`iotank_toast_memory_${stationId}`, JSON.stringify(Array.from(toastedAlerts.entries())));
    }, [toastedAlerts, stationId]);

    const { pushEvent } = useTelemetryQueue();
    // Guard: only sync DB → Queue once on mount, not on every realtime refresh
    const hasQueueSyncedRef = useRef(false);

    // ── Subscribe to active alerts from Supabase ────────────────────────────
    useEffect(() => {
        if (!stationId) return;

        const fetchAlerts = async () => {
            try {
                const { data, error } = await supabase
                    .from('alerts')
                    .select('*')
                    .eq('station_id', stationId)
                    .eq('is_resolved', false)
                    .order('created_at', { ascending: false });

                if (error) throw error;
                
                // Map DB alerts to Alert interface
                const mappedAlerts: Alert[] = (data || []).map(row => ({
                    id: row.id,
                    tankId: row.tank_id,
                    type: row.alert_type,
                    severity: row.severity,
                    title: row.title,
                    message: row.message,
                    timestamp: new Date(row.created_at).getTime(),
                    resolved: row.is_resolved,
                    score: row.alert_data?.score || 0,
                    metadata: row.metadata || {}
                } as Alert));

                const sorted = mappedAlerts.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
                setActiveAlerts(sorted);
                setRiskIndex(computeRiskIndex(sorted));
                setHasLoadedAlerts(true);

                // Sync DB alerts → Action Queue only on INITIAL load.
                // Subsequent realtime refreshes only update activeAlerts (for filterDuplicates),
                // NOT the visual queue — that prevents queue flooding on every DB change.
                if (!hasQueueSyncedRef.current) {
                    hasQueueSyncedRef.current = true;
                    sorted.forEach(alert => {
                        pushEvent({
                            type: alert.severity === 'critical' ? 'critical' : (alert.severity === 'warning' ? 'watch' : 'due'),
                            message: alert.message,
                            alertId: alert.id,
                            actionLabel: 'Investigate',
                            metadata: {
                                tankId: alert.tankId,
                                ...alert.metadata
                            }
                        });
                    });
                }
            } catch (err) {
                logger.error('[AlertEngine] Alert fetch error:', err);
            }
        };

        fetchAlerts();

        const channel = supabase
            .channel(`engine-alerts:${stationId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'alerts' },
                () => fetchAlerts()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [stationId]);


    // ── Detection scan ───────────────────────────────────────────────────────
    const runScan = useCallback(async () => {
        if (!tanks.length || isScanningRef.current || !hasLoadedAlerts || isShiftLoading) return;
        
        // Prevent redundant scans if performed very recently (within 10s)
        const now = Date.now();
        if (now - lastScanTime < 10000) return;

        isScanningRef.current = true;
        setIsScanning(true);
        setLastScanTime(now);
        localStorage.setItem(`iotank_last_scan_${stationId}`, now.toString());

        try {
            const userId = currentUser?.authUserId;
            const allowAlertEmails = userId
                ? await NotificationPreferencesService.shouldSendEmail(userId, 'alerts')
                : true;

            const allDrafts = tanks.flatMap((tank: Tank) => {
                // [CONFIGURATION GUARD]: If tank config changed (offset/height), flush history to avoid false jumps
                const currentCfg = { height: tank.height || 0, offset: tank.sensorOffset || 0 };
                const prevCfg = tankConfigsRef.current[tank.id];
                
                if (prevCfg && (prevCfg.height !== currentCfg.height || prevCfg.offset !== currentCfg.offset)) {
                    logger.info(`[AlertEngine] Config change detected for ${tank.name}. Flushing history.`, null, 'ALERT_ENGINE');
                    delete previousReadingsRef.current[tank.id];
                    delete readingHistoryRef.current[tank.id];
                }
                tankConfigsRef.current[tank.id] = currentCfg;

                const latestReading = latestReadingsRef.current[tank.id];
                const previousReading = previousReadingsRef.current[tank.id];
                
                // 1. Core Alerts
                const drafts = detectTankAlerts({
                    tank,
                    latestReading: latestReading ?? null,
                    previousReading: previousReading ?? null,
                    isShiftOpen: shiftStatus === 'open',
                    telemetryGapMinutes: thresholds.telemetryGapMinutes,
                    deliveryVarianceThreshold: thresholds.deliveryVarianceThreshold,
                    refillDetectionThreshold: thresholds.refillDetectionThreshold,
                    nightDrawdownSensitivity: thresholds.nightDrawdownSensitivity,
                });

                // 1.5 LIVE CUMULATIVE LOSS TRACKING FOR THEFT/LEAK
                const theftDrafts = drafts.filter(d => d.type === 'theft_detected' || d.type === 'leak_detected');
                if (!theftSessionsRef.current[tank.id]) {
                    theftSessionsRef.current[tank.id] = { isActive: false, startVolume: 0, lastTime: 0 };
                }
                const theftSession = theftSessionsRef.current[tank.id];
                const currentVol = tank.currentVolume || latestReading?.volumeCorrected || latestReading?.volume || 0;

                if (theftDrafts.length > 0) {
                    if (!theftSession.isActive) {
                        theftSession.isActive = true;
                        // Capture the volume immediately preceding the drop as our baseline
                        const prevVol = previousReading?.volumeCorrected || previousReading?.volume || currentVol;
                        theftSession.startVolume = prevVol > currentVol ? prevVol : currentVol;
                    }
                    theftSession.lastTime = Date.now();

                    // Calculate live cumulative volume lost since the theft began
                    const cumulativeLost = theftSession.startVolume - currentVol;
                    theftDrafts.forEach(draft => {
                        if (draft.metadata) {
                            draft.metadata.volumeLost = cumulativeLost > 0 ? cumulativeLost : draft.metadata.volumeLost;
                        }
                    });
                } else {
                    // No theft detected this cycle. If 60 seconds pass without a theft draft, end the session.
                    if (theftSession.isActive && (Date.now() - theftSession.lastTime > 60000)) {
                        theftSession.isActive = false;
                    }
                }

                // 2. DEAD STOCK DETECTION (Inventory Stagnation > 3 Days)
                // Logic: If current volume is significant (>500L) but hasn't decreased by >5L in 72 hours
                if (latestReading && (tank.currentVolume || 0) > 500) {
                     const lastMovementStr = localStorage.getItem(`iotank_last_movement_${tank.id}`);
                     const lastVol = parseFloat(localStorage.getItem(`iotank_vol_snapshot_${tank.id}`) || '0');
                     // MED-03 FIX: Renamed from 'now' to 'scanNow' to avoid shadowing the outer const now.
                     const scanNow = Date.now();
                     
                     if (Math.abs((tank.currentVolume || 0) - lastVol) > 10) {
                         localStorage.setItem(`iotank_last_movement_${tank.id}`, scanNow.toString());
                         localStorage.setItem(`iotank_vol_snapshot_${tank.id}`, (tank.currentVolume || 0).toString());
                     } else if (lastMovementStr && (scanNow - parseInt(lastMovementStr) > 259200000)) {
                         drafts.push({
                             tankId: tank.id,
                             siteId: tank.siteId || '',
                             // HIGH-02 FIX: type must be 'anomaly' with metadata.subType='dead_stock'
                             // (NOT 'dead_stock') so the SMS dispatch check below matches correctly.
                             type: 'anomaly',
                             severity: 'critical',
                             severityLabel: 'CRITICAL',
                             title: '🔴 ALERT: DEAD STOCK DETECTED',
                             description: `Inventory in ${tank.name} has not moved for 72 hours. Risk of product aging or sales blockage.`,
                             message: `Inventory in ${tank.name} has not moved for 72 hours.`,
                             score: 85,
                             source: 'system',
                             state: 'ACTIVE',
                             resolved: false,
                             detectionMethod: 'deterministic',
                             metadata: { stagnantHours: 72, subType: 'dead_stock' }
                         });
                     }
                }

                // 3. SENSOR BLACKOUT (>3 Days)
                if (latestReading && (now - new Date(latestReading.timestamp).getTime() > 259200000)) {
                    drafts.push({
                        tankId: tank.id,
                        siteId: tank.siteId || '',
                        type: 'sensor-blackout',
                        severity: 'critical',
                        severityLabel: 'CRITICAL',
                        title: '🔴 CRITICAL: 72HR SENSOR BLACKOUT',
                        description: `Sensor for ${tank.name} has been offline for over 3 days. Critical data loss occurring.`,
                        message: `Sensor for ${tank.name} has been offline for over 3 days.`,
                        score: 95,
                        source: 'system',
                        state: 'ACTIVE',
                        resolved: false,
                        detectionMethod: 'deterministic',
                        metadata: { hoursOffline: 72 }
                    });
                }

                // 2. STATEFUL REFILL TRACKING (Powered by Forensic Turbulence Analysis)
                if (latestReading) {
                    const history = readingHistoryRef.current[tank.id] || [];
                    if (history.length < 2) return drafts.filter(d => d.type !== 'refill_detected'); 

                    const refillThreshold = tank.capacity ? (tank.capacity * 0.01) : (thresholds.refillDetectionThreshold || 20);
                    const analysis = classifyVolumeChange(history, refillThreshold);
                    
                    if (!refillSessionsRef.current[tank.id]) {
                        refillSessionsRef.current[tank.id] = { isActive: false, startVolume: 0, startTime: 0, stableCount: 0, lastInflowVolume: 0 };
                    }
                    
                    const session = refillSessionsRef.current[tank.id];

                    // ── Case A: NOISE DETECTED ──
                    if (analysis.signal === 'SENSOR_SPIKE') {
                        if (session.isActive) {
                            logger.warn(`[AlertEngine] REFILL_ABORTED: Sensor noise detected during active session on ${tank.name}. ${analysis.reason}`, null, 'ALERT_ENGINE');
                            session.isActive = false;
                        }
                        return drafts.filter(d => d.type !== 'refill_detected');
                    }

                    // ── Case B: REFILL STARTING ──
                    if (!session.isActive && (analysis.signal === 'REFILL_CONFIRMED' || analysis.signal === 'REFILL_CANDIDATE')) {
                        session.isActive = true;
                        session.startVolume = analysis.startVolume; 
                        session.startTime = analysis.startTimestamp;
                        session.stableCount = 0;
                        session.lastInflowVolume = analysis.endVolume;
                        session.classification = analysis;

                        const isUnauthorized = shiftStatus !== 'open';
                        
                        logger.info(`[AlertEngine] REFILL_START on ${tank.name}. Pinpointed Start: ${analysis.startVolume.toFixed(1)}L. Conf: ${(analysis.confidenceScore * 100).toFixed(0)}%. ${analysis.reason}`, null, 'ALERT_ENGINE');

                        window.dispatchEvent(new CustomEvent('system-toast', {
                            detail: {
                                title: isUnauthorized ? '🔴 SECURITY: UNAUTHORIZED INFLOW' : 'Refill Protocol: INITIATED',
                                message: isUnauthorized 
                                    ? `ALERT: Fuel inflow detected on ${tank.name} while shift is CLOSED. Monitoring unauthorized activity.`
                                    : `Sensors detected inflow for ${tank.name}. Monitoring volume climb. Pre-refill Volume: ${analysis.startVolume.toFixed(0)}L`,
                                type: isUnauthorized ? 'error' : 'refill',
                                attribution: 'ATG_SENSE_AUTO'
                            }
                        }));

                        // Trigger Modal immediately so user can enter invoice while flowing
                        pushEvent({
                            type: isUnauthorized ? 'critical' : 'due',
                            message: isUnauthorized
                                ? `SECURITY BREACH: ${tank.name} is receiving product while site is CLOSED!`
                                : `REFUEL STARTED: ${tank.name} is receiving product.`,
                            actionLabel: isUnauthorized ? 'INTERCEPT & LOG' : 'Enter Invoice',
                            metadata: {
                                tankId: tank.id,
                                modalType: 'refill_verification',
                                alertData: {
                                    tank_id: tank.id,
                                    metadata: {
                                        startVolume: analysis.startVolume,
                                        type: isUnauthorized ? 'UNAUTHORIZED_REFILL_IN_PROGRESS' : 'REFILL_IN_PROGRESS'
                                    }
                                }
                            }
                        });
                    } else if (session.isActive) {
                        // Check for continued growth or stabilization
                        const volChange = (analysis.endVolume - session.lastInflowVolume);

                        if (volChange > 1.0 || analysis.signal === 'REFILL_CONFIRMED' || analysis.signal === 'REFILL_CANDIDATE') { 
                            session.stableCount = 0;
                            session.lastInflowVolume = analysis.endVolume;
                            session.classification = analysis;
                            logger.debug(`[AlertEngine] REFILL_IN_PROGRESS on ${tank.name}. Current: ${analysis.endVolume.toFixed(1)}L. Rate: ${analysis.ingressRateLpm.toFixed(0)}Lpm`, null, 'ALERT_ENGINE');
                        } else {
                            // No significant growth detected in this scan
                            session.stableCount += 1;
                            logger.debug(`[AlertEngine] REFILL_STABILIZING on ${tank.name}. Stable for ${session.stableCount} cycle(s).`, null, 'ALERT_ENGINE');

                            // Inform the user that the delivery is settling
                            if (session.stableCount === 1) {
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: '🔄 Stabilizing Reading...',
                                        message: `Inflow on ${tank.name} settled. Forensic capture progress: ${((session.stableCount / 2) * 100).toFixed(0)}%.`,
                                        type: 'info',
                                        duration: 6000,
                                        attribution: 'ATG_SENSE_AUTO'
                                    }
                                }));
                            }
                        }

                        // 🛑 END REFILL: Stability reached (require 2 stable reading cycles)
                        if (session.stableCount >= 2) {
                            const endVolume = analysis.endVolume;
                            const deliveredVolume = endVolume - session.startVolume;

                            // ─────────────────────────────────────────────────────────────
                            // 🛡️ SENSOR NOISE GUARD
                            // ─────────────────────────────────────────────────────────────
                            if (deliveredVolume < refillThreshold) {
                                session.isActive = false;
                                logger.debug(
                                    `[AlertEngine] REFILL_ABORTED (sensor noise) on ${tank.name}. ` +
                                    `Net delta ${deliveredVolume.toFixed(1)}L is below threshold ${refillThreshold.toFixed(1)}L. ` +
                                    `Session discarded.`,
                                    null, 'ALERT_ENGINE'
                                );
                                return drafts.filter(d => d.type !== 'refill_detected'); 
                            }

                            session.isActive = false;

                            logger.debug(`[AlertEngine] REFILL_COMPLETE on ${tank.name}. Captured Delta: ${deliveredVolume.toFixed(1)}L`, null, 'ALERT_ENGINE');

                            const isUnauthorized = shiftStatus !== 'open';
                            
                            // Create the permanent alert for reconciliation
                            const refillAlert = {
                                station_id: stationId,
                                tank_id: tank.id,
                                alert_type: isUnauthorized ? 'unauthorized_refill' : 'refill',
                                severity: isUnauthorized ? 'critical' : 'info',
                                title: isUnauthorized 
                                    ? `🔴 Unauthorized Out-of-Hours Refill: ${tank.name}`
                                    : `Refill Verification Required: ${tank.name}`,
                                message: isUnauthorized
                                    ? `SECURITY BREACH: Fuel inflow of ${deliveredVolume.toFixed(1)}L detected while shift is CLOSED. Out-of-hours delivery requires immediate verification.`
                                    : `Automated detection completed. Net Sensory Delivery: ${deliveredVolume.toFixed(1)}L. (Start: ${session.startVolume.toFixed(1)}L -> End: ${endVolume.toFixed(1)}L)`,
                                alert_data: { score: isUnauthorized ? 98 : 95 },
                                is_resolved: false,
                                metadata: {
                                    type: isUnauthorized ? 'UNAUTHORIZED_REFILL_COMPLETE' : 'REFILL_COMPLETE',
                                    startVolume: session.startVolume,
                                    endVolume: endVolume,
                                    deliveredVolume: deliveredVolume,
                                    turbulenceScore: analysis.turbulenceScore,
                                    ingressRate: analysis.ingressRateLpm,
                                    detectedAt: new Date().toISOString()
                                }
                            };

                            // CRIT-03 + HIGH-05 FIX: Converted from fire-and-forget .then() to an
                            // async IIFE with proper error handling. If the RPC fails, the error is
                            // logged to the structured logger — forensic alert + email/SMS are no
                            // longer silently dropped on a network or DB failure.
                            (async () => {
                                try {
                                    const { data: savedAlerts, error: rpcErr } = await supabase.rpc('upsert_alert_v2', {
                                        p_station_id: refillAlert.station_id,
                                        p_tank_id: refillAlert.tank_id,
                                        p_alert_type: refillAlert.alert_type,
                                        p_title: refillAlert.title,
                                        p_message: refillAlert.message,
                                        p_severity: refillAlert.severity,
                                        p_metadata: refillAlert.metadata || {}
                                    });

                                    if (rpcErr) throw rpcErr;

                                    const savedAlert = Array.isArray(savedAlerts) ? savedAlerts[0] : savedAlerts;
                                    const alertWithId = { ...refillAlert, id: savedAlert?.id };

                                    // Finalize notification
                                    window.dispatchEvent(new CustomEvent('system-toast', {
                                        detail: {
                                            title: isUnauthorized ? '🔴 UNAUTHORIZED REFILL COMPLETED' : '✅ Refuel Stabilized',
                                            message: isUnauthorized
                                                ? `SECURITY: Volume stabilized on ${tank.name} (+${deliveredVolume.toFixed(0)}L). Shift was CLOSED during inflow.`
                                                : `Volume on ${tank.name} has settled. Final sensory gain: ${deliveredVolume.toFixed(0)}L. Populating delivery record...`,
                                            type: isUnauthorized ? 'error' : 'success',
                                            attribution: 'ATG_SENSE_AUTO'
                                        }
                                    }));

                                    // Trigger Modal again (or refresh it) with end data
                                    window.dispatchEvent(new CustomEvent('system-modal', {
                                        detail: {
                                            modalType: 'refill_verification',
                                            data: alertWithId
                                        }
                                    }));

                                    pushEvent({
                                        type: 'critical',
                                        message: isUnauthorized
                                            ? `SECURITY ALERT: ${tank.name} gained ${deliveredVolume.toFixed(0)}L while CLOSED.`
                                            : `REFUEL COMPLETED: ${tank.name} gained ${deliveredVolume.toFixed(0)}L. Verify delivery invoice now.`,
                                        actionLabel: 'Finalize Forensic Record',
                                        metadata: {
                                            tankId: tank.id,
                                            modalType: 'refill_verification',
                                            alertData: alertWithId
                                        }
                                    });

                                    // [FORENSIC UPGRADE]: Tactical Email Dispatch for Refill
                                    if (allowAlertEmails) {
                                        EmailDispatchService.sendSecurityAlert({
                                            to: currentUser?.stationEmail || currentUser?.email || 'security@iotank.com',
                                            type: isUnauthorized ? 'UNAUTHORIZED_REFILL' : 'REFILL',
                                            siteName: currentUser?.companyName || 'IoTank Site',
                                            details: {
                                                timestamp: new Date().toISOString(),
                                                description: refillAlert.message,
                                                lossVolume: deliveredVolume,
                                                dropRate: 0 // Refill is gain, not loss
                                            }
                                        }).catch(err => logger.error('[AlertEngine] Refill Email dispatch failed:', err));
                                    }
                                } catch (rpcErr) {
                                    logger.error('[AlertEngine] Refill forensic RPC failed — alert not saved:', rpcErr);
                                }
                            })();
                        }
                    }
                }

                // Filter out 'refill_detected' from drafts as we handle it statefully above
                return drafts.filter(d => d.type !== 'refill_detected');
            });

            const uniqueDrafts = filterDuplicates(allDrafts, activeAlerts);

            // Filter against "Toast Memory" to prevent re-toasting known active issues
            const draftsToToast = uniqueDrafts.filter(draft => {
                if (!draft) return false;
                const key = `${draft.tankId}:${draft.type}`;
                const lastToastTime = toastedAlertsRef.current.get(key);
                const now = Date.now();
                
                if (lastToastTime && (now - lastToastTime) < NOTIFICATION_DEBOUNCE_MS) {
                    return false;
                }
                
                // Add/Update memory
                setToastedAlertsState(prev => {
                    const next = new Map(prev);
                    next.set(key, now);
                    return next;
                });
                return true;
            });

            if (uniqueDrafts.length > 0) {
                // [FIX]: Check pendingInsertsRef to avoid 409 Conflicts during rapid scans
                const draftsToInsert = uniqueDrafts.filter(draft => {
                    if (!draft) return false;
                    const key = `${draft.tankId}:${draft.type}`;
                    if (pendingInsertsRef.current.has(key)) return false;
                    pendingInsertsRef.current.add(key);
                    return true;
                });

                if (draftsToInsert.length === 0) return;

                const dbAlerts = draftsToInsert.map(draft => ({
                    station_id: stationId,
                    tank_id: draft.tankId,
                    alert_type: draft.type,
                    severity: draft.severity,
                    title: draft.title,
                    message: draft.message,
                    alert_data: { score: draft.score },
                    is_resolved: false,
                    metadata: draft.metadata || {}
                }));

                try {
                    // [RPC CONVERSION]: Use the forensic-safe upsert protocol
                    for (const alert of dbAlerts) {
                        // 🟢 UUID Validation: Prevent 400 errors from "ghost" or malformed IDs
                        const isValidStation = validateUUID(alert.station_id);
                        const isValidTank = !alert.tank_id || validateUUID(alert.tank_id);

                        if (!isValidStation || !isValidTank) {
                            logger.warn('[AlertEngine] Skipping alert insertion due to invalid UUID:', { station_id: alert.station_id, tank_id: alert.tank_id, type: alert.alert_type });
                            continue;
                        }

                        const { error } = await supabase.rpc('upsert_alert_v2', {
                            p_station_id: alert.station_id,
                            p_tank_id: alert.tank_id,
                            p_alert_type: alert.alert_type,
                            p_title: alert.title,
                            p_message: alert.message,
                            p_severity: alert.severity,
                            p_metadata: alert.metadata || {}
                        });
                        if (error) throw error;
                        // MED-08 FIX: Removed empty dead-code if(newAlertId) block.
                        // Real-time subscription handles activeAlerts state updates.
                    }
                } catch (err) {
                    logger.error('[useAlertEngine] Alert insertion failed:', err);
                } finally {
                    // Cleanup pending refs after a safety delay to allow realtime sync to catch up
                    setTimeout(() => {
                        draftsToInsert.forEach(draft => {
                            pendingInsertsRef.current.delete(`${draft.tankId}:${draft.type}`);
                        });
                    }, 2000);
                }
                
                // [NEW]: Universal Toast, Email & SMS Notification
                // Uses the filtered "draftsToToast" to satisfy the "Optimal Frequency" requirement (Debounce)
                for (const draft of draftsToToast) {
                    const isCritical = draft.severity === 'critical';
                    
                    // 1. Browser Toast
                    window.dispatchEvent(new CustomEvent('system-toast', {
                        detail: {
                            title: isCritical ? `🔴 ${draft.title}` : draft.title,
                            message: draft.message,
                            type: isCritical ? 'error' : (draft.severity === 'warning' ? 'warning' : 'info'),
                            attribution: 'SYSTEM_SENSE'
                        }
                    }));

                    // 2. Off-Platform SMTP Tactical Email & SMS
                    if (isCritical) {
                        // HIGH-02 FIX: Dead Stock SMS — draft.type is 'anomaly', use metadata.subType
                        if ((draft.metadata as any)?.subType === 'dead_stock') {
                            SmsDispatchService.sendSms({
                                // @ts-ignore
                                to: currentUser?.phoneNumber || '',
                                message: `IoTank ALERT: Dead stock detected on ${draft.title}. Inventory has not moved in 72 hours.`
                            }).catch(err => logger.error('[AlertEngine] Dead Stock SMS dispatch failed:', err));
                        }

                        // HIGH-03 FIX: Sensor Blackout Email — type is 'sensor-blackout' not 'telemetry_blackout'
                        if (draft.type === 'sensor-blackout') {
                            EmailDispatchService.sendSecurityAlert({
                                to: currentUser?.email || '',
                                type: 'SYSTEM_CRITICAL',
                                siteName: currentUser?.companyName || 'IoTank Site',
                                details: {
                                    timestamp: new Date().toISOString(),
                                    description: `CRITICAL: ${draft.message}. Please check sensor power and connectivity immediately.`
                                }
                            }).catch(err => logger.error('[AlertEngine] Blackout Email dispatch failed:', err));
                        }
                    }
                    const meta = (draft.metadata as any);
                    const suspectedType = meta?.type || draft.type?.toUpperCase();
                    const isTheft = suspectedType?.includes('THEFT');
                    const isLeak = suspectedType?.includes('LEAK');
                    const isConnectivityLost = suspectedType?.includes('CONNECTIVITY_LOST') || suspectedType?.includes('TELEMETRY_GAP') || suspectedType?.includes('SENSOR_BLACKOUT');
                    const isRefill = suspectedType?.includes('REFILL');
                    const isLevelBreach = suspectedType?.includes('LOW_LEVEL') || suspectedType?.includes('OVERFILL');
                    const isDeadStock = suspectedType?.includes('LOW_LEVEL') && draft.severity === 'critical';
                    const isSensorBlackout = suspectedType === 'SENSOR_BLACKOUT';

                    if (suspectedType && (isTheft || isLeak || isConnectivityLost || isRefill || isLevelBreach)) {
                        const siteName = draft.rootCauseLink?.label || 'IOTANK SITE';
                        const recipientEmail = currentUser?.stationEmail || currentUser?.email || 'security@iotank.com';
                        const recipientPhone = currentUser?.phoneNumber;

                        const allowAlertEmails = userId 
                            ? await NotificationPreferencesService.shouldSendEmail(userId, 'alerts')
                            : true;

                        if (allowAlertEmails) {
                            // Standard alert email
                            EmailDispatchService.sendSecurityAlert({
                                to: recipientEmail,
                                type: (isTheft ? 'THEFT' : isRefill ? 'REFILL' : (isConnectivityLost ? 'DISCONNECT' : suspectedType)) as any,
                                siteName: siteName,
                                details: {
                                    timestamp: new Date().toISOString(),
                                    dropRate: meta?.dropRate || 0,
                                    lossVolume: meta?.volumeLost || meta?.volumeDelta || 0,
                                    description: draft.description
                                }
                            }).catch(err => logger.error('[AlertEngine] Standard Alert Email dispatch failed:', err));

                            // [USER REQUEST]: Sensor Blackout for 3 days sends additional email to iotank.com@gmail.com
                            if (isSensorBlackout) {
                                EmailDispatchService.sendSecurityAlert({
                                    to: 'iotank.com@gmail.com',
                                    type: 'SYSTEM_CRITICAL',
                                    siteName: siteName,
                                    details: {
                                        timestamp: new Date().toISOString(),
                                        description: `CRITICAL SENSOR BLACKOUT: ${siteName} hardware has been unreachable for over 72 hours. Immediate technical intervention required.`
                                    }
                                }).catch(err => logger.error('[AlertEngine] Global Blackout Email dispatch failed:', err));
                            }
                        }

                        // Dispatch SMS (Twilio) for high-severity events
                        if (recipientPhone && (isTheft || isLevelBreach || isConnectivityLost)) {
                            const canSendSms = userId
                                ? await NotificationPreferencesService.shouldSendSms(userId, 'alerts', { isCritical })
                                : false;

                            // Dead Stock & Blackout always trigger SMS if phone exists (high-priority bypass)
                            if (canSendSms || isDeadStock || isSensorBlackout) {
                                const tank = (tanks as Tank[])?.find((t: Tank) => t.id === draft.tankId);
                                const tankName = tank?.name || 'Unknown Tank';
                                
                                const smsBody = isDeadStock 
                                    ? `🚨 IOTANK DEAD STOCK [${siteName}]: ${tankName} at ${meta.fuelLevel?.toFixed(1) || 'critical'}%. Pumps may be damaged if operations continue. Reorder fuel NOW.`
                                    : (isSensorBlackout 
                                        ? `🚨 IOTANK BLACKOUT [${siteName}]: ${tankName} sensor offline for 3+ DAYS. Power/Link failure suspected.` 
                                        : `🚨 IOTANK ALERT [${siteName}]: ${draft.title}. Please investigate immediately.`);
                                
                                SmsDispatchService.sendSms({
                                    to: recipientPhone,
                                    message: smsBody
                                }).catch(err => logger.error('[AlertEngine] SMS dispatch failed:', err));
                            }
                        }
                        
                        // Browser Push Notification (System-level)
                        if (isTheft || isLeak || isDeadStock || isSensorBlackout) {
                            NotificationService.notifySecurity(
                                isTheft ? 'THEFT' : (isDeadStock ? 'SYSTEM_CRITICAL' : (isSensorBlackout ? 'DISCONNECT' : 'LEAK')),
                                siteName,
                                draft.description
                            );
                        }
                    }
                }

                // Forensic & Modal Triggers (Always push to Action Queue regardless of debounce)
                uniqueDrafts.forEach(draft => {
                    const meta = (draft.metadata as any);
                    const suspectedType = meta?.type; 
                    
                    // 1. [STANDARD]: Push to dynamic TelemetryQueue for ActionQueue visibility
                    // EXCLUSION: If it's a security/forensic event, it will be handled by the specialized block below
                    const isConnectivityLost = suspectedType?.includes('CONNECTIVITY_LOST') || suspectedType?.includes('TELEMETRY_GAP');
                    const isRefill = suspectedType?.includes('REFILL');
                    const isLevelBreach = suspectedType?.includes('LOW_LEVEL') || suspectedType?.includes('OVERFILL');
                    const isTheft = suspectedType?.includes('THEFT');
                    const isLeak = suspectedType?.includes('LEAK');

                    if (!suspectedType || (!isTheft && !isLeak && !isConnectivityLost && !isRefill && !isLevelBreach)) {
                        pushEvent({
                            type: draft.severity === 'critical' ? 'critical' : draft.severity === 'warning' ? 'watch' : 'due',
                            message: draft.message,
                            actionLabel: 'Investigate',
                            metadata: {
                                tankId: draft.tankId
                            }
                        });
                    }


                    // 2. [FORENSIC UPGRADE]: Push specific Intrusion Modal to Telemetry Queue for Security Events
                    if (isTheft || isLeak || isConnectivityLost || isRefill || isLevelBreach) {
                        const siteName = draft.rootCauseLink?.label || 'IOTANK SITE';
                        pushEvent({
                            type: draft.severity === 'critical' ? 'critical' : 'watch',
                            message: draft.message,
                            actionLabel: isTheft ? 'INTERCEPT NOW' : (isRefill ? 'Review Refill' : 'Investigate'),
                            metadata: {
                                tankId: draft.tankId,
                                modalType: (isTheft || isLeak) ? 'security_intrusion' : undefined,
                                forensicData: {
                                    type: isTheft ? 'THEFT' : (isRefill ? 'REFILL' : (isConnectivityLost ? 'DISCONNECT' : suspectedType)),
                                    dropRate: meta.dropRate,
                                    volumeLost: meta.volumeLost || meta.volumeDelta,
                                    tankName: siteName,
                                    timestamp: new Date().toISOString()
                                }
                            }
                        });
                    }
                });
            }
        } catch (err) {
            logger.warn('[AlertEngine] Scan error:', err);
        } finally {
            isScanningRef.current = false;
            setIsScanning(false);
        }
    }, [tanks, activeAlerts, stationId, thresholds, shiftStatus, pushEvent]);

    // CRIT-04 FIX: Always point runScanRef at the latest runScan so the 60s
    // setInterval never holds a stale closure over activeAlerts.
    useEffect(() => { runScanRef.current = runScan; });

    // ── On-load + 60s polling ────────────────────────────────────────────────
    useEffect(() => {
        if (!tanks.length || !hasLoadedAlerts) return;

        // On first mount after data load, check if we need an immediate scan
        const now = Date.now();
        if (now - lastScanTime >= SCAN_INTERVAL_MS) {
            runScanRef.current();
        }

        // Use a wrapper that always calls the latest runScan via the ref.
        const interval = setInterval(() => runScanRef.current(), SCAN_INTERVAL_MS);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tanks.length, stationId, hasLoadedAlerts]);

    // ── Expose reading cache setter so parent can update it ──────────────────
    const updateReading = useCallback((tankId: string, reading: TankReading | null) => {
        if (reading && latestReadingsRef.current[tankId]?.id !== reading.id) {
            previousReadingsRef.current[tankId] = latestReadingsRef.current[tankId];
            latestReadingsRef.current[tankId] = reading;

            // Maintain history for turbulence analysis (max 30 readings ~30 mins)
            if (!readingHistoryRef.current[tankId]) {
                readingHistoryRef.current[tankId] = [];
            }
            const history = readingHistoryRef.current[tankId];
            history.push({ 
                volume: reading.volumeCorrected || reading.volume || 0, 
                timestamp: new Date(reading.timestamp).getTime() || Date.now() 
            });
            if (history.length > 30) history.shift();

            // [FIX]: Dynamic Boot Scan - If this is the first set of data, fire an immediate scan
            // This ensures notifications aren't 'silent' until the first interval.
            const allTanksHaveData = tanks.every((t: Tank) => latestReadingsRef.current[t.id]);
            if (allTanksHaveData && !initialScanPerformedRef.current) {
                initialScanPerformedRef.current = true;
                logger.debug('[AlertEngine] BOOT: Hardware data acquired. Firing initial bootstrap scan.', null, 'ALERT_ENGINE');
                runScan();
            }

            // Rapid refill detection: If we see a massive spike or possible inflow, don't wait 60s
            const currVol = reading.volumeCorrected || reading.volume || 0;
            const prevVol = previousReadingsRef.current[tankId]?.volumeCorrected || previousReadingsRef.current[tankId]?.volume || 0;
            const diff = Math.abs(currVol - prevVol);
            const refillThreshold = tanks.find((t: Tank) => t.id === tankId)?.capacity ? (tanks.find((t: Tank) => t.id === tankId)!.capacity * 0.01) : 20;

            if (diff > refillThreshold || (history.length >= 2 && diff > 5)) {
                // Trigger near-immediate scan (100ms debounce) for rapid events
                setTimeout(runScan, 100);
            }
        }
    }, [tanks, runScan]);

    /**
     * Get correlated (composite) view of alerts — grouped by tank if 3+ present.
     */
    const correlatedAlerts = correlateAlerts(activeAlerts);

    return {
        activeAlerts,
        correlatedAlerts,
        riskIndex,
        isScanning,
        updateReading,
    };
}
