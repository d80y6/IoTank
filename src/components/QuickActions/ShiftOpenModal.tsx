import React from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiShield, FiArrowRight, FiActivity, FiDatabase, FiLock } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTanks, useAllLatestReadings, createShift } from '@/hooks/useSupabase';
import { supabase } from '@/config/supabase';
import { NotificationService } from '@/services/NotificationService';
import { EmailDispatchService } from '@/services/EmailDispatchService';
import { NotificationPreferencesService } from '@/services/NotificationPreferencesService';
import { AuditService } from '@/services/AuditService';
import { validateUUID } from '@/utils/sanitization';
import { validateIdleStability } from '@/utils/telemetryMath';
import { differenceInHours } from 'date-fns';
import { Tank } from '@/types';
import { logger } from '@/utils/logger';
import './ShiftOpenModal.css';

interface ShiftOpenModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ShiftOpenModal: React.FC<ShiftOpenModalProps> = ({ isOpen, onClose }) => {
    const { currentUser } = useAuth();
    const queryClient = useQueryClient();
    const { tanks } = useTanks(currentUser?.stationId || '');
    const { readings } = useAllLatestReadings(currentUser?.stationId || '', tanks.map((t: Tank) => t.id));
    const [isStarting, setIsStarting] = React.useState(false);
    const [isManualOverride, setIsManualOverride] = React.useState(false);
    const [manualVolumes, setManualVolumes] = React.useState<Record<string, string>>({});

    if (!isOpen) return null;

