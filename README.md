# XR DAW

An immersive extended reality digital audio workstation for exploring and editing music in 3D. Open a MIDI file, shape notes in space, and listen as you work—on a desktop or in a VR headset.

Winner of **Most Innovative App at MuseHub 2024**.

[Try XR DAW online](https://designerzen.github.io/xr-daw/)

## Making music

Start with the included song or open a `.mid` or `.midi` file from your device. Notes encode musical data in three dimensions: horizontal position represents time, vertical position represents pitch, length represents duration, and depth represents velocity. Louder notes extend farther from a shared rear plane, so you can compare their dynamics spatially.

- Drag notes with a mouse or point and grab with a VR controller or hand ray. Edits snap to the grid, a sixteenth note unless you choose another size (or Off) in the tool palette.
- Use the transport to play, pause, and stop. Every track is shown at once, each in its own colour; choose a single track to focus on it, and adjust the tempo as you listen. Selecting a note makes its track the one that new notes and the track level and mute controls apply to.
- Switch between **Notes** and **Velocity** to view the same 3D notes across pitch or depth. Switching views preserves your selection and playback position.
- Select a note to change its length or velocity, audition it, repeat it, or delete it. Add notes and undo or redo your edits from the editing menu.
- The tool palette on the left switches between **Select**, **Draw** and **Erase**. Draw adds a note in the grid cell you click, previewing it as you hover; new notes take the length and velocity of the last note you drew, resized or selected. Erase removes notes you click, or drag across with the button held.
- Ctrl/Cmd-click notes to build a selection, or select them all. A selection moves, resizes, transposes, changes velocity and deletes together, and dragging any note in it drags the group. Tap empty space to clear it.
- Cut, copy and paste from the editing menu: notes are pasted at the playhead when it is in view, otherwise at the start of the view. **Repeat** places a copy of the selection straight after itself, and **Quantize** snaps the selection's starts and ends to the grid.
- In VR, the menu's **Select**/**Draw**/**Erase** button cycles the tool and the **Grid** button cycles the snap size, next to All, Copy, Paste, Repeat and Quantize.
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

## Augmented reality

On devices that support it, such as Meta Quest headsets and Android phones with Chrome, an **Enter AR** button appears beside **Enter VR**. It shows the same timeline and transport in your own room instead of the virtual studio. The button stays hidden where AR is unavailable.

## Mouse and touchscreen navigation

The music is scaled to fill the screen between the controls. The camera menu at the top of the side toolbar sets how it is drawn:

| Camera | View |
| --- | --- |
| **Oblique** (default) | Flat timeline with velocity depth drawn as a half-length diagonal. Every bar and pitch stays the same size. |
| **Cavalier** | Like Oblique, with velocity depth at full length. |
| **Flat** | Straight-on piano roll with no depth. |
| **3D** | Perspective camera you can orbit. |

Your choice is remembered on this device. Add `?camera=cabinet`, `cavalier`, `front`, or `perspective` to the address to choose one for a link.

In the flat and oblique views, drag empty space to pan and scroll or pinch to zoom. In **3D**, drag empty space to orbit, right-drag or Shift-drag to pan, and scroll to zoom. On a touchscreen, drag with one finger to orbit in 3D or to pan in the other views; use two fingers to pan and pinch to zoom. **Look** mode (3D only) lets you rotate even when your gesture starts on a note or waveform. Turn it off to edit or scratch again. Use **Reset view** to fit the music to the screen again.

The visible timeline strip offers **4 bars**, **16 bars**, or the entire **Song**. Use its arrows and slider to reach any section; the counter shows the current bars and total length. **Follow** advances the visible section during playback. Navigating manually turns Follow off; enable it again to return to the playhead. The pitch axis covers every shown note in the whole song, so parts never drop out of view as you page. The pitch arrows move it by an octave. These controls are also available in the VR transport.

Choose **Scroll** in the timeline strip for a continuous view instead of pages. The playhead travels to the middle of the board and stays there while the music scrolls in from the right, and the slider becomes a song-position scrubber. The page arrows and Follow are hidden in this mode. In VR, the transport's **Scroll** button switches modes, and Prev and Next step a quarter of the view. Your choice is remembered on this device; add `?timeline=scroll` or `?timeline=pages` to the address to choose one for a link.

## Keyboard controls

| Key | Action |
| --- | --- |
| Space | Play or pause |
| Left / right | Move the selected notes one grid step |
| Up / down | Change the selected notes' pitch |
| Shift + left / right | Change note duration |
| Shift + up / down | Transpose by an octave |
| Delete / Backspace | Delete the selected notes |
| V / B / E | Select, Draw or Erase tool |
| Ctrl/Cmd + click | Add a note to the selection, or take it out |
| Ctrl/Cmd + A | Select every shown note |
| Ctrl/Cmd + X / C / V | Cut, copy or paste |
| Ctrl/Cmd + D | Repeat the selection after itself |
| Q | Quantize the selection |
| Escape | Clear the selection |
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
