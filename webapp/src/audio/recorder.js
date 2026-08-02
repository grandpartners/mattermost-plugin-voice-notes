import {Mp3Encoder} from '@breezystack/lamejs';

import {BIT_RATE_KBPS, MAX_DURATION_S, WAVEFORM_BARS} from '../constants';
import {downsamplePeaks} from '../utils';

const CHUNK_SIZE = 4096;

function toInt16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
}

// Captures mono PCM and encodes MP3 progressively while recording (~2 ms per
// chunk on the main thread), so the blob is ready the instant recording stops.
//
// Capture uses ScriptProcessorNode on purpose: AudioWorklet requires its
// module to be fetched as a script, and Mattermost's CSP (script-src 'self')
// blocks blob:/data: module URLs — a webapp-only plugin has no same-origin
// file to serve. Deprecated but universally supported.
export default class VoiceRecorder {
    constructor({onProgress, onAutoStop}) {
        this.onProgress = onProgress;
        this.onAutoStop = onAutoStop;
        this.chunks = [];
        this.levels = [];
        this.samples = 0;
        this.stopped = false;
    }

    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        this.ctx = new AudioContext();
        await this.ctx.resume();
        this.sampleRate = this.ctx.sampleRate;
        this.encoder = new Mp3Encoder(1, this.sampleRate, BIT_RATE_KBPS);

        const source = this.ctx.createMediaStreamSource(this.stream);
        this.processor = this.ctx.createScriptProcessor(CHUNK_SIZE, 1, 1);
        this.processor.onaudioprocess = (e) => this._ingest(e.inputBuffer.getChannelData(0));

        // A muted sink keeps the graph rendering without audible feedback.
        this.sink = this.ctx.createGain();
        this.sink.gain.value = 0;
        source.connect(this.processor);
        this.processor.connect(this.sink);
        this.sink.connect(this.ctx.destination);
    }

    _ingest(float32) {
        if (this.stopped || !float32 || float32.length === 0) {
            return;
        }
        let peak = 0;
        for (let i = 0; i < float32.length; i++) {
            const v = Math.abs(float32[i]);
            if (v > peak) {
                peak = v;
            }
        }
        this.levels.push(peak);

        const encoded = this.encoder.encodeBuffer(toInt16(float32));
        if (encoded.length > 0) {
            this.chunks.push(encoded);
        }

        this.samples += float32.length;
        const seconds = this.samples / this.sampleRate;
        if (this.onProgress) {
            this.onProgress(seconds, peak);
        }
        if (seconds >= MAX_DURATION_S && this.onAutoStop) {
            const cb = this.onAutoStop;
            this.onAutoStop = null;
            cb();
        }
    }

    stop() {
        if (this.stopped) {
            return null;
        }
        if (!this.encoder) {
            this._teardown();
            return null;
        }
        this._teardown();

        const final = this.encoder.flush();
        if (final.length > 0) {
            this.chunks.push(final);
        }
        return {
            blob: new Blob(this.chunks, {type: 'audio/mpeg'}),
            durationMs: Math.round((this.samples / this.sampleRate) * 1000),
            peaks: downsamplePeaks(this.levels, WAVEFORM_BARS),
        };
    }

    cancel() {
        this._teardown();
        this.chunks = [];
    }

    _teardown() {
        this.stopped = true;
        if (this.processor) {
            this.processor.onaudioprocess = null;
            this.processor.disconnect();
        }
        if (this.sink) {
            this.sink.disconnect();
        }
        if (this.stream) {
            this.stream.getTracks().forEach((t) => t.stop());
        }
        if (this.ctx && this.ctx.state !== 'closed') {
            this.ctx.close().catch(() => {});
        }
    }
}
