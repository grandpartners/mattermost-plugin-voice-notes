import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useIntl} from 'react-intl';

import VoiceRecorder from '../audio/recorder';
import {createVoicePost, uploadVoiceFile} from '../api';
import {MAX_DURATION_S, WAVEFORM_BARS} from '../constants';
import {formatDuration} from '../utils';

import Waveform from './waveform';
import {MicIcon, PauseIcon, PlayIcon, SendIcon, StopIcon, TrashIcon} from './icons';

function usePreviewAudio(url) {
    const audioRef = useRef(null);
    const rafRef = useRef(null);
    const [state, setState] = useState({playing: false, time: 0});

    useEffect(() => {
        if (!url) {
            return undefined;
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        const update = () => {
            setState({playing: !audio.paused && !audio.ended, time: audio.currentTime});
            if (!audio.paused && !audio.ended) {
                rafRef.current = requestAnimationFrame(update);
            }
        };
        audio.addEventListener('play', update);
        audio.addEventListener('pause', update);
        audio.addEventListener('ended', update);
        return () => {
            cancelAnimationFrame(rafRef.current);
            audio.pause();
            audioRef.current = null;
        };
    }, [url]);

    const toggle = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) {
            return;
        }
        if (audio.paused || audio.ended) {
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    }, []);

    const seek = useCallback((fraction, durationS) => {
        const audio = audioRef.current;
        if (!audio) {
            return;
        }
        audio.currentTime = fraction * durationS;
        setState((s) => ({...s, time: audio.currentTime}));
    }, []);

    return {...state, toggle, seek};
}

