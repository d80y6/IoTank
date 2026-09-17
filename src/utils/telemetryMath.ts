/**
 * Unified Telemetric Mathematical Core for IoTank
 * Standardizes ETE, Dispense Rate, and Forensic Leak/Theft detection.
 */

export const TELEMETRY_CONSTANTS = {
    DEAD_STOCK_PERCENT: 0.05,
    PRECISION_LEAK_THRESHOLD_LHR: 0.38,
    INSTANT_THEFT_THRESHOLD_L: 50,
    RAPID_DEFILL_LHR: 50,
};

export interface IdleValidationResult {
    delta: number;
    rateLhr: number;
    isTheft: boolean;
    isLeak: boolean;
}

/**
 * Calculates the Estimated Time to Empty (ETE).
 */
export const calculateETE = (currentVolume: number, capacity: number, rateLhr: number): number | null => {
    if (!capacity || capacity <= 0) return null;
    const deadStock = capacity * TELEMETRY_CONSTANTS.DEAD_STOCK_PERCENT;
    const usableVolume = Math.max(0, currentVolume - deadStock);
    
    // Strictly isolate dispense rates (must be positive)
    if (rateLhr <= 0.05) return null; 
    return usableVolume / rateLhr;
};

/**
 * Calculates current rate of change (Forensic Raw)
 */
export const calculateRate = (vStart: number, vEnd: number, hours: number): number => {
    if (hours <= 0) return 0;
    return (vStart - vEnd) / hours; // Positive = Dispensing, Negative = Refilling
};

/**
 * Forensic check for fuel change during idle (closed) hours.
 */
export const validateIdleStability = (vPreviousClose: number, vCurrentOpen: number, hoursClosed: number): IdleValidationResult => {
    const validHours = Math.max(0.1, Math.abs(hoursClosed));
    const delta = vCurrentOpen - vPreviousClose; // Negative means loss
    const rate = Math.abs(delta) / validHours;
    
    return {
        delta,
        rateLhr: rate,
        isTheft: delta < 0 && Math.abs(delta) >= TELEMETRY_CONSTANTS.INSTANT_THEFT_THRESHOLD_L,
        isLeak: delta < 0 && rate >= TELEMETRY_CONSTANTS.PRECISION_LEAK_THRESHOLD_LHR,
    };
};
