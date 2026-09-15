/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/config/supabase';
import { validateUUID } from '@/utils/sanitization';
import { logger } from '@/utils/logger';

export type EventCategory = 'SHIFT' | 'DELIVERY' | 'ORDER' | 'TEAM' | 'SECURITY' | 'SYSTEM' | 'FINANCE' | 'AI' | 'CALIBRATION';

export type EventType =
    | 'LOGIN'
    | 'LOGOUT'
    | 'CREATE_TANK'
    | 'UPDATE_TANK'
    | 'DELETE_TANK'
    | 'RESOLVE_ALERT'
    | 'ACKNOWLEDGE_ALERT'
    | 'UPDATE_SETTINGS'
    | 'MFA_ENABLED'
    | 'UPDATE_PROFILE'
    | 'UPDATE_COMPANY'
    | 'MANUAL_ADJUSTMENT'
    | 'SHIFT_CLOSED'
    | 'INVITE_SENT'
    | 'ROLE_UPDATED'
    | 'INVITE_CANCELLED'
    | 'MEMBER_REMOVED'
    | 'SHIFT_STARTED'
    | 'SECURITY_COLLUSION_ALERT'
    | 'UPLOAD_LOGO'
    | 'UPLOAD_AVATAR'
    | 'MFA_DISABLED'
    | 'DELIVERY_RECORDED'
    | 'SETTINGS_CHANGED'
    | 'ALERT_RESOLVED'
    | 'THRESHOLD_UPDATED'
    | 'IDENTITY_MUTATION_ATTEMPT'
    | 'UNAUTHORIZED_ACCESS_ATTEMPT'
    | 'DEVICE_COMMAND'
    | 'ORDER_REQUESTED'
    | 'ORDER_CANCELLED'
    | 'THEFT_DETECTED'
    | 'LEAK_DETECTED'
    | 'HARDWARE_PROVISIONED'
    | 'ALERTS_BULK_RESOLVED'
    | 'ALERTS_BULK_DISMISSED'
    | 'MANUAL_OVERRIDE'
    | 'CALIBRATION_APPLIED'
    | 'EMAIL_SUPPRESSED'
    | 'SMS_SUPPRESSED'
    | 'PUSH_ENABLED'
    | 'PIN_SETUP'
    | 'PRICE_UPDATE';


export interface UnifiedEvent {
    category: EventCategory;
    type: EventType;
    stationId: string;
    description: string;
    severity?: 'INFO' | 'WARNING' | 'CRITICAL';
    metadata?: any;
}

export class AuditService {
    // HIGH-01 FIX: In-memory retry queue for CRITICAL events dropped due to expired sessions.
    // Up to 3 retry attempts with 2s back-off before the event is discarded.
    private static _criticalQueue: Array<Parameters<typeof AuditService.log>> = [];
    private static _retryScheduled = false;

    private static _scheduleRetry() {
        if (AuditService._retryScheduled) return;
        AuditService._retryScheduled = true;
        setTimeout(async () => {
            AuditService._retryScheduled = false;
            const queue = [...AuditService._criticalQueue];
            AuditService._criticalQueue = [];
            for (const args of queue) {
                await AuditService.log(...args).catch(() => {
                    // After 3 total attempts the item is discarded to prevent infinite growth
                });
            }
        }, 2000);
    }

    /**
     * Records a high-fidelity event to the Unified Event Timeline.
     */
    static async log(
        category: EventCategory,
        type: EventType,
        stationId: string,
        description: string,
        severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO',
        metadata: any = {}
    ) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            let user = session?.user;

            // For CRITICAL events: attempt a token refresh if the session is missing,
            // since a stale/expired token might be the cause, not a true logout.
            if (!user && severity === 'CRITICAL') {
                const { data: { session: refreshed } } = await supabase.auth.refreshSession();
                user = refreshed?.user;
            }

            if (!user) {
                if (severity === 'CRITICAL') {
                    // HIGH-01 FIX: Queue CRITICAL events for retry instead of silently discarding.
                    logger.warn(`[AuditService] No session for CRITICAL event "${type}" — queuing for retry.`);
                    AuditService._criticalQueue.push([category, type, stationId, description, severity, metadata]);
                    AuditService._scheduleRetry();
                } else {
                    logger.warn(`[AuditService] No active session found for ${severity} log, skipping.`);
                }
                return;
            }

            // 🟢 Forensic Intelligence Sanitization: Ensure stationId is a valid UUID or null
            const validStationId = validateUUID(stationId) ? stationId : null;

            const { error } = await supabase.from('unified_events').insert({
                station_id: validStationId,
                actor_id: user.id,
                actor_email: user.email,
                event_category: category,
                event_type: type,
                description,
                metadata: {
                    ...metadata,
                    severity,
                    actor_name: user.user_metadata?.full_name || user.email
                },
                created_at: new Date().toISOString()
            });

            if (error) {
                logger.error('[AuditService] Database rejected log:', error.message);
            }
        } catch (error) {
            logger.error('[AuditService] Critical failure during logging:', error);
        }
    }
    // CRIT-003: deleteEvent() removed — unified_events entries are immutable.
    // Deletion is blocked at DB level by the prevent_unified_events_mutation trigger.
    // Use the Supabase service_role console for GDPR purge operations only.
}
