import { Tank, TankReading } from '@/types';

/**
 * Temperature safety thresholds for different fuel types
 * Based on industry standards and fuel chemistry
 */
export interface TemperatureThresholds {
    optimal: { min: number; max: number };
    safe: { min: number; max: number };
    criticalHigh: number;
    criticalLow: number;
    flashPoint: number;
}

/**
 * Default temperature thresholds by fuel type
 * Can be overridden by user settings
 */
export const DEFAULT_TEMPERATURE_THRESHOLDS: Record<string, TemperatureThresholds> = {
    gasoline: {
        optimal: { min: 10, max: 20 },      // Ideal storage: 10-20°C
        safe: { min: -20, max: 25 },         // Warning buffer: -20 to 25°C (before hitting -40/30 critical)
        criticalHigh: 30,                    // Rapid vaporization above 30°C
        criticalLow: -40,                    // Chemically unstable below -40°C
        flashPoint: -43,                     // Flash point: -43°C
    },
    diesel: {
        optimal: { min: 10, max: 20 },      // Ideal storage: 10-20°C
        safe: { min: 5, max: 25 },           // Warning buffer: 5 to 25°C (before hitting 0/30 critical)
        criticalHigh: 30,                    // Oxidation and microbial growth above 30°C
        criticalLow: 0,                      // Gelling begins at 0°C
        flashPoint: 52,                      // Flash point: 52°C (hazardous above this)
    },
    kerosene: {
        optimal: { min: 10, max: 20 },
        safe: { min: -5, max: 25 },          // Warning buffer: -5 to 25°C (before hitting -10/30 critical)
        criticalHigh: 30,
        criticalLow: -10,
        flashPoint: 38,
    },
    'jet-fuel': {
        optimal: { min: 10, max: 20 },
        safe: { min: -20, max: 25 },         // Warning buffer: -20 to 25°C (before hitting -40/30 critical)
        criticalHigh: 30,
        criticalLow: -40,
        flashPoint: 38,
    },
    biodiesel: {
        optimal: { min: 10, max: 20 },
        safe: { min: 8, max: 25 },           // Warning buffer: 8 to 25°C (before hitting 5/30 critical)
        criticalHigh: 30,
        criticalLow: 5,
        flashPoint: 130,
    },
};

/**
 * Temperature safety status
 */
export type TemperatureSafetyStatus = 'SAFE' | 'UNSAFE' | 'CRITICAL';

export interface TemperatureSafetyInfo {
    status: TemperatureSafetyStatus;
    message: string;
    color: string;
    icon: string;
    risks: string[];
}

/**
 * Determine temperature safety status for a given fuel type and temperature
 */
