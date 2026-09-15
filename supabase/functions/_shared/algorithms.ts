/**
 * FORENSIC THRESHOLDS (Standardized across Client & Edge Functions)
 */
export const THRESHOLDS = {
    LEVEL: {
        CRITICAL_LOW: 5,    // Emergency Stop / Dead Stock
        WARNING_LOW: 20,    // Reorder Point
        WARNING_HIGH: 95,   // Operator Warning
        CRITICAL_HIGH: 98,  // Overfill Risk
    },
    TELEMETRY: {
        OFFLINE_WARNING_MINS: 30,
        OFFLINE_CRITICAL_MINS: 60,
    },
    FORENSICS: {
        MIN_THEFT_VOLUME_L: 2.0,
        RAPID_DEFILL_LHR: 50.0,
        LEAK_DETECTION_LHR: 0.7,
        MAX_PUMP_FLOW_LPM: 80.0, // Used for Parallel Pull detection
        DELIVERY_VARIANCE_TOLERANCE_L: 15.0, // Benchmark for disputed status
    }
};

/**
 * Linear Regression: Time-aware Slope Calculation (L/hr)
 */
export function calculateTimeBasedSlope(points: { x: number; y: number }[]): number {
    const n = points.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    // Normalize X to hours from the first point to prevent large number overflow
    const startTime = points[0].x;
    
    for (const p of points) {
        const x = (p.x - startTime) / (1000 * 60 * 60); // Convert ms to hours
        const y = p.y;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return 0;

    return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Instant Change Detection: Delta between two points
 */
export function calculateInstantVolumeChange(current: number, previous: number): number {
    return current - previous;
}

