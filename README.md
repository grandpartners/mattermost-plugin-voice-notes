# Voice Notes — Mattermost plugin

Lightweight voice messages for Mattermost: record, preview and send MP3 voice
notes with an inline waveform player. A modern replacement for the abandoned
`mattermost-plugin-voice`.

## Highlights

- **Webapp-only plugin** — no Go server component, no served assets. The
  installable tarball is ~70 KB.
- **Progressive MP3 encoding** while recording (`@breezystack/lamejs`, mono,
  64 kbps): the file is ready the instant you stop. Capture deliberately uses
  `ScriptProcessorNode`: Mattermost's CSP (`script-src 'self'`) blocks
  AudioWorklet modules from `blob:` URLs, and a webapp-only plugin has no
  same-origin module file to serve.
- **Preview before sending**, with seekable waveform, or send directly while
  recording. `Enter` sends, `Esc` cancels — unless you are typing in a text
  field.
- **Inline player** on `custom_voice` posts: the real recorded waveform
  (peaks travel in the post props), click/drag seek, `1× / 1.5× / 2×`
  playback rate (persisted), download link, and a single shared audio element
  so only one note plays at a time.
- **Thread-safe targeting**: the recording is bound to the channel/thread
  that was active when the recorder opened, validated against the channel — a
  chip lets you switch between thread and channel before sending.
- Theme-aware (Mattermost CSS variables), ES/EN translations, MP3 output
  plays on the native mobile apps as a file attachment (recording is
  web/desktop only — Mattermost mobile apps do not run plugin webapp code).
- Renders legacy posts from `mattermost-plugin-voice` (same `custom_voice`
  post type; a deterministic waveform substitutes the missing peaks).
- Sender-controlled post props are sanitized before rendering (file id
  format, peak count/range, duration).

## Requirements

- Mattermost Server ≥ 10.0 (tested on 11.8.x, web and desktop apps).

## Install

Download the tarball from the releases page, then either upload it in
**System Console → Plugins → Plugin Management**, or from the server:

```sh
mmctl plugin add corp.osbren.voicenotes-<version>.tar.gz
mmctl plugin enable corp.osbren.voicenotes
```

Plugin uploads must be enabled (`PluginSettings.EnableUploads`) while
installing.

## Usage

Record from the attachment menu (📎 → *Voice message*), the `/voice` slash
command, or the app bar microphone icon.

## Build

```sh
cd webapp && npm ci && cd ..
./package.sh    # → dist/corp.osbren.voicenotes-<version>.tar.gz
```

## License

MIT. MP3 encoding by [@breezystack/lamejs](https://www.npmjs.com/package/@breezystack/lamejs)
(LGPL), bundled unmodified.
