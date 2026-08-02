import {POST_TYPE} from './constants';

const csrfToken = () => (document.cookie.match(/(?:^|;\s*)MMCSRF=([^;]+)/) || [])[1] || '';

const headers = () => ({
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': csrfToken(),
});

async function parseResponse(response) {
    if (!response.ok) {
        let message = response.statusText;
        try {
            const payload = await response.json();
            if (payload.message) {
                message = payload.message;
            }
        } catch {
            // keep statusText
        }
        throw new Error(message);
    }
    return response.json();
}

export async function uploadVoiceFile(channelId, blob) {
    const formData = new FormData();
    formData.append('files', blob, `voice-note-${Date.now()}.mp3`);
    formData.append('channel_id', channelId);

    const response = await fetch('/api/v4/files', {
        method: 'POST',
        headers: headers(),
        body: formData,
        credentials: 'same-origin',
    });
    const data = await parseResponse(response);
    return data.file_infos[0].id;
}

export async function createVoicePost({channelId, rootId, fileId, durationMs, peaks, message}) {
    const body = {
        channel_id: channelId,
        root_id: rootId || '',
        message,
        type: POST_TYPE,
        file_ids: [fileId],
        props: {
            voice_message: true,
            fileId,
            duration: durationMs,
            peaks,
        },
    };

    const response = await fetch('/api/v4/posts', {
        method: 'POST',
        headers: {...headers(), 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
        credentials: 'same-origin',
    });
    return parseResponse(response);
}

export const fileUrl = (fileId) => `/api/v4/files/${fileId}`;
