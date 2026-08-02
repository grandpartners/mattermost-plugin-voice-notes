import {RATES, RATE_STORAGE_KEY} from '../constants';

// One shared player: starting a voice note pauses whichever one was playing.
// State is exposed through a version counter so components can subscribe via
// useSyncExternalStore and derive their slice from getSnapshot(id).
const listeners = new Set();
let audio = null;
let currentId = null;
let rafId = null;
let failed = false;
let version = 0;

function emit() {
    version++;
    listeners.forEach((fn) => fn());
}

function tick() {
    emit();
    if (audio && !audio.paused) {
        rafId = requestAnimationFrame(tick);
    }
}

function stopTicking() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export const getVersion = () => version;

export function getRate() {
    const stored = parseFloat(localStorage.getItem(RATE_STORAGE_KEY));
    return RATES.includes(stored) ? stored : 1;
}

export function cycleRate() {
    const next = RATES[(RATES.indexOf(getRate()) + 1) % RATES.length];
    try {
        localStorage.setItem(RATE_STORAGE_KEY, String(next));
    } catch {
        // Storage may be unavailable; the rate still applies to this session.
    }
    if (audio) {
        audio.playbackRate = next;
    }
    emit();
    return next;
}

export function getSnapshot(id) {
    if (id !== currentId || !audio) {
        return {current: false, playing: false, time: 0, duration: 0, failed: false};
    }
    return {
        current: true,
        playing: !audio.paused && !audio.ended,
        time: audio.currentTime,
        duration: isFinite(audio.duration) ? audio.duration : 0,
        failed,
    };
}

function load(id, src) {
    if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    }
    stopTicking();
    failed = false;
    currentId = id;
    audio = new Audio(src);
    audio.preload = 'metadata';
    audio.playbackRate = getRate();
    audio.preservesPitch = true;
    audio.addEventListener('ended', () => {
        stopTicking();
        emit();
    });
    audio.addEventListener('error', () => {
        failed = true;
        stopTicking();
        emit();
    });
    audio.addEventListener('loadedmetadata', emit);
}

export function toggle(id, src) {
    if (id !== currentId) {
        load(id, src);
    }
    if (audio.paused || audio.ended) {
        audio.play().then(() => {
            stopTicking();
            rafId = requestAnimationFrame(tick);
        }).catch(() => {
            // Autoplay policy or transient failure: stay paused, don't mark
            // the file as broken (the 'error' event covers real failures).
            emit();
        });
    } else {
        audio.pause();
        stopTicking();
    }
    emit();
}

export function seek(id, src, fraction) {
    if (id !== currentId) {
        load(id, src);
    }
    const apply = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = fraction * audio.duration;
            emit();
        }
    };
    if (isFinite(audio.duration) && audio.duration > 0) {
        apply();
    } else {
        audio.addEventListener('loadedmetadata', apply, {once: true});
    }
    if (audio.paused) {
        toggle(id, src);
    }
}
