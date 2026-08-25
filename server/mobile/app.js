(() => {
    'use strict';

    const Mp3Encoder = window.lamejs && window.lamejs.Mp3Encoder;
    const MAX_DURATION_MS = 300000;
    const BAR_COUNT = 48;
    const CHUNK_SIZE = 4096;
    const BIT_RATE_KBPS = 64;
    const messages = {
        en: {
            subtitle: 'Record a voice message for Mattermost', ready: 'Ready to record', recording: 'Recording…',
            preview: 'Listen before sending', sending: 'Sending…', record: 'Record', stop: 'Stop', discard: 'Discard',
            send: 'Send', sent: 'Voice message sent', return: 'Return to Mattermost',
            hint: 'Maximum length: 5 minutes. This private link can be used once.',
            noToken: 'This recorder link is invalid or has already been used.',
            unsupported: 'Voice recording is not supported by this browser.',
            denied: 'Microphone access is blocked. Allow it in your browser or system settings.',
            failed: 'Could not start recording.', interrupted: 'Recording was interrupted. Please try again.',
            tooLong: 'The recording exceeded 5 minutes and was discarded.', sendFailed: 'The voice message could not be sent.',
            sendUncertain: 'Mattermost could not confirm whether the message was sent. Check the channel before recording again.',
            retryMismatch: 'This link is tied to an earlier recording. Run /voice again to record a new message.',
        },
        ru: {
            subtitle: 'Запишите голосовое сообщение для Mattermost', ready: 'Готово к записи', recording: 'Идёт запись…',
            preview: 'Прослушайте перед отправкой', sending: 'Отправка…', record: 'Записать', stop: 'Стоп', discard: 'Удалить',
            send: 'Отправить', sent: 'Голосовое сообщение отправлено', return: 'Вернуться в Mattermost',
            hint: 'Не более 5 минут. Эта приватная ссылка работает один раз.',
            noToken: 'Ссылка недействительна или уже была использована.',
            unsupported: 'Этот браузер не поддерживает запись голоса.',
            denied: 'Доступ к микрофону заблокирован. Разрешите его в настройках браузера или системы.',
            failed: 'Не удалось начать запись.', interrupted: 'Запись была прервана. Попробуйте ещё раз.',
            tooLong: 'Запись превысила 5 минут и была удалена.', sendFailed: 'Не удалось отправить голосовое сообщение.',
            sendUncertain: 'Mattermost не подтвердил отправку сообщения. Проверьте канал перед новой записью.',
            retryMismatch: 'Ссылка привязана к предыдущей записи. Выполните /voice ещё раз для нового сообщения.',
        },
        es: {
            subtitle: 'Graba un mensaje de voz para Mattermost', ready: 'Listo para grabar', recording: 'Grabando…',
            preview: 'Escucha antes de enviar', sending: 'Enviando…', record: 'Grabar', stop: 'Parar', discard: 'Descartar',
            send: 'Enviar', sent: 'Mensaje de voz enviado', return: 'Volver a Mattermost',
            hint: 'Duración máxima: 5 minutos. Este enlace privado se puede usar una vez.',
            noToken: 'Este enlace no es válido o ya se ha utilizado.',
            unsupported: 'Este navegador no permite grabar voz.',
            denied: 'El micrófono está bloqueado. Permítelo en los ajustes del navegador o del sistema.',
            failed: 'No se pudo empezar a grabar.', interrupted: 'La grabación se interrumpió. Inténtalo de nuevo.',
            tooLong: 'La grabación superó los 5 minutos y se descartó.', sendFailed: 'No se pudo enviar el mensaje de voz.',
            sendUncertain: 'Mattermost no pudo confirmar el envío. Revisa el canal antes de volver a grabar.',
            retryMismatch: 'Este enlace está vinculado a una grabación anterior. Ejecuta /voice de nuevo.',
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

    let stream = null;
    let audioContext = null;
    let sourceNode = null;
    let processor = null;
    let sink = null;
    let encoder = null;
    let durationTimer = null;
    let chunks = [];
    let samples = [];
    let sampleCount = 0;
    let recordingResult = null;
    let previewURL = '';
    let returnURL = 'mattermost://';
    let recording = false;
    let stopping = false;

    const formatDuration = (milliseconds) => {
        const seconds = Math.max(0, Math.floor(milliseconds / 1000));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const setBarLevel = (bar, value) => {
        const level = Math.max(0.035, Math.min(1, value || 0.035));
        bar.className = `wave-bar wave-level-${Math.round(level * 20)}`;
    };

    const renderWaveform = (values) => {
        bars.forEach((bar, index) => setBarLevel(bar, values[index]));
    };

    const appendLivePeak = (peak) => {
        // Move the oldest bar itself so the history keeps its height while it
        // travels left. Reassigning every fixed bar from the shifted samples
        // makes the whole waveform jump vertically on every audio callback.
        const bar = bars.shift();
        setBarLevel(bar, peak);
        elements.waveform.appendChild(bar);
        bars.push(bar);
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

    const toInt16 = (float32) => {
        const output = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32[i]));
            output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        return output;
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
        elements.send.disabled = phase === 'sending' || !token;
        elements.discard.disabled = phase === 'sending';
        elements.error.hidden = true;
    };

    const showError = (message) => {
        elements.error.textContent = message;
        elements.error.hidden = false;
    };

    const cleanupCapture = () => {
        if (durationTimer !== null) {
            clearTimeout(durationTimer);
            durationTimer = null;
        }
        if (processor) {
            processor.onaudioprocess = null;
            processor.disconnect();
            processor = null;
        }
        if (sourceNode) {
            sourceNode.disconnect();
            sourceNode = null;
        }
        if (sink) {
            sink.disconnect();
            sink = null;
        }
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(() => {});
        }
        audioContext = null;
    };

    const failCapture = (message) => {
        recording = false;
        cleanupCapture();
        encoder = null;
        recordingResult = null;
        chunks = [];
        samples = [];
        sampleCount = 0;
        stopping = false;
        elements.timer.textContent = '0:00';
        renderWaveform([]);
        setPhase('ready');
        showError(message);
    };

    const finalizeRecording = () => {
        if (!recording || !encoder || !audioContext) {
            return;
        }
        const durationMS = Math.max(1, Math.round((sampleCount / audioContext.sampleRate) * 1000));
        if (durationMS > MAX_DURATION_MS + 1000) {
            failCapture(t.tooLong);
            return;
        }

        try {
            const finalChunk = encoder.flush();
            if (finalChunk.length) {
                chunks.push(finalChunk);
            }
        } catch (_) {
            failCapture(t.interrupted);
            return;
        }
        const blob = new Blob(chunks, {type: 'audio/mpeg'});
        if (!blob.size) {
            failCapture(t.interrupted);
            return;
        }
        const peaks = downsample(samples);
        recordingResult = {blob, durationMS, peaks};
        if (previewURL) {
            URL.revokeObjectURL(previewURL);
        }
        previewURL = URL.createObjectURL(blob);
        elements.preview.src = previewURL;
        elements.timer.textContent = formatDuration(durationMS);
        renderWaveform(peaks);
        recording = false;
        cleanupCapture();
        encoder = null;
        stopping = false;
        setPhase('preview');
    };

    const ingestAudio = (float32) => {
        if (!recording || stopping || !float32 || !float32.length) {
            return;
        }
        let peak = 0;
        for (let i = 0; i < float32.length; i++) {
            peak = Math.max(peak, Math.abs(float32[i]));
        }
        samples.push(peak);

        try {
            const encoded = encoder.encodeBuffer(toInt16(float32));
            if (encoded.length) {
                chunks.push(encoded);
            }
        } catch (_) {
            failCapture(t.interrupted);
            return;
        }
        sampleCount += float32.length;
        appendLivePeak(peak);

        const elapsed = (sampleCount / audioContext.sampleRate) * 1000;
        elements.timer.textContent = formatDuration(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
            stopRecording();
        }
    };

    const startRecording = async () => {
        if (!token) {
            showError(t.noToken);
            return;
        }
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioContextClass || !Mp3Encoder) {
            showError(t.unsupported);
            return;
        }

        elements.record.disabled = true;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true},
            });
            audioContext = new AudioContextClass();
            await audioContext.resume();
            encoder = new Mp3Encoder(1, audioContext.sampleRate, BIT_RATE_KBPS);
            sourceNode = audioContext.createMediaStreamSource(stream);
            processor = audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);
            sink = audioContext.createGain();
            sink.gain.value = 0;

            chunks = [];
            samples = [];
            sampleCount = 0;
            recording = true;
            stopping = false;
            elements.stop.disabled = false;
            elements.cancel.disabled = false;
            processor.onaudioprocess = (event) => ingestAudio(event.inputBuffer.getChannelData(0));
            stream.getAudioTracks().forEach((track) => {
                track.addEventListener('ended', () => {
                    if (recording && !stopping) {
                        failCapture(t.interrupted);
                    }
                }, {once: true});
            });
            sourceNode.connect(processor);
            processor.connect(sink);
            sink.connect(audioContext.destination);
            durationTimer = window.setTimeout(stopRecording, MAX_DURATION_MS);
            elements.timer.textContent = '0:00';
            renderWaveform([]);
            setPhase('recording');
        } catch (error) {
            recording = false;
            cleanupCapture();
            encoder = null;
            const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
            showError(denied ? t.denied : t.failed);
        } finally {
            elements.record.disabled = false;
        }
    };

    const stopRecording = () => {
        if (!recording || stopping) {
            return;
        }
        stopping = true;
        elements.stop.disabled = true;
        elements.cancel.disabled = true;
        if (durationTimer !== null) {
            clearTimeout(durationTimer);
            durationTimer = null;
        }
        finalizeRecording();
    };

    const discardRecording = () => {
        recording = false;
        stopping = true;
        cleanupCapture();
        encoder = null;
        elements.preview.pause();
        elements.preview.removeAttribute('src');
        elements.preview.load();
        if (previewURL) {
            URL.revokeObjectURL(previewURL);
            previewURL = '';
        }
        recordingResult = null;
        chunks = [];
        samples = [];
        sampleCount = 0;
        stopping = false;
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
        const form = new FormData();
        form.append('audio', recordingResult.blob, 'voice-note.mp3');
        form.append('duration_ms', String(recordingResult.durationMS));
        form.append('peaks', JSON.stringify(recordingResult.peaks));
        form.append('language', language);

        try {
            const response = await fetch('send', {
                method: 'POST',
                headers: {'X-Voice-Recorder-Token': token},
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
                if (payload.post_status_unknown) {
                    token = '';
                    throw new Error(t.sendUncertain);
                }
                if (payload.retry_mismatch) {
                    token = '';
                    throw new Error(t.retryMismatch);
                }
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
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && recording) {
            stopRecording();
        }
    });
    window.addEventListener('pagehide', cleanupCapture);

    renderWaveform([]);
    setPhase('ready');
    if (!token) {
        showError(t.noToken);
        elements.record.disabled = true;
    }
})();
