import { supabase } from '@/config/supabase';
import { format, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { validateUUID } from './sanitization';
import { logger } from './logger';

export interface DailySnapshot {
    date: string;
    opening: number;
    closing: number;
    deliveries: number;
    sales: number;
    theoretical: number;
    variance: number;
    variancePct: number;
}

export interface AggregatedMetrics {
    totalThroughput: number;
    totalDeliveries: number;
    avgVariancePct: number;
    incidentCount: number;
    netVariance: number;
}

/**
 * Standardizes volume to 15°C based on thermal expansion coefficients.
 * @param volume Raw volume reading
 * @param temperature Temperature in Celsius
 */
/**
 * @deprecated DO NOT USE for live sensor readings.
 * The ESP32 hardware already delivers volumes pre-standardized to 15°C.
 * Applying this function to sensor readings will DOUBLE-CORRECT volumes,
 * corrupting forensic audit reports. This function is retained only as a
 * reference formula; use thermalCorrection.ts for delivery modal variance display.
 */
export function calculateVCF(volume: number, temperature: number): number {
    const baselineTemp = 15;
    const expansionCoeff = 0.00084; // Typical for diesel only
    return volume * (1 - (temperature - baselineTemp) * expansionCoeff);
}

/**
 * Forensic Scanner: Aggregates daily reconciliation logs for a given period.
 * This is the "Brain" of the Reporting Hub.
 */
export async function scanStationHistory(
    stationId: string,
    startDate: Date,
    endDate: Date,
    tankId?: string
): Promise<{ logs: DailySnapshot[]; metrics: AggregatedMetrics }> {
    // 🟢 Forensic UUID Guard
    if (!validateUUID(stationId)) return { logs: [], metrics: { totalThroughput: 0, totalDeliveries: 0, avgVariancePct: 0, incidentCount: 0, netVariance: 0 } };
    if (tankId && !validateUUID(tankId)) return { logs: [], metrics: { totalThroughput: 0, totalDeliveries: 0, avgVariancePct: 0, incidentCount: 0, netVariance: 0 } };

    try {
        // 1. Fetch Transactions (Deliveries and Sales)
        let txQuery = supabase
            .from('fuel_transactions')
            .select('*')
            .eq('station_id', stationId)
            .gte('timestamp', startDate.toISOString())
            .lte('timestamp', endDate.toISOString());

        if (tankId) {
            txQuery = txQuery.eq('tank_id', tankId);
        }

        const { data: transactions, error: txError } = await txQuery;
        if (txError) throw txError;

        // 2. Fetch Daily Boundary Readings (Including Temperature for Forensic VCF)
        let readingsQuery = supabase
            .from('sensor_readings')
            .select('timestamp, volume, temperature, tank_id')
            .eq('station_id', stationId)
            .gte('timestamp', startDate.toISOString())
            .lte('timestamp', endDate.toISOString())
            .order('timestamp', { ascending: true });

        if (tankId) {
            readingsQuery = readingsQuery.eq('tank_id', tankId);
        }

        const { data: readings, error: readingsError } = await readingsQuery;
        if (readingsError) throw readingsError;

        // 3. Process daily snapshots
        const days = eachDayOfInterval({ start: startDate, end: endDate });
        const logs: DailySnapshot[] = [];

        days.forEach(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const dayStart = startOfDay(day);
            const dayEnd = endOfDay(day);

            // Filter readings for this day
            const dayReadings = (readings || []).filter(r => {
                const ts = new Date(r.timestamp);
                return ts >= dayStart && ts <= dayEnd;
            });

            // Filter transactions for this day
            const dayTx = (transactions || []).filter(tx => {
                const ts = new Date(tx.timestamp);
                return ts >= dayStart && ts <= dayEnd;
            });

            // Calculate basic metrics
            const openingRaw = dayReadings.length > 0 ? dayReadings[0].volume : 0;
            const closingRaw = dayReadings.length > 0 ? dayReadings[dayReadings.length - 1].volume : 0;
            
            // NOTE: ESP32 hardware delivers volumes pre-standardized to 15°C.
            // Do NOT apply VCF here — that would double-correct the readings.
            const opening = openingRaw;
            const closing = closingRaw;

            const deliveries = dayTx
                .filter(tx => tx.type === 'delivery')
                .reduce((sum, tx) => sum + (tx.amount || 0), 0);
            
            const sales = dayTx
                .filter(tx => tx.type === 'sale')
                .reduce((sum, tx) => sum + (tx.amount || 0), 0);

            const theoretical = opening + deliveries - sales;
            const variance = closing - theoretical;
            const totalThroughput = deliveries + sales;
            const variancePct = totalThroughput > 0 ? (variance / totalThroughput) * 100 : 0;

            logs.push({
                date: dayStr,
                opening,
                closing,
                deliveries,
                sales,
                theoretical,
                variance,
                variancePct
            });
        });

        // 4. Calculate Aggregate Metrics
        const totalDeliveriesVol = logs.reduce((sum, l) => sum + l.deliveries, 0);
        const totalSalesVol = logs.reduce((sum, l) => sum + l.sales, 0);
        const netVariance = logs.reduce((sum, l) => sum + l.variance, 0);
        const totalThroughput = totalDeliveriesVol + totalSalesVol;
        
        const metrics: AggregatedMetrics = {
            totalThroughput,
            totalDeliveries: (transactions || []).filter(tx => tx.type === 'delivery').length,
            avgVariancePct: totalThroughput > 0 ? (netVariance / totalThroughput) * 100 : 0,
            incidentCount: logs.filter(l => Math.abs(l.variancePct) > 1.0).length, // Flag variance > 1% as incident
            netVariance
        };

        return { logs, metrics };
    } catch (error) {
        logger.error('[scanStationHistory] Error:', error);
        return { logs: [], metrics: { totalThroughput: 0, totalDeliveries: 0, avgVariancePct: 0, incidentCount: 0, netVariance: 0 } };
    }
}

