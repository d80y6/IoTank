/**
 * refillClassifier.ts — Multi-Signal Refill vs Sensor-Spike Classifier
 *
 * Physical reality the algorithm encodes:
 *
 * ① SENSOR SPIKE (ultrasonic artefact)
 *    - One (rarely two) readings deviate sharply from baseline
 *    - Volume self-corrects within the next reading cycle
 *    - The net change after the Hampel filter absorbs the spike is < threshold
 *    - No persistent upward trend; direction changes immediately
 *
 * ② REAL REFILL (fuel delivery into tank)
 *    - Sustained net-positive volume trend across MULTIPLE readings
 *    - TURBULENCE: liquid surface disturbed by inflow → readings oscillate
 *      while the overall trend is upward (alternating +/- deltas)
 *    - High inflow rate (tanker delivers at 200–2000 L/min typically)
 *    - Should be classifiable within 2–3 reading cycles (~10–30 s)
 */

import { hampelFilter, computeMAD } from './sensorFilter';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VolumePoint {
    volume: number;
    timestamp: number; // Unix ms
}

export type RefillSignal =
    | 'IDLE'               // No significant change
    | 'SENSOR_SPIKE'       // Transient artefact — discard
    | 'REFILL_CANDIDATE'   // Rising, awaiting 1 more cycle to confirm
    | 'REFILL_CONFIRMED';  // Definitive delivery detected

export interface RefillClassification {
    signal: RefillSignal;

    /**
     * The last stable volume BEFORE inflow started.
     * Pinpointed by walking backward through the buffer to the last reading
     * that was within the noise floor — giving minimal error margin.
     */
    startVolume: number;
    startTimestamp: number;

    endVolume: number;
    netGain: number;

    /** Estimated inflow rate in L/min */
    ingressRateLpm: number;

    /**
     * 0–1 score of how oscillatory readings were during the uptrend.
     * Real refills ≈ 0.3–1.0 (turbulence).
     * Sensor spikes ≈ 0.0–0.1 (single clean pop).
     */
    turbulenceScore: number;

    /** 0–1 aggregate confidence of the classification */
    confidenceScore: number;

    /** Human-readable explanation — shown in debug logs */
    reason: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length);
}

/**
 * Walk backward from `firstRiseIdx` to find the last reading that was still
 * within the noise floor — that is the true delivery start point.
 */