    const handleStart = async () => {
        const now = new Date();
        const nowString = now.toISOString();
        if (!currentUser) return;

        // Validation: Ensure all tanks have volumes if manual override is active
        if (isManualOverride) {
            const missing = tanks.some((t: Tank) => !manualVolumes[t.id] || isNaN(Number(manualVolumes[t.id])));
            if (missing) {
                window.dispatchEvent(new CustomEvent('system-toast', {
                    detail: { title: 'Entry Required', message: 'Please provide valid manual volumes for all tanks.', type: 'error' }
                }));
                return;
            }
        }

        setIsStarting(true);
        try {
            // 1. Update stateless shift tracker in DB
            const { error: shiftError } = await supabase
                .from('current_station_shifts')
                .upsert({
                    station_id: currentUser.stationId,
                    status: 'OPEN',
                    updated_at: nowString,
                    updated_by: currentUser.authUserId
                });

            if (shiftError) throw shiftError;

            // 2. Persistent Start Volumes (Cloud Synchronized Snapshot)
            const startVolumes: Record<string, { opening_volume: number, captured_at: string, is_manual_override: boolean }> = {};
            tanks.forEach((t: Tank) => {
                const currentReading = readings[t.id];
                const liveVolume = currentReading?.volumeCorrected || currentReading?.volume || t.currentVolume || 0;
                
                startVolumes[t.id] = {
                    opening_volume: isManualOverride ? Number(manualVolumes[t.id]) : liveVolume,
                    captured_at: nowString,
                    is_manual_override: isManualOverride
                };
            });

            // 3. Update stateful metadata with tank snapshots
            await supabase
                .from('current_station_shifts')
                .update({ 
                    metadata: { 
                        tank_snapshots: startVolumes,
                        is_manual_override: isManualOverride,
                        override_reason: isManualOverride ? 'Sensor Offline / Manual Dip-stick' : null
                    } 
                })
                .eq('station_id', currentUser.stationId);

            // 4. Create Forensic Record for Reporting
            await createShift(currentUser.stationId, {
                openedAt: nowString,
                closedAt: null,
                durationMin: 0,
                siteId: tanks[0]?.siteId || null,
                nodeId: tanks[0]?.sensorId || 'MANUAL',
                tankId: null,
                pumpReadings: {},
                volumeSoldLiters: 0,
                expected: { cash: 0, mpesa: 0, pos: 0, total: 0 },
                received: { cash: 0, mpesa: 0, pos: 0, total: 0 },
                variance: { amount: 0, pct: 0 },
                status: 'OPEN',
                reviewState: 'OPEN',
                openedBy: { authUserId: currentUser.authUserId, display: currentUser.displayName || currentUser.email || '' },
                closedBy: { authUserId: '', display: '' },
                closingVolume: 0,
                notes: isManualOverride ? `[MANUAL OVERRIDE]: Sensor bypass active.` : '',
                createdAt: nowString,
                operation_type: 'OPEN',
                action_label: isManualOverride ? 'Shift Started (Manual Override)' : 'Shift Started (Telemetric Sync)'
            } as any);

            // Legacy fallback (maintained for zero-downtime transition)
            localStorage.setItem('iotank_shift_start_volumes', JSON.stringify(
                Object.fromEntries(Object.entries(startVolumes).map(([id, data]) => [id, data.opening_volume]))
            ));
            localStorage.setItem('iotank_shift_status', 'open');
            localStorage.setItem('iotank_shift_start_time', nowString);
            localStorage.setItem('iotank_shift_opened_by', JSON.stringify({ 
                authUserId: currentUser.authUserId, 
                display: currentUser.displayName || currentUser.email 
            }));
            
            // 5. Instant UI Synchronization (Bypass real-time lag)
            // Optimistically update the active_shift query to show the new state IMMEDIATELY
            queryClient.setQueryData(['active_shift', currentUser.stationId], {
                status: 'OPEN',
                updated_at: nowString,
                updated_by: currentUser.authUserId
            });

            queryClient.invalidateQueries({ queryKey: ['active_shift', currentUser.stationId] });
            queryClient.invalidateQueries({ queryKey: ['shifts', currentUser.stationId] });

            onClose();

            // 6. Defer all slow dispatches, audits, and checks to background async block
            (async () => {
                try {
                    // Forensic Handshake: Detect Idle Gaps (Leak/Theft while closed)
                    const { data: lastShift } = await supabase
                        .from('shift_closures')
                        .select('closed_at, pump_readings')
                        .eq('station_id', currentUser.stationId)
                        .order('closed_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (lastShift) {
                        const closedAt = new Date(lastShift.closed_at);
                        const hrsClosed = Math.max(0.1, differenceInHours(now, closedAt));
                        const prevReadings = lastShift.pump_readings || {};

                        // Forensic Handshake: run all tank checks in parallel
                        await Promise.all(tanks.map(async (tank: Tank) => {
                            const tankClosureData = prevReadings[tank.name];
                            const prevCloseVol = tankClosureData?.end;
                            const currentOpenVol = readings[tank.id]?.volumeCorrected || readings[tank.id]?.volume || tank.currentVolume || 0;

                            if (prevCloseVol !== undefined) {
                                const forensic = validateIdleStability(prevCloseVol, currentOpenVol, hrsClosed);
                                
                                // Notify UI of the change immediately
                                window.dispatchEvent(new CustomEvent('system-toast', {
                                    detail: {
                                        title: `Idle Sync: ${tank.name}`,
                                        message: `Fuel change during closed shift: ${forensic.delta.toFixed(1)} L (${forensic.rateLhr.toFixed(2)} L/hr)`,
                                        type: forensic.isTheft ? 'error' : (forensic.isLeak ? 'warning' : 'info'),
                                        attribution: 'FORENSIC AUDIT'
                                    }
                                }));

                                if (forensic.isTheft || forensic.isLeak) {
                                    const violationType = forensic.isTheft ? 'theft-detected' : 'leak-detected';
                                    const severity = forensic.isTheft ? 'critical' : 'warning';
                                    const title = forensic.isTheft ? '🔴 THEFT ALERT' : '⚠️ PRECISION LEAK';
                                    const message = forensic.isTheft 
                                        ? `Forensic Gap: Unexpected drop of ${Math.abs(forensic.delta).toFixed(1)}L detected during idle hours. SUSPECTED THEFT.`
                                        : `Precision Leak: Constant loss of ${forensic.rateLhr.toFixed(2)}L/hr detected while station was closed.`;

                                    // Trigger Forensic Alert for Action Queue
                                    if (validateUUID(tank.id)) {
                                        await supabase.from('alerts').insert({
                                            station_id: currentUser.stationId,
                                            tank_id: tank.id,
                                            alert_type: violationType,
                                            severity: severity,
                                            title: title,
                                            message: message,
                                            timestamp: nowString,
                                            alert_data: { delta: forensic.delta, rate: forensic.rateLhr, closedDuration: hrsClosed }
                                        });
                                    }

                                    await AuditService.log(
                                        'SECURITY',
                                        forensic.isTheft ? 'THEFT_DETECTED' : 'LEAK_DETECTED',
                                        currentUser.stationId,
                                        `Forensic alert for ${tank.name}: ${message}`,
                                        forensic.isTheft ? 'CRITICAL' : 'WARNING', 
                                        { forensic, tankId: tank.id }
                                    );
                                }
                            }
                        }));
                    }

                    // Database Notification (Unified Timeline)
                    await AuditService.log(
                        'SHIFT',
                        'SHIFT_STARTED',
                        currentUser.stationId,
                        `Forensic Session Initialized: Shift commenced by personnel [${currentUser.displayName || currentUser.email}] at ${now.toLocaleTimeString()}. Telemetry synchronization verified.`,
                        'INFO',
                        { 
                            startTime: nowString, 
                            operator: currentUser.email,
                            displayName: currentUser.displayName,
                            stationId: currentUser.stationId
                        }
                    );

                    // Log override for forensics if active
                    if (isManualOverride) {
                        await AuditService.log(
                            'SECURITY',
                            'MANUAL_OVERRIDE',
                            currentUser.stationId,
                            `OPERATIONAL ALERT: Sensor bypass activated by ${currentUser.email}. Opening volumes entered manually.`,
                            'WARNING',
                            { manualVolumes }
                        );
                    }

                    // Browser Notification
                    NotificationService.show('🚀 Shift Initialized', {
                        body: `Time: ${now.toLocaleTimeString()}\nOperator: ${currentUser.displayName || currentUser.email}`,
                        tag: 'shift-open'
                    });

                    // Off-Platform SMTP Tactical Email
                    const emailRecipient = currentUser?.stationEmail || currentUser?.email || '';
                    const shouldSendUpdateEmail = currentUser?.authUserId
                        ? await NotificationPreferencesService.shouldSendEmail(currentUser.authUserId, 'updates')
                        : false;

                    if (emailRecipient && shouldSendUpdateEmail) {
                        await EmailDispatchService.sendSecurityAlert({
                            to: emailRecipient,
                            type: 'SYSTEM_CRITICAL',
                            siteName: currentUser?.companyName || 'Fuel Station',
                            details: {
                               timestamp: nowString,
                               operator: currentUser?.email || 'Unknown',
                               description: `Operational shift initialized at ${now.toLocaleTimeString()} by ${currentUser?.email}. Telemetry tracking is now active.`
                            }
                        });
                    } else if (emailRecipient && !shouldSendUpdateEmail) {
                        await AuditService.log(
                            'SYSTEM',
                            'EMAIL_SUPPRESSED',
                            currentUser.stationId,
                            'Shift-start email suppressed by user notification preferences.',
                            'INFO',
                            { userId: currentUser.authUserId, flow: 'shift_open' }
                        );
                    }
                } catch (bgErr) {
                    logger.error('[ShiftOpen] Background worker error:', bgErr);
                }
            })();
        } catch (err) {
            logger.error('Shift activation failed', err, 'SHIFT_OPEN');
            window.dispatchEvent(new CustomEvent('system-toast', {
                detail: {
                    title: 'Shift Activation Failed',
                    message: 'Check connectivity and try again.',
                    type: 'error',
                    attribution: 'ACTIVATION SERVICE'
                }
            }));
        } finally {
            setIsStarting(false);
        }
    };