export function getTemperatureSafetyStatus(
    temperature: number,
    fuelType: string,
    customThresholds?: Record<string, TemperatureThresholds>
): TemperatureSafetyInfo {
    const normalizedFuelType = (fuelType || '').toLowerCase();

    // Determine which thresholds to use: Custom -> Default -> Fallback (Diesel)
    let thresholds = DEFAULT_TEMPERATURE_THRESHOLDS[normalizedFuelType as keyof typeof DEFAULT_TEMPERATURE_THRESHOLDS];

    if (customThresholds && customThresholds[normalizedFuelType]) {
        thresholds = customThresholds[normalizedFuelType];
    } else if (!thresholds) {
        // Fallback if fuel type not found
        thresholds = DEFAULT_TEMPERATURE_THRESHOLDS.diesel;
    }

    // CRITICAL HIGH - Above critical high threshold
    if (temperature >= thresholds.criticalHigh) {
        const risks: string[] = [];

        if (normalizedFuelType === 'gasoline') {
            risks.push('Rapid pressure increase');
            risks.push('Volume loss through vaporization');
            risks.push('Increased vapor emissions');
        } else if (normalizedFuelType === 'diesel') {
            risks.push('Oxidation and chemical breakdown');
            risks.push('Microbial "bug" growth');
            risks.push('Fuel degradation');
        }

        // Check if approaching flash point (diesel only concern above storage temps)
        if (normalizedFuelType === 'diesel' && temperature >= thresholds.flashPoint) {
            risks.push('⚠️ FLASH POINT REACHED - IMMEDIATE IGNITION RISK');
        }

        return {
            status: 'CRITICAL',
            message: `Critical High (${temperature.toFixed(1)}°C)`,
            color: '#ef4444', // red
            icon: 'FiAlertTriangle',
            risks,
        };
    }

    // CRITICAL LOW - Below critical low threshold
    if (temperature <= thresholds.criticalLow) {
        const risks: string[] = [];

        if (normalizedFuelType === 'diesel') {
            risks.push('Fuel gelling and waxing');
            risks.push('Filter clogging');
            risks.push('Pump damage risk');
        } else if (normalizedFuelType === 'gasoline') {
            risks.push('Extreme cold conditions');
            risks.push('Condensation risk');
        }

        return {
            status: 'CRITICAL',
            message: `Critical Low (${temperature.toFixed(1)}°C)`,
            color: '#3b82f6', // blue
            icon: 'FiAlertTriangle',
            risks,
        };
    }

    // UNSAFE - Outside safe range but not critical
    if (temperature < thresholds.safe.min || temperature > thresholds.safe.max) {
        const risks: string[] = [];

        if (temperature > thresholds.optimal.max) {
            risks.push('Increased evaporation');
            risks.push('Accelerated aging');
        } else {
            risks.push('Suboptimal storage conditions');
            if (normalizedFuelType === 'diesel') {
                risks.push('Approaching gelling temperature');
            }
        }

        return {
            status: 'UNSAFE',
            message: `Unsafe (${temperature.toFixed(1)}°C)`,
            color: '#f59e0b', // amber/orange
            icon: 'FiAlertCircle',
            risks,
        };
    }

    // SAFE - Within safe range
    const isOptimal = temperature >= thresholds.optimal.min && temperature <= thresholds.optimal.max;

    return {
        status: 'SAFE',
        message: isOptimal ? `Optimal (${temperature.toFixed(1)}°C)` : `Safe (${temperature.toFixed(1)}°C)`,
        color: '#10b981', // green
        icon: 'FiCheckCircle',
        risks: [],
    };
}

/**
 * Calculate fleet-wide temperature safety status
 */
export function getFleetTemperatureSafety(
    tanks: Tank[],
    readings: Map<string, TankReading | null>,
    customThresholds?: Record<string, TemperatureThresholds>
): {
    averageTemp: number;
    safeCount: number;
    unsafeCount: number;
    criticalCount: number;
    worstStatus: TemperatureSafetyStatus;
} {
    let totalTemp = 0;
    let tankCount = 0;
    let safeCount = 0;
    let unsafeCount = 0;
    let criticalCount = 0;

    tanks.forEach(tank => {
        const reading = readings.get(tank.id);
        if (reading && reading.temperature !== undefined) {
            totalTemp += reading.temperature;
            tankCount++;

            const safety = getTemperatureSafetyStatus(reading.temperature, tank.fuelType, customThresholds);
            if (safety.status === 'SAFE') safeCount++;
            else if (safety.status === 'UNSAFE') unsafeCount++;
            else if (safety.status === 'CRITICAL') criticalCount++;
        }
    });

    const averageTemp = tankCount > 0 ? totalTemp / tankCount : 0;

    // Determine worst status
    let worstStatus: TemperatureSafetyStatus = 'SAFE';
    if (criticalCount > 0) worstStatus = 'CRITICAL';
    else if (unsafeCount > 0) worstStatus = 'UNSAFE';

    return {
        averageTemp,
        safeCount,
        unsafeCount,
        criticalCount,
        worstStatus,
    };
}

/**
 * Get temperature status description for display
 */
export function getTemperatureStatusDescription(status: TemperatureSafetyStatus): string {
    switch (status) {
        case 'SAFE':
            return 'All systems normal';
        case 'UNSAFE':
            return 'Warning';
        case 'CRITICAL':
            return 'Critical';
        default:
            return 'Unknown';
    }
}