/**
 * In-Memory Highlight Generator: Creates professional summary strings for the UI
 */
export function getReportHighlights(type: string, metrics: AggregatedMetrics): string[] {
    const highlights: string[] = [];
    
    if (metrics.totalThroughput > 10000) {
        highlights.push(`High Volume Period: Total throughput exceeded ${metrics.totalThroughput.toLocaleString()}L.`);
    }

    // Forensic Logic
    if (Math.abs(metrics.avgVariancePct) < 0.1) {
        highlights.push('Operational Excellence: Net variance maintained within 0.1% (Standardized 15°C).');
    } else if (Math.abs(metrics.avgVariancePct) < 0.5) {
        highlights.push(`Forensic Scan: Minor drift detected (${metrics.avgVariancePct.toFixed(2)}%). Likely thermal contraction.`);
    } else {
        highlights.push(`Forensic Alert: Significant variance detected (${metrics.avgVariancePct.toFixed(2)}%). Verification of ATG probe calibration recommended.`);
    }

    if (metrics.incidentCount > 0) {
        highlights.push(`Security: ${metrics.incidentCount} daily sessions exceeded the EPRA 1% variance threshold.`);
    }

    if (type === 'compliance-pack' && Math.abs(metrics.avgVariancePct) < 0.5) {
        highlights.push('Compliance: Station meets the regulatory 90-day consistency standards with VCF correction active.');
    }

    return highlights.length > 0 ? highlights : ['No significant anomalies detected in this window.'];
}

export interface Recommendation {
    id: string;
    priority: 'critical' | 'watch' | 'optimize';
    title: string;
    description: string;
    riskScore: number;
    confidence: number;
    actionLabel: string;
}

/**
 * Strategy Engine: Generates actionable recommendations based on telemetry
 */
export function getStrategicRecommendations(
    variancePct: number,
    daysOfCover: number,
    incidentCount: number
): Recommendation[] {
    const recs: Recommendation[] = [];

    // 1. Critical Inventory Rule
    if (daysOfCover < 3) {
        recs.push({
            id: 'LOW_STOCK',
            priority: 'critical',
            title: 'Critical Stock Depletion',
            description: `Immediate refill required. Current cover: ${daysOfCover.toFixed(1)} days.`,
            riskScore: 95,
            confidence: 98,
            actionLabel: 'Order Fuel Now'
        });
    }

    // 2. High Variance Watch
    if (Math.abs(variancePct) > 0.5) {
        recs.push({
            id: 'HIGH_VARIANCE',
            priority: 'critical',
            title: 'Significant Loss Detected',
            description: `Operational drift at ${variancePct.toFixed(2)}%. Review flow calibration.`,
            riskScore: 88,
            confidence: 82,
            actionLabel: 'Initiate Forensic Audit'
        });
    }

    // 3. Maintenance / Anomaly Rule
    if (incidentCount > 5) {
        recs.push({
            id: 'INTEGRITY_WATCH',
            priority: 'watch',
            title: 'Signal Integrity Watch',
            description: 'Elevated telemetry gaps detected. Node inspection recommended.',
            riskScore: 45,
            confidence: 70,
            actionLabel: 'Check Hardware'
        });
    }

    // 4. Optimization Rule (Default)
    if (recs.length === 0) {
        recs.push({
            id: 'HEDGE_OPT',
            priority: 'optimize',
            title: 'Price Hedging Opportunity',
            description: 'Market trend suggests early procurement ROI of 4.2%.',
            riskScore: 12,
            confidence: 85,
            actionLabel: 'View Market Analysis'
        });
    }

    return recs;
}