    const stationName = currentUser?.companyName || 'Fuel Station';

    return createPortal(
        <div className="shift-modal-overlay">
            <div className="shift-modal-content">
                <div className="shift-modal-header">
                    <div className="shift-header-info">
                        <h2>Commence Shift</h2>
                        <p>Initialize operational tracking and telemetry.</p>
                    </div>
                    <button className="shift-close-btn" type="button" onClick={onClose} title="Close" aria-label="Close">
                        <FiX size={20} />
                    </button>
                </div>

                <div className="shift-modal-body">
                    <div className="shift-hero-icon-container">
                        <div className="shift-icon-glow" />
                        <div className="shift-hero-icon">
                            <FiShield size={48} strokeWidth={2.5} />
                        </div>
                    </div>

                    <div className="shift-welcome">
                        <h3>Welcome back, <span className="shift-station-name">{stationName}</span></h3>
                    </div>

                    <p className="shift-description">
                        IoTank systems are primed. Forensic shift recording and telemetry tracking are ready to initialize.
                    </p>

                    <div className="shift-readiness-grid">
                        <div className="readiness-item">
                            <span className="readiness-label">Telemetry</span>
                            <span className="readiness-status"><FiActivity size={12} className="inline mr-1" /> Active</span>
                        </div>
                        <div className="readiness-item">
                            <span className="readiness-label">Tanks</span>
                            <span className="readiness-status"><FiDatabase size={12} className="inline mr-1" /> Bound</span>
                        </div>
                        <div className="readiness-item">
                            <span className="readiness-label">Security</span>
                            <span className="readiness-status"><FiLock size={12} className="inline mr-1" /> Secured</span>
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Hardware Reliability</span>
                            <button 
                                type="button"
                                onClick={() => setIsManualOverride(!isManualOverride)}
                                className={`text-[10px] font-black px-3 py-1.5 rounded-full transition-all ${isManualOverride ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                            >
                                {isManualOverride ? 'MANUAL OVERRIDE ACTIVE' : 'Telemetric Sync Failure?'}
                            </button>
                        </div>

                        {isManualOverride && (
                            <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-5 animate-in fade-in slide-in-from-top-2 duration-300">
                                <p className="text-[11px] text-amber-700 font-bold mb-4 flex items-center gap-2">
                                    <FiShield size={12} />
                                    Sensor bypass enabled. Enter dip-stick readings below. Manual entries are audited.
                                </p>
                                <div className="space-y-3">
                                    {tanks.map((tank: Tank) => (
                                        <div key={tank.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-amber-100 shadow-sm">
                                            <span className="text-xs font-black text-slate-700">{tank.name}</span>
                                            <div className="relative">
                                                <input 
                                                    type="number" 
                                                    placeholder="0.0"
                                                    className="w-24 h-9 text-right pr-6 text-sm font-black text-slate-900 border-none focus:ring-0 bg-transparent"
                                                    value={manualVolumes[tank.id] || ''}
                                                    onChange={(e) => setManualVolumes(prev => ({ ...prev, [tank.id]: e.target.value }))}
                                                />
                                                <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">L</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="shift-actions">
                        <button type="button" className="btn-shift-cancel" onClick={onClose}>
                            Cancel
                        </button>
                        <button 
                            type="button" 
                            className="btn-shift-start" 
                            onClick={handleStart} 
                            disabled={isStarting}
                        >
                            {isStarting ? (
                                'Initializing System...'
                            ) : (
                                <>
                                    Commence Recording
                                    <FiArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};