export default function RecorderPanel({target, onClose}) {
    const intl = useIntl();
    const [phase, setPhase] = useState('recording');
    const [seconds, setSeconds] = useState(0);
    const [tick, setTick] = useState(0);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [toThread, setToThread] = useState(Boolean(target.rootId));
    const recorderRef = useRef(null);
    const levelsRef = useRef([]);
    const stoppingRef = useRef(false);
    const phaseRef = useRef('recording');
    phaseRef.current = phase;

    const previewUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
    useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);
    const preview = usePreviewAudio(previewUrl);

    const durationS = result ? result.durationMs / 1000 : 0;

    const finishRecording = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.stopped || stoppingRef.current) {
            return null;
        }
        stoppingRef.current = true;
        return recorder.stop();
    }, []);

    const send = useCallback(async (rec) => {
        setPhase('sending');
        try {
            const fileId = await uploadVoiceFile(target.channelId, rec.blob);
            await createVoicePost({
                channelId: target.channelId,
                rootId: toThread ? target.rootId : '',
                fileId,
                durationMs: rec.durationMs,
                peaks: rec.peaks,
                message: intl.formatMessage(
                    {id: 'voicenotes.post_message'},
                    {duration: formatDuration(rec.durationMs / 1000)},
                ),
            });
            onClose();
        } catch (e) {
            setResult(rec);
            setError(e.message || intl.formatMessage({id: 'voicenotes.send_failed'}));
            setPhase('error');
        }
    }, [target, toThread, intl, onClose]);

    const stopToPreview = useCallback(async () => {
        const rec = await finishRecording();
        if (rec) {
            setResult(rec);
            setPhase('preview');
        }
    }, [finishRecording]);

    const sendNow = useCallback(async () => {
        if (phaseRef.current === 'recording') {
            const rec = await finishRecording();
            if (rec) {
                send(rec);
            }
        } else if (phaseRef.current === 'preview' || (phaseRef.current === 'error' && result)) {
            send(result);
        }
    }, [finishRecording, send, result]);

    const cancel = useCallback(() => {
        if (recorderRef.current && !recorderRef.current.stopped) {
            recorderRef.current.cancel();
        }
        onClose();
    }, [onClose]);

    useEffect(() => {
        const recorder = new VoiceRecorder({
            onProgress: (secs, peak) => {
                levelsRef.current.push(peak);
                setSeconds(secs);
                setTick((t) => t + 1);
            },
            onAutoStop: () => stopToPreview(),
        });
        recorderRef.current = recorder;
        recorder.start().catch((e) => {
            const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
            setError(intl.formatMessage({id: denied ? 'voicenotes.mic_denied' : 'voicenotes.mic_failed'}));
            setPhase('error');
        });
        return () => {
            if (recorder && !recorder.stopped) {
                recorder.cancel();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // Recording must not hijack typing: someone writing a normal text
        // message while the panel is open keeps their Enter/Escape.
        const isEditable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        const onKey = (e) => {
            if (isEditable(e.target)) {
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                sendNow();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [cancel, sendNow]);

    const livePeaks = useMemo(() => {
        const tail = levelsRef.current.slice(-WAVEFORM_BARS);
        const pad = WAVEFORM_BARS - tail.length;
        return pad > 0 ? new Array(pad).fill(0.02).concat(tail) : tail;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick]);

    const timeLeft = MAX_DURATION_S - seconds;

    return (
        <div
            className='vn-panel'
            role='dialog'
            aria-label={intl.formatMessage({id: 'voicenotes.attach'})}
        >
            {phase === 'recording' && (
                <>
                    <span className='vn-rec-dot'/>
                    <span className={`vn-timer${timeLeft <= 30 ? ' vn-timer--warn' : ''}`}>
                        {formatDuration(seconds)}
                    </span>
                    <Waveform peaks={livePeaks} live={true}/>
                    <button
                        type='button'
                        className='vn-icon-btn'
                        aria-label={intl.formatMessage({id: 'voicenotes.cancel'})}
                        title={intl.formatMessage({id: 'voicenotes.cancel'})}
                        onClick={cancel}
                    >
                        <TrashIcon/>
                    </button>
                    <button
                        type='button'
                        className='vn-icon-btn'
                        aria-label={intl.formatMessage({id: 'voicenotes.stop'})}
                        title={intl.formatMessage({id: 'voicenotes.stop'})}
                        onClick={stopToPreview}
                    >
                        <StopIcon/>
                    </button>
                    <button
                        type='button'
                        className='vn-send-btn'
                        aria-label={intl.formatMessage({id: 'voicenotes.send'})}
                        title={intl.formatMessage({id: 'voicenotes.send'})}
                        onClick={sendNow}
                    >
                        <SendIcon/>
                    </button>
                </>
            )}

            {phase === 'preview' && result && (
                <>
                    <button
                        type='button'
                        className='vn-icon-btn vn-icon-btn--accent'
                        aria-label={intl.formatMessage({id: preview.playing ? 'voicenotes.pause' : 'voicenotes.play'})}
                        onClick={preview.toggle}
                    >
                        {preview.playing ? <PauseIcon/> : <PlayIcon/>}
                    </button>
                    <Waveform
                        peaks={result.peaks}
                        progress={durationS > 0 ? preview.time / durationS : 0}
                        onSeek={(f) => preview.seek(f, durationS)}
                    />
                    <span className='vn-timer'>
                        {formatDuration(preview.playing || preview.time > 0 ? preview.time : durationS)}
                    </span>
                    {target.rootId && (
                        <button
                            type='button'
                            className={`vn-chip${toThread ? ' vn-chip--on' : ''}`}
                            onClick={() => setToThread((v) => !v)}
                        >
                            {intl.formatMessage({id: toThread ? 'voicenotes.to_thread' : 'voicenotes.to_channel'})}
                        </button>
                    )}
                    <button
                        type='button'
                        className='vn-icon-btn'
                        aria-label={intl.formatMessage({id: 'voicenotes.discard'})}
                        title={intl.formatMessage({id: 'voicenotes.discard'})}
                        onClick={cancel}
                    >
                        <TrashIcon/>
                    </button>
                    <button
                        type='button'
                        className='vn-send-btn'
                        aria-label={intl.formatMessage({id: 'voicenotes.send'})}
                        title={intl.formatMessage({id: 'voicenotes.send'})}
                        onClick={sendNow}
                    >
                        <SendIcon/>
                    </button>
                </>
            )}

            {phase === 'sending' && (
                <>
                    <span className='vn-spinner'/>
                    <span className='vn-label'>{intl.formatMessage({id: 'voicenotes.sending'})}</span>
                </>
            )}

            {phase === 'error' && (
                <>
                    <span className='vn-error'>{error}</span>
                    {result && (
                        <button
                            type='button'
                            className='vn-chip vn-chip--on'
                            onClick={sendNow}
                        >
                            {intl.formatMessage({id: 'voicenotes.retry'})}
                        </button>
                    )}
                    <button
                        type='button'
                        className='vn-icon-btn'
                        aria-label={intl.formatMessage({id: 'voicenotes.cancel'})}
                        onClick={cancel}
                    >
                        <TrashIcon/>
                    </button>
                </>
            )}

            {target.channelLabel && phase !== 'error' && (
                <span className='vn-target'>{target.channelLabel}</span>
            )}
        </div>
    );
}

export const RecorderPanelIcon = MicIcon;
