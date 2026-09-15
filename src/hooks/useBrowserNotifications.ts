import { useEffect, useRef } from 'react';
import { useAlerts } from './useSupabase';
import { NotificationService } from '@/services/NotificationService';
import { Alert } from '@/types';

/**
 * Hook to automatically trigger browser notifications for new alerts
 */
export function useBrowserNotifications(stationId: string) {
    const { alerts } = useAlerts(stationId, false);
    const prevAlertIds = useRef<Set<string>>(new Set());
    const isFirstRun = useRef(true);

    useEffect(() => {
        if (!NotificationService.isEnabled()) return;

        // On first run, we just populate the existing alert IDs so we don't spam the user
        if (isFirstRun.current) {
            alerts.forEach((alert: Alert) => prevAlertIds.current.add(alert.id));
            isFirstRun.current = false;
            return;
        }

        // Check for new alerts
        alerts.forEach((alert: Alert) => {
            if (!prevAlertIds.current.has(alert.id)) {
                const lowerMsg = (alert.message || '').toLowerCase();
                const lowerTitle = (alert.title || '').toLowerCase();
                const lowerType = (alert.type || '').toLowerCase();

                const isNoise = 
                    lowerMsg.includes('detected on alerts') || 
                    lowerMsg.includes('insert detected') ||
                    lowerMsg.includes('inset detected') ||
                    lowerTitle.includes('detected on alerts') ||
                    lowerTitle.includes('insert detected') ||
                    lowerTitle.includes('inset detected') ||
                    lowerType.includes('detected on alerts') ||
                    lowerType.includes('insert detected') ||
                    lowerType.includes('inset detected');

                if (isNoise) {
                    prevAlertIds.current.add(alert.id);
                    return;
                }

                // This is a new alert!
                NotificationService.show(`IoTank Alert: ${alert.severity.toUpperCase()}`, {
                    body: alert.message,
                    tag: alert.id, // Prevent duplicate notifications for same ID
                    requireInteraction: alert.severity === 'critical'
                });
                prevAlertIds.current.add(alert.id);
            }
        });

        // Optional: Clean up removed alerts from the tracker if needed, 
        // but keeping them in Set prevents re-notifying if they reappear
    }, [alerts]);
}
