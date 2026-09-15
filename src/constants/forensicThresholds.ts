/**
 * FORENSIC THRESHOLDS (Standardized across Client & Edge Functions)
 * Ensure parity with supabase/functions/_shared/algorithms.ts
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
