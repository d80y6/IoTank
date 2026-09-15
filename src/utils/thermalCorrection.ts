/**
 * Thermal Correction & Variance Analysis for Fuel Delivery Verification
 * NOTE: The ESP32 handles real-time corrections. These formulas are exclusively 
 * for the delivery verification exception to compare invoice standard vs observed raw.
 */

// Standard Reference Temperature (Industry Standard: 15.5°C / 60°F)
export const REF_TEMP_C = 15.5;

// Thermal Expansion Coefficients (approximate per °C)
export const EXPANSION_COEFFICIENTS = {
    'diesel': 0.00084, // Standard Diesel (Avg density 0.835)
    'petrol': 0.00095, // Gasoline/Petrol
    'kerosene': 0.00070,
    'jet_fuel': 0.00070, // Aviation Turbine Fuel
    'water': 0.00021, // For calibration/testing
};

export type FuelType = keyof typeof EXPANSION_COEFFICIENTS;

/**
 * Calculate the Expected Volume at a specific temperature given a Standard Volume (at 15.5°C).
 * V_current = V_standard * (1 + alpha * (T_current - 15.5))
 */
export function calculateExpectedVolume(
    standardVolume: number,
    currentTempC: number,
    fuelType: FuelType = 'diesel'
): number {
    // Resolve common fuel type aliases to canonical coefficient keys
    const FUEL_ALIASES: Record<string, FuelType> = {
        'pms':       'petrol',
        'super':     'petrol',
        'gasoline':  'petrol',
        'ago':       'diesel',
        'biodiesel': 'diesel',
        'jet-fuel':  'jet_fuel',  // hyphenated UI form → underscore key
        'jet fuel':  'jet_fuel',
    };
    const canonicalType: FuelType = FUEL_ALIASES[(fuelType || '').toLowerCase() as string] ?? fuelType;

    const alpha = EXPANSION_COEFFICIENTS[canonicalType] || EXPANSION_COEFFICIENTS['diesel'];
    const deltaT = currentTempC - REF_TEMP_C;
    const factor = 1 + (alpha * deltaT);
    return Number((standardVolume * factor).toFixed(2));
}

/**
 * Analyze the variance between Delivered (Invoice) and Observed (Sensor) volume.
 * Specifically for delivery verification audit.
 */
export function analyzeVariance(
    invoiceVolume: number, // The amount paid for (Standardized to 15.5°C)
    sensorIncrease: number, // The raw volume increase measured by sensor
    temperature: number,
    fuelType: FuelType = 'diesel',
    toleranceLiters: number = 15
) {
    // 1. Calculate what the Invoice Volume SHOULD look like at this temperature
    const expectedSensorIncrease = calculateExpectedVolume(invoiceVolume, temperature, fuelType);

    // 2. Calculate Total Variance (Raw diff)
    const totalVariance = sensorIncrease - invoiceVolume;

    // 3. Calculate Thermal Variance (The part strictly due to physics)
    // Thermal Part = Expected_at_Current - Invoice_Standard
    const thermalVariance = expectedSensorIncrease - invoiceVolume;

    // 4. Calculate Unexplained Variance (Total - Thermal)
    // This is the "Real" missing/extra fuel
    const unexplainedVariance = sensorIncrease - expectedSensorIncrease;

    // 5. Generate Explanation
    let explanation = '';
    let status: 'MATCH' | 'WARNING' | 'CRITICAL' = 'MATCH';
    const isHot = temperature > REF_TEMP_C;

    if (Math.abs(unexplainedVariance) <= toleranceLiters) {
        status = 'MATCH';
        if (Math.abs(thermalVariance) > toleranceLiters) {
            explanation = `Variance explained by thermal ${isHot ? 'expansion' : 'contraction'}. Fuel is ${temperature}°C (${isHot ? '+' : ''}${(temperature - REF_TEMP_C).toFixed(1)}°C vs Std).`;
        } else {
            explanation = 'Perfect match. Standardized results align with invoice.';
        }
    } else {
        status = 'WARNING';
        const operation = unexplainedVariance > 0 ? 'Gain' : 'Shortage';
        explanation = `Unexplained ${operation} of ${Math.abs(unexplainedVariance).toFixed(1)} L. `;
        if (Math.abs(thermalVariance) > 5) {
            explanation += `(Physics accounts for ${thermalVariance > 0 ? '+' : ''}${thermalVariance.toFixed(1)} L of the difference).`;
        }
    }

    return {
        totalVariance,
        thermalVariance,
        unexplainedVariance,
        expectedSensorIncrease,
        status,
        explanation
    };
}