function findPreciseStartIndex(
    filtered: number[],
    firstRiseIdx: number,
    noiseFloorL: number,
): number {
    for (let i = firstRiseIdx; i > 0; i--) {
        const delta = filtered[i] - filtered[i - 1];
        if (delta <= noiseFloorL) return i;
    }
    return 0;
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify the latest volume history buffer.
 *
 * @param points        Rolling buffer of volume readings, oldest first.
 *                      Minimum 2 entries; ideally 5–15 for best accuracy.
 * @param refillMinL    Minimum real delivery volume (1% of capacity or 20 L).
 */
export function classifyVolumeChange(
    points: VolumePoint[],
    refillMinL: number,
): RefillClassification {
    const last = points[points.length - 1];

    const IDLE: RefillClassification = {
        signal: 'IDLE',
        startVolume: last?.volume ?? 0,
        startTimestamp: last?.timestamp ?? Date.now(),
        endVolume: last?.volume ?? 0,
        netGain: 0,
        ingressRateLpm: 0,
        turbulenceScore: 0,
        confidenceScore: 0,
        reason: 'No significant volume change detected.',
    };

    if (points.length < 2) return IDLE;

    // ── 1. Extract volumes & apply Hampel noise filter ────────────────────
    const rawVols = points.map(p => p.volume);
    const filtered = hampelFilter(rawVols, 2, 3);

    // Noise floor: 1.5× the MAD of the filtered series (robust to outliers)
    const noiseFloorL = Math.max(1.5, computeMAD(filtered) * 1.5);

    // ── 2. Compute per-cycle deltas on filtered volumes ───────────────────
    const deltas: number[] = [];
    for (let i = 1; i < filtered.length; i++) {
        deltas.push(filtered[i] - filtered[i - 1]);
    }

    // ── 3. Quick check: raw net change ────────────────────────────────────
    const rawNetGain = rawVols[rawVols.length - 1] - rawVols[0];
    const filteredNetGain = filtered[filtered.length - 1] - filtered[0];

    // If the Hampel filter ate the gain (raw was large but filtered is tiny)
    // → definite sensor artefact
    if (rawNetGain >= refillMinL && filteredNetGain < noiseFloorL) {
        return {
            signal: 'SENSOR_SPIKE',
            startVolume: filtered[filtered.length - 1],
            startTimestamp: last.timestamp,
            endVolume: last.volume,
            netGain: rawNetGain,
            ingressRateLpm: 0,
            turbulenceScore: 0,
            confidenceScore: 0.97,
            reason: `Hampel filter absorbed a raw spike of ${rawNetGain.toFixed(0)} L. ` +
                `Filtered net gain is only ${filteredNetGain.toFixed(1)} L — sensor artefact.`,
        };
    }

    if (filteredNetGain < noiseFloorL) return IDLE;

    // ── 4. Locate the first significant rise ─────────────────────────────
    let firstRiseIdx = -1;
    for (let i = 0; i < deltas.length; i++) {
        if (deltas[i] > noiseFloorL) { firstRiseIdx = i + 1; break; }
    }
    if (firstRiseIdx < 0) return IDLE;

    // ── 5. Pinpoint the precise start (last quiet reading) ────────────────
    const startIdx = findPreciseStartIndex(filtered, firstRiseIdx, noiseFloorL);
    const startVolume = filtered[startIdx];
    const startTimestamp = points[startIdx].timestamp;
    const endVolume = filtered[filtered.length - 1];
    const netGain = endVolume - startVolume;

    if (netGain < noiseFloorL) return IDLE;

    // ── 6. Turbulence analysis on the rising window ───────────────────────
    const risingDeltas = deltas.slice(startIdx);
    const risingVols = filtered.slice(startIdx);

    const directionChanges = risingDeltas.slice(1).filter(
        (d, i) => Math.sign(d) !== Math.sign(risingDeltas[i])
    ).length;
    const maxChanges = Math.max(1, risingDeltas.length - 1);

    const meanAbsDelta = risingDeltas.reduce((a, b) => a + Math.abs(b), 0) /
        Math.max(1, risingDeltas.length);
    const risingStd = stddev(risingVols);
    const amplitudeRatio = meanAbsDelta > 0
        ? Math.min(1, risingStd / (meanAbsDelta * 2))
        : 0;

    // turbulenceScore: 0 = clean spike, 1 = highly oscillatory delivery
    const turbulenceScore = Math.min(
        1,
        (directionChanges / maxChanges) * 0.60 + amplitudeRatio * 0.40,
    );

    // ── 7. Inflow rate ────────────────────────────────────────────────────
    const durationMs = last.timestamp - startTimestamp;
    const durationMin = Math.max(0.05, durationMs / 60_000);
    const ingressRateLpm = netGain / durationMin;

    // ── 8. Evidence scoring ───────────────────────────────────────────────
    // Physical rules:
    //   ABOVE_MIN  : net gain ≥ min delivery volume  (required)
    //   TURBULENT  : oscillation present             (hallmark of real refill)
    //   SUSTAINED  : ≥2 positive reading cycles      (not a single spike)
    //   HIGH_RATE  : inflow rate ≥ 50 L/min          (tanker delivery)
    const positiveCount = risingDeltas.filter(d => d > 0).length;

    const ABOVE_MIN = netGain >= refillMinL;
    const TURBULENT = turbulenceScore > 0.15 || directionChanges >= 1;
    const SUSTAINED = positiveCount >= 2;
    const HIGH_RATE = ingressRateLpm >= 50;

    let confidence = 0;
    if (ABOVE_MIN) confidence += 0.35;
    if (TURBULENT) confidence += 0.30;
    if (SUSTAINED) confidence += 0.25;
    if (HIGH_RATE) confidence += 0.10;

    // Below minimum threshold even after filtering → noise
    if (!ABOVE_MIN) {
        return {
            signal: 'SENSOR_SPIKE',
            startVolume,
            startTimestamp,
            endVolume,
            netGain,
            ingressRateLpm,
            turbulenceScore,
            confidenceScore: 0.88,
            reason: `Net gain ${netGain.toFixed(1)} L < minimum threshold ${refillMinL.toFixed(0)} L. Sensor noise.`,
        };
    }

    const baseReason =
        `Gain: ${netGain.toFixed(0)} L from baseline ${startVolume.toFixed(0)} L. ` +
        `Rate: ${ingressRateLpm.toFixed(0)} L/min. Turbulence: ${(turbulenceScore * 100).toFixed(0)}%.`;

    if (confidence >= 0.60) {
        return {
            signal: 'REFILL_CONFIRMED',
            startVolume,
            startTimestamp,
            endVolume,
            netGain,
            ingressRateLpm,
            turbulenceScore,
            confidenceScore: confidence,
            reason: `Real refill confirmed. ${baseReason}`,
        };
    }

    // Not enough evidence yet — request one more reading cycle
    return {
        signal: 'REFILL_CANDIDATE',
        startVolume,
        startTimestamp,
        endVolume,
        netGain,
        ingressRateLpm,
        turbulenceScore,
        confidenceScore: confidence,
        reason: `Awaiting confirmation. ${baseReason}`,
    };
}
