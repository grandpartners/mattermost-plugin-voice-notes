# Voice Notes (Mattermost plugin)

Voice messages for Mattermost. We wanted them in our team chat and the existing options weren't great... the original `mattermost-plugin-voice` has been abandoned since 2022 and doesn't record on modern servers, and the forks that revive it didn't feel good enough to use daily. So I wrote a new one from scratch.

The web and desktop recorder runs directly in Mattermost. On mobile, where Mattermost does not load plugin webapp code, a small server component opens a secure standalone recorder from `/voice`.

![Recording, sending and playing a voice note](assets/demo.gif)

## What it does

- Record from the attachment menu (📎 → *Voice message*), the `/voice` command or the app bar mic icon. In the Mattermost mobile app, `/voice` returns a private recorder link that works for 20 minutes and can send one note.
- On web and desktop, audio is encoded to MP3 while you record (mono, 64 kbps), so when you stop there's no wait, the file is already there.
- You can listen and seek before sending, or send directly while recording. Enter sends, Esc cancels (unless you're typing in a text field, your keystrokes are yours).
- Sent notes get an inline player with waveform peaks calculated in the recorder (the peaks travel in the post props), click/drag to seek, 1×/1.5×/2× playback speed (remembered), and a download link. Only one note plays at a time.
- The note goes to the channel/thread that was active when you opened the recorder, and a chip lets you switch between thread and channel before sending.
- Light/dark theme (Mattermost CSS variables). The web recorder supports English and Spanish; the mobile recorder supports English, Russian and Spanish.
- Posts created by the old `mattermost-plugin-voice` render fine too (same `custom_voice` post type).

A couple of notes on the boring-but-important parts:

- Post props are sender-controlled, so the player sanitizes them before rendering (file ID format, peak count and range, duration). The server checks mobile waveform peaks for count and range but does not derive or verify them against the audio.
- Capture uses `ScriptProcessorNode` on purpose. AudioWorklet needs its module fetched as a script, and Mattermost's CSP (`script-src 'self'`) blocks `blob:` and `data:` URLs... a webapp-only plugin has no same-origin file to serve, so the deprecated API is the one that actually works everywhere.

## Mobile app support

Mattermost Mobile does not load third-party plugin webapp bundles. As a result, the original webapp-only plugin could play existing voice notes on mobile but could not register a working mobile recorder. Registering `/voice` on the server alone would make the command available, but it would still provide no recording interface.

This plugin solves that limitation with a small Go server component and a standalone mobile recorder:

1. Run `/voice` in a channel or thread in the Mattermost mobile app.
2. The server responds only to you with a private recorder link. The link expires after 20 minutes and can send one voice note.
3. The recorder opens in the browser or Mattermost in-app browser and uses the native `MediaRecorder` API. It applies a five-minute client-side recording limit, stops capture if the page is hidden, and supports live waveform, preview, discard and send actions in English, Russian and Spanish.
4. The recorder prefers MP4/M4A when the browser reports it as supported and falls back to WebM. The server uploads the result and creates a regular `custom_voice` post in the channel and thread where `/voice` was run.
5. After a successful send, the recorder provides a `mattermost://` link back to the app.

The recorder link carries its token in the URL fragment, so the token is not sent in the initial HTTP request. Only a SHA-256 hash of the usable bearer token is stored by the server. Sending claims the token atomically across Mattermost nodes; after a failed send the server attempts to release it for another attempt, while a successful send permanently redeems it. If file upload succeeds but post creation fails, a retry reuses the stored file and a stable `PendingPostId`; failures are logged so any file left without a post can be diagnosed while Mattermost's normal orphan-file cleanup handles it. Channel access, post creation and file-upload permissions are checked again immediately before upload.

The server rejects uploads larger than 32 MB, unsupported container signatures and declared durations over five minutes (with a one-second stop tolerance). It does not decode M4A/WebM media metadata, so the duration limit protects the normal recorder flow rather than acting as a strict content-verification boundary for a deliberately crafted upload.

## Requirements

Mattermost Server ≥ 10.0 (we run it on 11.8.x).

Mobile recording additionally requires:

- an externally reachable HTTPS Mattermost URL, because mobile browsers only grant microphone access in a secure context;
- `ServiceSettings.SiteURL` set to that HTTPS URL (for example, `https://mattermost.example.com`);
- microphone permission for the browser or Mattermost in-app browser.

The command preserves the channel and thread in which it was run. Membership, post and file-upload permissions are checked again immediately before upload. After sending, the recorder offers a `mattermost://` link back to the app.

## Install

Grab the tarball from the releases page and upload it in **System Console → Plugins → Plugin Management**, or from a server shell:

```sh
mmctl plugin add corp.osbren.voicenotes-<version>.tar.gz
mmctl plugin enable corp.osbren.voicenotes
```

Or let the server download it directly, always the latest release:

```sh
mmctl plugin install-url https://github.com/osbren-corp/mattermost-plugin-voice-notes/releases/latest/download/voicenotes.tar.gz
mmctl plugin enable corp.osbren.voicenotes
```

(plugin uploads have to be enabled while installing, `PluginSettings.EnableUploads`)

## Build

```sh
cd webapp && npm ci && cd ..
go mod download
./package.sh    # → dist/corp.osbren.voicenotes-<version>.tar.gz
```

Packaging requires Go 1.24.13 and Node.js. It cross-compiles the server component for Linux (amd64/arm64), macOS (amd64/arm64) and Windows (amd64).

Pushing a `vX.Y.Z` tag builds and publishes the release automatically.

## Development

The mobile app support task described above was completed by the [synthstack.ai](https://synthstack.ai) platform.

## License

MIT. MP3 encoding by [@breezystack/lamejs](https://www.npmjs.com/package/@breezystack/lamejs) (LGPL), bundled unmodified.
