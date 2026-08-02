const css = `
.vn-panel {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 340px;
    max-width: min(560px, calc(100vw - 32px));
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--center-channel-bg, #fff);
    color: var(--center-channel-color, #3d3c40);
    border: 1px solid rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.12);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    animation: vn-rise 140ms ease-out;
}

@keyframes vn-rise {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.vn-rec-dot {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--dnd-indicator, #d24b4e);
    animation: vn-pulse 1.2s ease-in-out infinite;
}

@keyframes vn-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.82); }
}

.vn-timer {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    min-width: 34px;
}

.vn-timer--warn { color: var(--dnd-indicator, #d24b4e); }

.vn-wave {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    flex: 1 1 120px;
    min-width: 90px;
}

.vn-wave--seekable { cursor: pointer; touch-action: none; }

.vn-bar {
    flex: 1 1 0;
    min-width: 0;
    max-width: 4px;
    border-radius: 2px;
    background: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.32);
}

.vn-wave--live .vn-bar { transition: height 90ms linear; }

.vn-bar--played { background: var(--button-bg, #166de0); }

.vn-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.64);
    cursor: pointer;
}

.vn-icon-btn:hover {
    background: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.08);
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.8);
}

.vn-icon-btn--accent {
    background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
    color: var(--button-bg, #166de0);
}

.vn-icon-btn--accent:hover {
    background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.2);
    color: var(--button-bg, #166de0);
}

.vn-send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    padding-left: 2px;
    border: 0;
    border-radius: 50%;
    background: var(--button-bg, #166de0);
    color: var(--button-color, #fff);
    cursor: pointer;
    transition: filter 120ms ease;
}

.vn-send-btn:hover { filter: brightness(1.08); }

.vn-chip {
    flex-shrink: 0;
    padding: 3px 8px;
    border: 0;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.08);
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.72);
    cursor: pointer;
    white-space: nowrap;
}

.vn-chip:hover { background: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.14); }

.vn-chip--on {
    background: rgba(var(--button-bg-rgb, 22, 109, 224), 0.12);
    color: var(--button-bg, #166de0);
}

.vn-target {
    position: absolute;
    top: -20px;
    right: 10px;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 8px;
    background: var(--center-channel-bg, #fff);
    border: 1px solid rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.12);
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.64);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vn-label { font-size: 13px; }

.vn-error {
    font-size: 13px;
    color: var(--error-text, #d24b4e);
    max-width: 320px;
}

.vn-spinner {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 2px solid rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.2);
    border-top-color: var(--button-bg, #166de0);
    animation: vn-spin 0.8s linear infinite;
}

@keyframes vn-spin { to { transform: rotate(360deg); } }

.vn-player {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    width: min(380px, 100%);
    margin: 4px 0;
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.04);
    border: 1px solid rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.08);
}

.vn-player .vn-wave { height: 28px; }

.vn-player--broken {
    font-size: 13px;
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.56);
}

.vn-play-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--button-bg, #166de0);
    color: var(--button-color, #fff);
    cursor: pointer;
    transition: filter 120ms ease;
}

.vn-play-btn:hover { filter: brightness(1.08); }

.vn-time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.64);
    flex-shrink: 0;
    white-space: nowrap;
}

.vn-download {
    display: inline-flex;
    align-items: center;
    color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.48);
    flex-shrink: 0;
}

.vn-download:hover { color: rgba(var(--center-channel-color-rgb, 61, 60, 64), 0.72); }

.post__body:has(.vn-player) .file-view--single,
.post__body:has(.vn-player) .post-image__columns {
    display: none;
}
`;

export function injectStyles() {
    if (document.getElementById('vn-styles')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'vn-styles';
    style.textContent = css;
    document.head.appendChild(style);
}
