/**
 * Formatting Utilities for IoTank Fuel Intelligence Hub
 * These are purely for display and contain no physics calculations.
 */

/**
 * Convert Celsius to Fahrenheit
 * @param celsius - Temperature in Celsius
 * @returns Temperature in Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
    if (typeof celsius !== 'number' || isNaN(celsius)) return 0;
    return Number(((celsius * 9 / 5) + 32).toFixed(1));
}

/**
 * Convert liters to gallons (US)
 * @param liters - Volume in liters
 * @returns Volume in US gallons
 */
export function litersToGallons(liters: number): number {
    if (typeof liters !== 'number' || isNaN(liters)) return 0;
    return Number((liters * 0.264172).toFixed(2));
}

/**
 * Format volume with appropriate unit
 * @param liters - Volume in liters
 * @param unit - Desired unit ('liters' or 'gallons')
 * @param includeUnit - Whether to append unit label
 * @returns Formatted string
 */
export function formatVolume(
    liters: number,
    unit: 'liters' | 'gallons' = 'liters',
    includeUnit: boolean = true
): string {
    const safeLiters = typeof liters === 'number' && !isNaN(liters) ? liters : 0;
    const value = unit === 'gallons' ? litersToGallons(safeLiters) : safeLiters;
    const unitLabel = unit === 'gallons' ? 'gal' : 'L';
    const formatted = value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    return includeUnit ? `${formatted} ${unitLabel}` : formatted;
}

/**
 * Format temperature with appropriate unit
 * @param celsius - Temperature in Celsius
 * @param unit - Desired unit ('celsius' or 'fahrenheit')
 * @param includeSymbol - Whether to append unit symbol
 * @returns Formatted string
 */
export function formatTemperature(
    celsius: number,
    unit: 'celsius' | 'fahrenheit' = 'celsius',
    includeSymbol: boolean = true
): string {
    const value = unit === 'fahrenheit' ? celsiusToFahrenheit(celsius) : celsius;
    const symbol = unit === 'fahrenheit' ? '°F' : '°C';
    const formatted = value.toFixed(1);

    return includeSymbol ? `${formatted}${symbol}` : formatted;
}

/**
 * Sanitize internal IDs from user-facing strings for security.
 * Strips UUID patterns and "[ID: ...]" blocks.
 * @param str - Original string
 * @returns Sanitized string
 */
export function sanitizeIds(str: string | undefined | null): string {
    if (!str) return '';
    
    // 1. Match typical UUIDs (8-4-4-4-12)
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    
    // 2. Match explicit ID tags like [ID: xxx] or [Node ID: xxx]
    const idTagRegex = /\[(?:Node\s+)?ID:\s*[^\]]+\]/gi;
    
    return str
        .replace(uuidRegex, '')
        .replace(idTagRegex, '')
        .replace(/\(\s*\)/g, '') // Remove empty parentheses leftover
        .replace(/\[\s*\]/g, '') // Remove empty brackets leftover
        .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
        .trim();
}
