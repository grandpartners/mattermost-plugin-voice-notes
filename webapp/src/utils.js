export function formatDuration(totalSeconds) {
    const secs = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(secs / 60);
    const seconds = secs % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export function downsamplePeaks(levels, buckets) {
    if (!levels.length) {
        return new Array(buckets).fill(0.3);
    }
    const out = [];
    for (let i = 0; i < buckets; i++) {
        const start = Math.floor((i * levels.length) / buckets);
        const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / buckets));
        let max = 0;
        for (let j = start; j < end; j++) {
            if (levels[j] > max) {
                max = levels[j];
            }
        }
        out.push(max);
    }
    const overall = Math.max(...out, 0.001);
    return out.map((v) => Math.round((v / overall) * 100) / 100);
}

// Post props are sender-controlled: cap the length before mapping so a
// crafted post cannot render an unbounded number of bars, and clamp values.
export function sanitizePeaks(raw, buckets) {
    if (!Array.isArray(raw) || raw.length < 5) {
        return null;
    }
    const clamped = raw.slice(0, 4096).map((v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));
    return clamped.length > buckets ? downsamplePeaks(clamped, buckets) : clamped;
}

export const isValidFileId = (id) => typeof id === 'string' && (/^[a-z0-9]{26}$/).test(id);

// Deterministic waveform for legacy posts that carry no recorded peaks.
export function fallbackPeaks(seed, buckets) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    }
    const out = [];
    for (let i = 0; i < buckets; i++) {
        h = Math.imul(h, 1664525) + 1013904223;
        out.push(0.25 + ((h >>> 16) % 1000) / 1650);
    }
    return out;
}
