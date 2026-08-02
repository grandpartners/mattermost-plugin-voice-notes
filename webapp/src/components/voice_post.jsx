import React, {useMemo, useSyncExternalStore} from 'react';
import {useIntl} from 'react-intl';

import {fileUrl} from '../api';
import {WAVEFORM_BARS} from '../constants';
import {fallbackPeaks, formatDuration, isValidFileId, sanitizePeaks} from '../utils';
import * as playback from '../audio/playback';

import Waveform from './waveform';
import {DownloadIcon, PauseIcon, PlayIcon} from './icons';

export default function VoicePost({post}) {
    const intl = useIntl();
    useSyncExternalStore(playback.subscribe, playback.getVersion);

    const rawFileId = post.props?.fileId || post.file_ids?.[0];
    const fileId = isValidFileId(rawFileId) ? rawFileId : null;

    const peaks = useMemo(
        () => sanitizePeaks(post.props?.peaks, WAVEFORM_BARS) || fallbackPeaks(post.id, WAVEFORM_BARS),
        [post.props, post.id],
    );

    if (!fileId) {
        return <div className='vn-player vn-player--broken'>{intl.formatMessage({id: 'voicenotes.unavailable'})}</div>;
    }

    const src = fileUrl(fileId);
    const snap = playback.getSnapshot(post.id);
    const rawMs = post.props?.duration;
    const propsDuration = typeof rawMs === 'number' && isFinite(rawMs) && rawMs > 0 ? rawMs / 1000 : 0;
    const duration = snap.duration || propsDuration;
    const progress = snap.current && duration > 0 ? snap.time / duration : 0;
    const rate = playback.getRate();

    if (snap.failed) {
        return <div className='vn-player vn-player--broken'>{intl.formatMessage({id: 'voicenotes.unavailable'})}</div>;
    }

    return (
        <div className='vn-player'>
            <button
                type='button'
                className='vn-play-btn'
                aria-label={intl.formatMessage({id: snap.playing ? 'voicenotes.pause' : 'voicenotes.play'})}
                onClick={() => playback.toggle(post.id, src)}
            >
                {snap.playing ? <PauseIcon size={18}/> : <PlayIcon size={18}/>}
            </button>
            <Waveform
                peaks={peaks}
                progress={progress}
                onSeek={(f) => playback.seek(post.id, src, f)}
            />
            <span className='vn-time'>
                {formatDuration(snap.current && snap.time > 0 ? snap.time : duration)}
            </span>
            <button
                type='button'
                className='vn-chip'
                title='1× · 1.5× · 2×'
                onClick={() => playback.cycleRate()}
            >
                {`${rate}×`}
            </button>
            <a
                className='vn-download'
                href={`${src}?download=1`}
                aria-label={intl.formatMessage({id: 'voicenotes.download'})}
                title={intl.formatMessage({id: 'voicenotes.download'})}
                download={true}
            >
                <DownloadIcon size={14}/>
            </a>
        </div>
    );
}
