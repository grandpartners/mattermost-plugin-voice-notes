(() => {
    'use strict';

    const MAX_DURATION_MS = 300000;
    const BAR_COUNT = 48;
    const messages = {
        en: {
            subtitle: 'Record a voice message for Mattermost', ready: 'Ready to record', recording: 'Recording…',
            preview: 'Listen before sending', sending: 'Sending…', record: 'Record', stop: 'Stop', discard: 'Discard',
            send: 'Send', sent: 'Voice message sent', return: 'Return to Mattermost',
            hint: 'Maximum length: 5 minutes. This private link can be used once.',
            noToken: 'This recorder link is invalid or has already been used.',
            unsupported: 'Voice recording is not supported by this browser.',
            denied: 'Microphone access is blocked. Allow it in your browser or system settings.',
            failed: 'Could not start recording.', sendFailed: 'The voice message could not be sent.',
        },
        ru: {
            subtitle: 'Запишите голосовое сообщение для Mattermost', ready: 'Готово к записи', recording: 'Идёт запись…',
            preview: 'Прослушайте перед отправкой', sending: 'Отправка…', record: 'Записать', stop: 'Стоп', discard: 'Удалить',
            send: 'Отправить', sent: 'Голосовое сообщение отправлено', return: 'Вернуться в Mattermost',
            hint: 'Не более 5 минут. Эта приватная ссылка работает один раз.',
            noToken: 'Ссылка недействительна или уже была использована.',
            unsupported: 'Этот браузер не поддерживает запись голоса.',
            denied: 'Доступ к микрофону заблокирован. Разрешите его в настройках браузера или системы.',
            failed: 'Не удалось начать запись.', sendFailed: 'Не удалось отправить голосовое сообщение.',
        },
        es: {
            subtitle: 'Graba un mensaje de voz para Mattermost', ready: 'Listo para grabar', recording: 'Grabando…',
            preview: 'Escucha antes de enviar', sending: 'Enviando…', record: 'Grabar', stop: 'Parar', discard: 'Descartar',
            send: 'Enviar', sent: 'Mensaje de voz enviado', return: 'Volver a Mattermost',
            hint: 'Duración máxima: 5 minutos. Este enlace privado se puede usar una vez.',
            noToken: 'Este enlace no es válido o ya se ha utilizado.',
            unsupported: 'Este navegador no permite grabar voz.',
            denied: 'El micrófono está bloqueado. Permítelo en los ajustes del navegador o del sistema.',
            failed: 'No se pudo empezar a grabar.', sendFailed: 'No se pudo enviar el mensaje de voz.',
        },
    };

    const requestedLanguage = new URLSearchParams(window.location.search).get('lang') || navigator.language || 'en';
    const browserLanguage = requestedLanguage.toLowerCase().split('-')[0];
    const language = messages[browserLanguage] ? browserLanguage : 'en';
    const t = messages[language];
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        element.textContent = t[element.dataset.i18n] || element.textContent;
    });

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    let token = fragment.get('token') || '';
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    const elements = {
        status: document.getElementById('status'), statusText: document.getElementById('status-text'),
        recordDot: document.getElementById('record-dot'), timer: document.getElementById('timer'),
        waveform: document.getElementById('waveform'), preview: document.getElementById('preview'),
        error: document.getElementById('error'), readyActions: document.getElementById('ready-actions'),
        recordingActions: document.getElementById('recording-actions'), previewActions: document.getElementById('preview-actions'),
        sentActions: document.getElementById('sent-actions'), record: document.getElementById('record'),
        cancel: document.getElementById('cancel'), stop: document.getElementById('stop'),
        discard: document.getElementById('discard'), send: document.getElementById('send'),
        openApp: document.getElementById('open-app'),
    };

    const bars = [];
    for (let i = 0; i < BAR_COUNT; i++) {
        const bar = document.createElement('span');
        bar.className = 'wave-bar';
        elements.waveform.appendChild(bar);
        bars.push(bar);
    }

    let mediaRecorder = null;
    let stream = null;
    let audioContext = null;
    let analyser = null;
    let animationFrame = null;
    let startedAt = 0;
    let chunks = [];
    let samples = [];
    let recordingResult = null;
    let previewURL = '';
    let returnURL = 'mattermost://';
    let stopping = false;

    const formatDuration = (milliseconds) => {
        const seconds = Math.max(0, Math.floor(milliseconds / 1000));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const renderWaveform = (values) => {
        bars.forEach((bar, index) => {
            const value = Math.max(0.035, Math.min(1, values[index] || 0.035));
            bar.className = `wave-bar wave-level-${Math.round(value * 20)}`;
        });
    };

    const downsample = (values) => {
        if (!values.length) {
            return new Array(BAR_COUNT).fill(0.12);
        }
        const output = [];
        for (let i = 0; i < BAR_COUNT; i++) {
            const start = Math.floor(i * values.length / BAR_COUNT);
            const end = Math.max(start + 1, Math.floor((i + 1) * values.length / BAR_COUNT));
            let peak = 0;
            for (let j = start; j < end && j < values.length; j++) {
                peak = Math.max(peak, values[j]);
            }
            output.push(Math.round(peak * 100) / 100);
        }
        const maximum = Math.max(...output, 0.01);
        return output.map((value) => Math.round((value / maximum) * 100) / 100);
    };

    const setPhase = (phase) => {
        elements.readyActions.hidden = phase !== 'ready';
        elements.recordingActions.hidden = phase !== 'recording';
        elements.previewActions.hidden = phase !== 'preview' && phase !== 'sending';
        elements.sentActions.hidden = phase !== 'sent';
        elements.preview.hidden = phase !== 'preview';
        elements.recordDot.hidden = phase !== 'recording';
        elements.status.hidden = phase === 'sent';
        elements.timer.hidden = phase === 'sent';
        elements.waveform.hidden = phase === 'sent';
        elements.waveform.classList.toggle('recording', phase === 'recording');
        elements.statusText.textContent = t[phase] || t.ready;
        elements.send.disabled = phase === 'sending';
        elements.discard.disabled = phase === 'sending';
        elements.error.hidden = true;
    };

    const showError = (message) => {
        elements.error.textContent = message;
        elements.error.hidden = false;
    };

    const cleanupCapture = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(() => {});
        }
        audioContext = null;
        analyser = null;
    };

    const chooseMimeType = () => {
        const candidates = [
            'audio/mp4;codecs=mp4a.40.2',
            'audio/mp4',
            'audio/webm;codecs=opus',
            'audio/webm',
        ];
        if (typeof MediaRecorder.isTypeSupported !== 'function') {
            return '';
        }
        return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
    };

    const normalizedMimeType = (raw) => {
        const value = (raw || '').toLowerCase();
        if (value.includes('mp4') || value.includes('m4a')) {
            return 'audio/mp4';
        }
        if (value.includes('webm')) {
            return 'audio/webm';
        }
        return '';
    };

    const updateMeter = () => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
            return;
        }
        let peak = 0.035;
        if (analyser) {
            const data = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(data);
            data.forEach((value) => {
                peak = Math.max(peak, Math.abs(value - 128) / 128);
            });
        }
        samples.push(peak);
        const tail = samples.slice(-BAR_COUNT);
        renderWaveform(new Array(BAR_COUNT - tail.length).fill(0.035).concat(tail));

        const elapsed = performance.now() - startedAt;
        elements.timer.textContent = formatDuration(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
            stopRecording();
            return;
        }
        animationFrame = requestAnimationFrame(updateMeter);
    };

    const startRecording = async () => {
        if (!token) {
            showError(t.noToken);
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            showError(t.unsupported);
            return;
        }

        elements.record.disabled = true;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true},
            });
            const mimeType = chooseMimeType();
            mediaRecorder = mimeType ? new MediaRecorder(stream, {mimeType, audioBitsPerSecond: 64000}) : new MediaRecorder(stream);
            if (!normalizedMimeType(mediaRecorder.mimeType)) {
                throw new Error('unsupported-mime');
            }

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                try {
                    audioContext = new AudioContextClass();
                    analyser = audioContext.createAnalyser();
                    analyser.fftSize = 256;
                    audioContext.createMediaStreamSource(stream).connect(analyser);
                    await audioContext.resume();
                } catch (_) {
                    if (audioContext && audioContext.state !== 'closed') {
                        audioContext.close().catch(() => {});
                    }
                    audioContext = null;
                    analyser = null;
                }
            }

            chunks = [];
            samples = [];
            stopping = false;
            elements.stop.disabled = false;
            elements.cancel.disabled = false;
            mediaRecorder.addEventListener('dataavailable', (event) => {
                if (event.data && event.data.size) {
                    chunks.push(event.data);
                }
            });
            mediaRecorder.start(250);
            startedAt = performance.now();
            elements.timer.textContent = '0:00';
            renderWaveform([]);
            setPhase('recording');
            animationFrame = requestAnimationFrame(updateMeter);
        } catch (error) {
            cleanupCapture();
            const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
            showError(denied ? t.denied : (error && error.message === 'unsupported-mime' ? t.unsupported : t.failed));
        } finally {
            elements.record.disabled = false;
        }
    };

    const stopRecording = () => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording' || stopping) {
            return;
        }
        stopping = true;
        elements.stop.disabled = true;
        elements.cancel.disabled = true;
        const recorder = mediaRecorder;
        const durationMS = Math.min(MAX_DURATION_MS, Math.max(1, Math.round(performance.now() - startedAt)));
        recorder.addEventListener('stop', () => {
            const mimeType = normalizedMimeType(recorder.mimeType);
            const blob = new Blob(chunks, {type: mimeType});
            const peaks = downsample(samples);
            recordingResult = {blob, durationMS, peaks, mimeType};
            if (previewURL) {
                URL.revokeObjectURL(previewURL);
            }
            previewURL = URL.createObjectURL(blob);
            elements.preview.src = previewURL;
            elements.timer.textContent = formatDuration(durationMS);
            renderWaveform(peaks);
            cleanupCapture();
            setPhase('preview');
        }, {once: true});
        recorder.stop();
    };

    const discardRecording = () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        cleanupCapture();
        elements.preview.pause();
        elements.preview.removeAttribute('src');
        elements.preview.load();
        if (previewURL) {
            URL.revokeObjectURL(previewURL);
            previewURL = '';
        }
        recordingResult = null;
        mediaRecorder = null;
        chunks = [];
        samples = [];
        elements.timer.textContent = '0:00';
        renderWaveform([]);
        setPhase('ready');
    };

    const sendRecording = async () => {
        if (!recordingResult || !token) {
            showError(t.noToken);
            return;
        }
        setPhase('sending');
        const extension = recordingResult.mimeType === 'audio/mp4' ? 'm4a' : 'webm';
        const form = new FormData();
        form.append('audio', recordingResult.blob, `voice-note.${extension}`);
        form.append('duration_ms', String(recordingResult.durationMS));
        form.append('peaks', JSON.stringify(recordingResult.peaks));
        form.append('language', language);

        try {
            const response = await fetch('send', {
                method: 'POST',
                headers: {Authorization: `Bearer ${token}`},
                body: form,
                credentials: 'omit',
            });
            let payload = {};
            try {
                payload = await response.json();
            } catch (_) {
                // Use the localized fallback below.
            }
            if (!response.ok) {
                throw new Error(response.status === 401 ? t.noToken : t.sendFailed);
            }
            token = '';
            returnURL = payload.return_url || 'mattermost://';
            elements.preview.pause();
            setPhase('sent');
        } catch (error) {
            setPhase('preview');
            showError(error && error.message ? error.message : t.sendFailed);
        }
    };

    elements.record.addEventListener('click', startRecording);
    elements.stop.addEventListener('click', stopRecording);
    elements.cancel.addEventListener('click', discardRecording);
    elements.discard.addEventListener('click', discardRecording);
    elements.send.addEventListener('click', sendRecording);
    elements.openApp.addEventListener('click', () => window.location.assign(returnURL));
    window.addEventListener('pagehide', cleanupCapture);

    renderWaveform([]);
    setPhase('ready');
    if (!token) {
        showError(t.noToken);
        elements.record.disabled = true;
    }
})();
