/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface TelemetryEvent {
    id: string;
    type: 'critical' | 'watch' | 'due' | 'suggested' | 'system_error';
    message: string;
    timestamp: number;
    alertId?: string;
    actionLabel?: string;
    onAction?: () => void;
    metadata?: any;
}

interface TelemetryQueueContextType {
    events: TelemetryEvent[];
    pushEvent: (event: Omit<TelemetryEvent, 'id' | 'timestamp'>) => void;
    clearEvent: (id: string) => void;
    clearAll: () => void;
}

const TelemetryQueueContext = createContext<TelemetryQueueContextType | undefined>(undefined);

export const TelemetryQueueProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [events, setEvents] = useState<TelemetryEvent[]>(() => {
        // Version-keyed: bump this key to force a clean queue wipe after a bugfix
        const QUEUE_VERSION = 'v3';
        const versionKey = 'iotank_queue_version';
        if (localStorage.getItem(versionKey) !== QUEUE_VERSION) {
            localStorage.setItem(versionKey, QUEUE_VERSION);
            localStorage.removeItem('iotank_telemetry_queue');
            return [];
        }
        const saved = localStorage.getItem('iotank_telemetry_queue');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                // Corrupted JSON — wipe and start clean to prevent app crash
                localStorage.removeItem('iotank_telemetry_queue');
                return [];
            }
        }
        return [];
    });

    React.useEffect(() => {
        localStorage.setItem('iotank_telemetry_queue', JSON.stringify(events));
    }, [events]);

    const pushEvent = useCallback((event: Omit<TelemetryEvent, 'id' | 'timestamp'>) => {
        setEvents(prev => {
            // Deduplicate by alertId (DB-backed events)
            if (event.alertId && prev.some(e => e.alertId === event.alertId)) {
                return prev;
            }

            // Deduplicate by type + message fingerprint (scan-generated events with no alertId)
            if (!event.alertId) {
                const fingerprint = `${event.type}::${event.message}`;
                if (prev.some(e => !e.alertId && `${e.type}::${e.message}` === fingerprint)) {
                    return prev;
                }
            }

            const newEvent: TelemetryEvent = {
                ...event,
                id: event.alertId ? `event-${event.alertId}` : `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now()
            };
            return [newEvent, ...prev].slice(0, 50); // Keep last 50
        });
    }, []);


    const clearEvent = useCallback((id: string) => {
        setEvents(prev => prev.filter(e => e.id !== id));
    }, []);

    const clearAll = useCallback(() => {
        setEvents([]);
    }, []);

    return (
        <TelemetryQueueContext.Provider value={{ events, pushEvent, clearEvent, clearAll }}>
            {children}
        </TelemetryQueueContext.Provider>
    );
};

export const useTelemetryQueue = () => {
    const context = useContext(TelemetryQueueContext);
    if (context === undefined) {
        throw new Error('useTelemetryQueue must be used within a TelemetryQueueProvider');
    }
    return context;
};
