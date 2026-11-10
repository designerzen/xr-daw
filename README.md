# XR DAW

A browser-based spatial MIDI sequencer built with **TypeScript, Meta Immersive Web SDK (IWSDK), Three.js, and Web Audio**. The application has no React components or React rendering layer.

Original project: winner of Most Innovative App at MuseHub 2024.

## Run

Use Node.js 22.12+ (Node 24 LTS recommended).

```sh
npm ci
npm run dev
```

Open `https://localhost:8081/`. IWSDK uses a self-signed development certificate, so a browser may ask you to accept it. Its managed development browser and IWER (the desktop XR emulator) are available for testing without a headset; Chromium is downloaded on first use. Production builds do not include the emulator.

On a headset, open the HTTPS network URL printed by Vite. Alternatively, connect a Quest by USB and use `adb reverse tcp:8081 tcp:8081`, then open `https://localhost:8081/` on the headset. The app starts in desktop mode; **Enter VR** requests an immersive session directly from your click.

## What works

- MIDI type 0/1 import, including simultaneous tracks and tempo changes.
- Four-bar piano-roll pages, track selection, and octave navigation.
- Mouse or controller/hand-ray note dragging, snapped to sixteenths.
- Add/delete notes, edit duration and velocity, audition, undo and redo.
- Polyphonic triangle synthesis, play/pause/stop, play from the visible page, and project looping.
- Track gain/mute, tempo scaling, IndexedDB autosave, downloadable JSON projects, and stereo PCM WAV export.
- A world-space UIKitML transport/editor panel in VR.

Select a note, then use arrow keys to change time/pitch. Shift + left/right changes duration; Shift + up/down transposes an octave. Delete removes a selected note. Space toggles playback; Ctrl/Cmd + Z undoes, and Shift + Ctrl/Cmd + Z redoes. Keyboard shortcuts are inactive while a form control has focus.

Autosave stores the most recent project in this browser on this device. Download a project to keep a portable copy. Opening another project replaces the current session. WAV export renders the built-in synth and respects track gain/mute.

## Architecture

- `src/app/project.ts`: versioned musical model, tick/second tempo conversion, validation, edit history.
- `src/app/midi.ts`: MIDI adapter using `midi-file`; each track maintains its own absolute tick position.
- `src/app/audio.ts`: framework-independent audio graph, worker-driven lookahead scheduler, offline WAV rendering.
- `src/app/session.ts`: shared editing/transport commands and viewport state.
- `src/app/sequencer-system.ts`: IWSDK entities, ray interactions, drag commits, and timeline presentation.
- `src/app/main.ts`: plain HTML desktop controls and app lifecycle.
- `public/ui/transport.uikitml`: spatial controls. `iwsdk.config.json` configures the world and manifest.

Musical times use ticks with an explicit PPQ. Mesh coordinates are derived from the project; dragging commits one edit on release. Audio uses `AudioContext.currentTime` and native audio nodes rather than the rendering loop. Custom DSP can be added behind this engine interface using AudioWorklet/WASM when needed.

IWSDK and its Three.js alias are pinned together. IWSDK uses some libraries with transitive React dependencies, and IWER's development UI uses React internally; app code does not depend on React or React Three Fiber.

The previous React prototype and existing audio/MIDI experiments remain in `src/` for reference, including in-progress changes. They are excluded from the new entry point and TypeScript build. The active app is entirely under `src/app/`. Existing synth/effect experiments have not been silently substituted into the new engine.

## Checks

```sh
npm test
npm run build
npm run serve
```

The build runs TypeScript checking before Vite. Tests cover tempo maps, MIDI tracks/overlaps, every bundled MIDI preset, history/validation, audio lookahead/seek/cancellation, and WAV encoding.

For a live desktop smoke test, enable IWSDK's local browser automation when starting development. In PowerShell:

```powershell
$env:IWSDK_DEV_HEADLESS = 'true'
$env:IWSDK_DEV_ALLOW_BROWSER_AUTOMATION = 'true'
npm run dev
```

In another terminal:

```sh
npx @iwsdk/cli browser run tests/browser-smoke.mjs --timeout 110000
npx @iwsdk/cli browser run tests/xr-enter.mjs
npx @iwsdk/cli xr status
npx @iwsdk/cli dev down
```

The smoke test exercises real mouse editing, undo/redo, playback, autosave/reload, preset import, project download, and WAV export. It writes temporary evidence under ignored `artifacts/`. Use IWSDK's XR tools to verify controller interactions in an active emulated session; a desktop screenshot alone does not verify VR input.

## Current limits

This is the first functional migration, not a complete recording DAW. All tracks currently use the same triangle synth. MIDI programs, sustain/controller events, percussion kits, and time-signature changes are not interpreted; bar labels use 4/4. SMPTE and independent type-2 MIDI sequences are rejected explicitly. WAV export is limited to ten minutes. Audio recording, external MIDI devices, plugin hosting, automation lanes, sample clips, and audio asset persistence are future engine features.

Only the selected track, four bars, and a 36-semitone range are rendered. Very dense MIDI pages still use individual editable meshes and need instancing/profiling before large sessions. Headset performance, physical hand/controller ergonomics, audio latency, and browser-specific support require device testing.

GitHub Actions uses Node 22, `npm ci`, tests, and the Vite build. The output in `dist/` supports project-subpath hosting. No deployment is performed by local build commands.

## License

MIT. See [LICENSE](LICENSE).
