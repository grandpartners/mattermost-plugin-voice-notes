import React, {useCallback, useRef} from 'react';

export default function Waveform({peaks, progress = null, live = false, onSeek = null}) {
    const ref = useRef(null);

    const seekFromEvent = useCallback((e) => {
        if (!onSeek || !ref.current) {
            return;
        }
        const rect = ref.current.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        onSeek(fraction);
    }, [onSeek]);

    const onPointerDown = useCallback((e) => {
        if (!onSeek) {
            return;
        }
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromEvent(e);
    }, [onSeek, seekFromEvent]);

    const onPointerMove = useCallback((e) => {
        if (!onSeek || !e.currentTarget.hasPointerCapture(e.pointerId)) {
            return;
        }
        seekFromEvent(e);
    }, [onSeek, seekFromEvent]);

    const count = peaks.length;
    return (
        <div
            ref={ref}
            className={`vn-wave${live ? ' vn-wave--live' : ''}${onSeek ? ' vn-wave--seekable' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
        >
            {peaks.map((p, i) => {
                const played = progress !== null && (i + 0.5) / count <= progress;
                return (
                    <div
                        key={i}
                        className={`vn-bar${played ? ' vn-bar--played' : ''}`}
                        style={{height: `${Math.round(12 + Math.min(1, p) * 88)}%`}}
                    />
                );
            })}
        </div>
    );
}
