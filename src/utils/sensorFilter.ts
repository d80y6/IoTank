/**
 * sensorFilter.ts — Ultrasonic Sensor Signal Processing
 *
 * Ultrasonic sensors occasionally relay a wrong distance measurement
 * (e.g. sound reflecting off the fill pipe instead of the liquid surface).
 * This produces a single "spike" volume that immediately self-corrects on
 * the next reading cycle.
 *
 * The Hampel Identifier is a well-established, robust outlier detector that
 * uses the Median Absolute Deviation (MAD) — immune to being skewed by the
 * very outliers it is trying to find.
 */

// ── Primitives ────────────────────────────────────────────────────────────────

/** Compute the median of a numeric array. */
function median(values: number[]): number {
    if (values.length === 0) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median Absolute Deviation — a robust spread estimator. */
export function computeMAD(values: number[]): number {
    if (values.length === 0) return 0;
    const med = median(values);
    return median(values.map(v => Math.abs(v - med)));
}

// ── Hampel Identifier ─────────────────────────────────────────────────────────

/**
 * Flag each index where the value is a suspected sensor artefact.
 *
 * A reading is flagged when it deviates from its local sliding-window median
 * by more than (threshold × SCALE × MAD). SCALE = 1.4826 makes MAD
 * equivalent to 1 σ for normally distributed data.
 *
 * @param values      Volume readings, oldest first.
 * @param windowHalf  Half the sliding window (default 2 → 5-point window).
 * @param threshold   Sigma-equivalent multiplier (default 3).
 */
export function hampelOutlierFlags(
    values: number[],
    windowHalf = 2,
    threshold = 3,
): boolean[] {
    const SCALE = 1.4826;
    const flags: boolean[] = new Array(values.length).fill(false);

    for (let i = 0; i < values.length; i++) {
        const lo = Math.max(0, i - windowHalf);
        const hi = Math.min(values.length - 1, i + windowHalf);
        const win = values.slice(lo, hi + 1);

        const med = median(win);
        const mad = computeMAD(win);
        const tol = mad > 0 ? threshold * SCALE * mad : 5; // 5 L absolute fallback

        if (Math.abs(values[i] - med) > tol) flags[i] = true;
    }
    return flags;
}

/**
 * Apply the Hampel filter: replace flagged outliers with the local median.
 * The original array is never mutated.
 */
export function hampelFilter(
    values: number[],
    windowHalf = 2,
    threshold = 3,
): number[] {
    if (values.length < 3) return [...values];
    const flags = hampelOutlierFlags(values, windowHalf, threshold);
    return values.map((v, i) => {
        if (!flags[i]) return v;
        const lo = Math.max(0, i - windowHalf);
        const hi = Math.min(values.length - 1, i + windowHalf);
        const cleanWin = values.slice(lo, hi + 1).filter((_, j) => !flags[lo + j]);
        return cleanWin.length > 0 ? median(cleanWin) : v;
    });
}

/**
 * Smoothed latest volume: 3-point rolling median of the last 3 entries
 * in a buffer. Safe to call every reading cycle.
 */
export function getSmoothedVolume(buffer: number[]): number {
    if (buffer.length === 0) return 0;
    if (buffer.length === 1) return buffer[0];
    if (buffer.length === 2) return (buffer[0] + buffer[1]) / 2;
    return median(buffer.slice(-3));
}
