# XR DAW

An immersive extended reality digital audio workstation for exploring and editing music in 3D. Open a MIDI file, shape notes in space, and listen as you work—on a desktop or in a VR headset.

Winner of **Most Innovative App at MuseHub 2024**.

[Try XR DAW online](https://designerzen.github.io/xr-daw/)

## Making music

Start with the included song or open a `.mid` or `.midi` file from your device. Notes encode musical data in three dimensions: horizontal position represents time, vertical position represents pitch, length represents duration, and depth represents velocity. Louder notes extend farther from a shared rear plane, so you can compare their dynamics spatially.

- Drag notes with a mouse or point and grab with a VR controller or hand ray. Edits snap to sixteenth notes.
- Use the transport to play, pause, and stop. Choose a track and adjust the tempo as you listen.
- Switch between **Notes** and **Velocity** to view the same 3D notes across pitch or depth. Switching views preserves your selection and playback position.
- Select a note to change its length or velocity, audition it, or delete it. Add notes and undo or redo your edits from the editing menu.
- Open the project menu to save a portable project or export a stereo WAV file.

Projects autosave in your browser on your device. Download a project file to keep a copy or move it to another computer. Reopening that file restores its notes, tracks, levels, and tempo map.

## Audio waveforms

Drop a MIDI, audio, or project file anywhere on the app, or choose **Open media or project** from the project menu. WAV/WAVE and other audio formats supported by your browser (such as MP3, Ogg, FLAC, and M4A) open in **Waveform** view, alongside your MIDI views.

Each audio channel forms a stack of circular cross-sections in 3D. Time runs along the stack, amplitude controls each circle's radius, and a windowed FFT colors each circle by its local spectral frequency. Long files use peak-preserving time buckets, with up to 8,192 circles across the channels.

Press anywhere on the waveform to play from that time. Hold and drag to scratch: moving left plays audio backward, moving right plays forward, and speed follows your movement. Release to continue normal playback from that point. Left and right arrow keys jump one second. Play, pause, stop, loop, gain, and mute also work on audio.

Audio stays in memory for the current session; MIDI project autosaves do not embed it. **Download audio** keeps the original file, and **Export WAV** saves the decoded audio as WAV. Audio imports support up to ten minutes, eight channels, and a 100 MB file size.

Enable **Vinyl** in the transport to hear the audio through [rauchg/vinyl](https://github.com/rauchg/vinyl)'s physical groove, stylus, cartridge, and phono simulation. Choose **Clean**, **Worn**, or **Damaged** in the editing menu to change the pressing and stylus condition. Your audio is cut into a simulated stereo record in a background worker; waveform scratching then controls its platter, including reverse motion and inertia. Disable Vinyl to return to the original audio. The VR menu provides the same Vinyl and condition controls.

With Vinyl enabled, **Export WAV** renders the selected vinyl condition; **Download audio** always keeps the original file. Multichannel audio is folded into a stereo groove for Vinyl playback. The engine source and MIT license are included under `apps/web/public/vendor/vinyl`.

Playback uses a polyphonic triangle synthesizer. MIDI formats 0 and 1 are supported, including multiple tracks and tempo changes. Bar labels use 4/4 time. WAV export supports projects up to ten minutes long.

## Virtual reality

Open the app in a browser with WebXR support and choose **Enter VR**. The timeline stays in front of you, with a compact transport underneath it. Point at a note to select it, then hold and move it to change its time or pitch.

The transport menu provides track selection, note editing, and timeline navigation. Choose **Exit** to return to the desktop view.

## Keyboard controls

| Key | Action |
| --- | --- |
| Space | Play or pause |
| Left / right | Move the selected note in time |
| Up / down | Change the selected note's pitch |
| Shift + left / right | Change note duration |
| Shift + up / down | Transpose by an octave |
| Delete / Backspace | Delete the selected note |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |

Shortcuts apply while the scene has focus.

## Local development

Install **Node.js 22.12 or later** and npm, then clone the repository:

```sh
git clone https://github.com/designerzen/xr-daw.git
cd xr-daw
npm ci
npm run dev
```

Open `https://localhost:8081/`. The development server uses a self-signed HTTPS certificate; your browser may ask you to accept it.

The repository uses npm workspaces and Turborepo. The web application lives in `apps/web`, including its source, assets, spatial UI, and tests. Run commands from the repository root:

```sh
npm test             # Run unit tests
npm run typecheck    # Check TypeScript
npm run build        # Type-check and build the app
npm run check        # Run tests, type checks, and the build
npm run serve        # Preview the production build
npm run format       # Format application code and tests
```

Turborepo caches successful builds, tests, and type checks. Development servers and formatting tasks run without caching.

### Developing with a headset

Connect the headset to the same network as your computer and open the HTTPS network address printed by the development server.

For a Quest connected by USB, enable developer mode and forward the server port:

```sh
adb reverse tcp:8081 tcp:8081
```

Then open `https://localhost:8081/` in the headset browser.

### Developing without a headset

IWSDK includes IWER, a browser-based XR emulator. It lets you move an emulated headset and controllers while developing on your computer. Its managed Chromium browser is downloaded on first use. Disable other WebXR emulator extensions to avoid conflicting runtimes.

See [development and testing](docs/development.md) for browser automation and XR checks.

## Build and deploy

```sh
npm run build
```

Upload the contents of `apps/web/dist` to a static host. The build supports hosting under a project subpath.

GitHub Actions runs tests and builds the application when commits are pushed to `main`, then deploys the output to GitHub Pages. To use this in a fork, enable **GitHub Actions** as the Pages source in the repository settings.

## How it works

TypeScript and IWSDK manage the Three.js scene, spatial controls, and WebXR input. A shared musical project describes tracks, notes, and tempo changes. Both desktop and immersive controls edit that same project.

Web Audio schedules synthesis against the audio clock, independently of the scene's frame rate. Offline rendering turns the project into a WAV file, while IndexedDB stores the local autosave.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
