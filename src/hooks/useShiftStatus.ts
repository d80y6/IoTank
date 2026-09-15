import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useActiveShift } from './useShifts';

export type ShiftStatus = 'OPEN' | 'CLOSED';

/** M-01 FIX: Safely parse a stored ISO date string to epoch ms. Returns null if the
 * stored value is missing, unparseable, or produces an invalid Date. Without this guard,
 * new Date(corrupted_string).getTime() === NaN flows into all uptime/rate calculations. */
function safeParseStoredTime(key: string): number | null {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    return isNaN(ts) ? null : ts;
}

export const useShiftStatus = () => {
    const { currentUser } = useAuth();
    const stationId = currentUser?.stationId;

    const { activeShift, loading: isLoading, error: shiftError } = useActiveShift(stationId);
    const [uptime, setUptime] = useState<string>('--:--:--');

    // [RESILIENCE SYNC]: Persist confirmed DB state to localStorage so page-reload / network
    // dropouts don't trigger false "CLOSED" alarms.
    useEffect(() => {
        if (isLoading || shiftError) return;
        
        // If query succeeded but returned null, there is no active shift (closed by another user/device)
        if (!activeShift) {
            localStorage.setItem('iotank_shift_status', 'closed');
            return;
        }

        const confirmed = (activeShift.status || '').toLowerCase();
        if (confirmed === 'open' || confirmed === 'closed') {
            localStorage.setItem('iotank_shift_status', confirmed);
        }
        // Persist the confirmed shift OPEN timestamp (not updated_at which changes on any edit)
        const shiftStart = activeShift.opened_at || activeShift.created_at;
        if (shiftStart) {
            localStorage.setItem('iotank_shift_start_time', shiftStart);
        }
    }, [activeShift, shiftError, isLoading]);

    const status = useMemo(() => {
        // [RESILIENCE]: While loading or during a transient network error, read localStorage
        // to avoid flip-flopping to CLOSED and triggering false theft/leak alerts.
        if (isLoading || shiftError) {
            const localStatus = localStorage.getItem('iotank_shift_status');
            if (localStatus === 'open') return 'OPEN';
            if (localStatus === 'closed') return 'CLOSED';
        }

        if (activeShift?.status) {
            // Normalise case: DB may store 'open' or 'OPEN'
            const normalised = (activeShift.status as string).toUpperCase();
            if (normalised === 'OPEN' || normalised === 'CLOSED') return normalised as ShiftStatus;
        }

        // If we successfully reached the DB and activeShift is null, the shift is definitively closed.
        if (!isLoading && !shiftError && !activeShift) {
            return 'CLOSED';
        }

        // [FALLBACK]: Connection timeout / offline resilience
        const localStatus = localStorage.getItem('iotank_shift_status');
        if (localStatus === 'open') return 'OPEN';
        if (localStatus === 'closed') return 'CLOSED';

        return 'CLOSED';
    }, [activeShift, isLoading, shiftError]);

    const openedAt = useMemo(() => {
        if (!activeShift) {
            return safeParseStoredTime('iotank_shift_start_time');
        }
        const time = activeShift.created_at ? new Date(activeShift.created_at).getTime() : null;

        if (status === 'OPEN') {
            return time;
        } else {
            const metadata = activeShift.metadata || {};
            let lastOpened = metadata.last_opened_at ? new Date(metadata.last_opened_at).getTime() : null;
            if (!lastOpened || isNaN(lastOpened)) {
                lastOpened = safeParseStoredTime('iotank_shift_start_time');
            }
            return lastOpened;
        }
    }, [activeShift, status]);

    const closedAt = useMemo(() => {
        if (!activeShift) return null;
        if (status === 'OPEN') return null;
        return activeShift.updated_at ? new Date(activeShift.updated_at).getTime() : null;
    }, [activeShift, status]);

    const updateUptime = useCallback(() => {
        const activeTime = status === 'OPEN' ? openedAt : closedAt;

        if (!activeTime) {
            setUptime('--:--:--');
            return;
        }

        const diff = Date.now() - activeTime;
        const totalSecs = Math.floor(Math.max(0, diff) / 1000);
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;

        setUptime(
            `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        );
    }, [status, openedAt, closedAt]);

    useEffect(() => {
        const timer = setInterval(updateUptime, 1000);
        updateUptime();
        return () => clearInterval(timer);
    }, [updateUptime]);

    return {
        status: status.toLowerCase() as 'open' | 'closed',
        openedAt,
        closedAt,
        uptime,
        isLoading,
        isViewOnly: status === 'CLOSED'
    };
};
