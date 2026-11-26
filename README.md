# XR DAW

An immersive extended reality digital audio workstation for exploring and editing music in 3D. Open a MIDI file, shape notes in space, and listen as you work—on a desktop or in a VR headset.

Winner of **Most Innovative App at MuseHub 2024**.

[Try XR DAW online](https://designerzen.github.io/xr-daw/)

## Making music

Start with the included song or drop a supported music file from your device. Notes encode musical data in three dimensions: horizontal position represents time, vertical position represents pitch, length represents duration, and depth represents velocity. Louder notes extend farther from a shared rear plane, so you can compare their dynamics spatially.

- Drag notes with a mouse or point and grab with a VR controller or hand ray. Edits snap to the grid, a sixteenth note unless you choose another size (or Off) in the tool palette.
- Use the transport to play, pause, and stop. Every track is shown at once, each in its own colour; choose a single track to focus on it, and adjust the tempo as you listen. Selecting a note makes its track the one that new notes and the track level and mute controls apply to.
- Switch between **Notes** and **Velocity** to view the same 3D notes across pitch or depth. Switching views preserves your selection and playback position.
- Select a note to change its length or velocity, audition it, repeat it, or delete it. Add notes and undo or redo your edits from the editing menu.
- The tool palette on the left switches between **Select**, **Draw** and **Erase**. Draw adds a note in the grid cell you click, previewing it as you hover; new notes take the length and velocity of the last note you drew, resized or selected. Erase removes notes you click, or drag across with the button held.
- Ctrl/Cmd-click notes to build a selection, or select them all. A selection moves, resizes, transposes, changes velocity and deletes together, and dragging any note in it drags the group. Tap empty space to clear it.
- Cut, copy and paste from the editing menu: notes are pasted at the playhead when it is in view, otherwise at the start of the view. **Repeat** places a copy of the selection straight after itself, and **Quantize** snaps the selection's starts and ends to the grid.
- In VR, the menu's **Select**/**Draw**/**Erase** button cycles the tool and the **Grid** button cycles the snap size, next to All, Copy, Paste, Repeat and Quantize.
- Open the project menu to save a portable project or export a stereo WAV file.

Projects autosave in your browser on your device. Download a project file to keep a copy or move it to another computer. Reopening that file restores its notes, tracks, sounds, levels, tempo and time-signature maps, sustain, pitch bends and program changes.

## Tracks and sounds

Open **Tracks** on the left to rename parts, choose from 128 synthesized General MIDI presets, and adjust each track's level, mute and solo. Several tracks can be soloed together; mute still silences a soloed track. The coloured dot matches the track's notes in the All tracks view. Click its name to make it the active track for drawing without hiding other parts, or **Focus** to show only that part. **Show all** brings every part back, and **+ Track** creates an empty part.

Enable **Drums** on a track for a synthesized percussion kit. MIDI pitches 35/36 play kick, 38–40 snare/clap, 42/44/46 hi-hats, 41/43/45/47/48/50 toms, and 49/51/52/53/55/57/59 cymbals; other pitches play short pitched percussion. The melodic preset remains selected when drum mode is turned off. These are synthesized approximations, rather than sampled General MIDI instruments.

Sounds, drum mode, solo and mixer settings are included in project files and autosave. Audition uses the sound and bend at the selected note's start; playback and WAV export also respect mute, solo and levels. Choosing a preset in the track panel replaces that part's imported program-change map with your chosen sound; Undo restores it. Imported expression is summarized as program, pedal and bend event counts under each track.

In VR, choose a track with **Track**, then open **Menu** for mute, solo, drum mode and level buttons. The sound button cycles through ten representative melodic presets; the desktop panel offers the complete bank.

## Musical timing and expression

MIDI and RIFF MIDI imports preserve changing time signatures, sustain pedal (CC64), signed pitch-wheel values and timed General MIDI program changes. Mixed-channel source tracks are split into named channel parts, including channel-10 percussion. Channel expression is retained even when a MIDI file stores it in a separate conductor track. MIDI and RIFF MIDI export write these maps back out alongside the original key-down durations and tempo map. Project files preserve the same information without MIDI's channel limits. Older project files default to 4/4 with no expression automation.

Bar labels, pages, loop positions and the metronome follow the time-signature map. BPM continues to mean quarter notes per minute; in 6/8, for example, the displayed beats and metronome clicks are eighth notes. The first beat of each bar is accented. MIDI metronome and thirty-second-note metadata are retained on export; monitoring clicks use the signature's denominator. A meter change starts a new bar, shortening an incomplete preceding bar when necessary.

Open **Editing options**, enter a numerator and beat unit, and choose **Set meter at current bar** to change the bar containing the playhead. Later imported changes stay at their original tick positions. In VR, **Meter** cycles through 4/4, 3/4, 6/8, 5/4 and 7/8 at that bar. Both controls support Undo; other imported meters also display and play normally.

Pedal values of 64 or more sustain released melodic notes until the next pedal-up event, or the project end if the pedal is never released. The drawn notes retain their key-down lengths. Bends affect sounding melodic notes with the standard ±2-semitone range, including when seeking into a held note or restarting a loop. Program changes select the sound of new notes; already-held voices retain their original patch. Playback and WAV export share these rules. Percussion uses the synthesized kit's natural decays.

MIDI export supports 15 independent melodic channels, with extra channels needed for simultaneous unisons; it reserves channel 10 for percussion. If an arrangement exceeds this limit, contains overlapping percussion unisons, or has conflicting expression maps on percussion parts sharing channel 10, export explains the restriction instead of merging channels. Save a project to retain the complete arrangement. Bank selection, custom pitch-bend ranges and other MIDI controllers are not interpreted; other note export formats retain their documented timing and expression limitations.

## Repeating a phrase

Open **Loop** beside the timeline. Drag in either direction across its ruler to select a region within the current view, snapped to the current meter's beats. Alternatively, enter start and end bars, choose **Loop view**, or select notes and choose **Loop selection**. End bars are exclusive: bars 2–4 repeat bars 2 and 3. Fractional bar values select part of a bar, even across meter changes. **Use whole song** removes the region, and **Enable loop** switches repetition on or off. Loop boundaries are saved with the project; loop enablement is a transport setting.

Notes crossing a loop edge are clipped to the region and retriggered on each pass. The audio clock preserves tempo changes inside the region. Empty regions can also loop for practice. Turn on **Metronome** for accented clicks and **One-bar count-in** for a lead-in matching the meter where playback begins. Pausing or stopping cancels pending clicks. Clicks and count-in are monitoring aids and are excluded from exported WAVs. Audio-file playback retains its whole-file loop controls.

The VR menu provides **Loop**, **Loop view**, **Loop selection**, **Click** and **Count-in** controls for MIDI editing.

## Interaction sounds

Desktop, touch, keyboard and XR controls use [Button Synth](https://github.com/designerzen/button-synth) for immediate procedural audio feedback. Buttons have separate press and release sounds; hover and keyboard focus use a quieter cue after the first engagement. Note edits, dragging, scratching, camera gestures, sliders, menus and file operations also provide feedback. Continuous motion produces rate-limited detents instead of a sound on every frame.

| Interaction | Sound choice |
| --- | --- |
| Selection and note editing | Dry mouse and keyboard clicks |
| Values, zoom, dragging and scratching | Short knob detents, pitched with slider position |
| Toggle on / off | Distinct guitar-switch latches |
| Grab / release | Unlock and camera-latch impacts |
| Create / erase | Pop and low switch impacts |
| Views, tracks and tools | Short selection blips |
| Play / pause / stop | Rising start, descending pause and back cues |
| Successful import or export / error | Confirmation chord / low error buzz |

Open **Editing options** for **Interaction sounds** and **Feedback level**. The XR menu has **UI sounds**, **UI quieter** and **UI louder**. Preferences are remembered on this device. Feedback has its own audio output, so it stays out of visualiser measurements and exported music; track mute and solo affect music independently. Autosave and other background updates are silent. Audio starts from user engagement, and unavailable audio never blocks editing. The pinned engine and its attribution are included with the app.

## Music files

Drop a file anywhere on the app, or choose **Open media or project** in the project menu. Musical files open as editable 3D notes; audio opens as a waveform.

| Files | Import | Export notes |
| --- | --- | --- |
| MIDI (`.mid`, `.midi`, `.kar`) and RIFF MIDI (`.rmi`, `.rmid`) | Yes | Yes |
| MusicXML and compressed MusicXML (`.musicxml`, `.xml`, `.mxl`) | Yes | Yes |
| DAWproject (`.dawproject`) | Yes | Yes |
| ABC, MIDI CSV, MML, RTTTL | Yes | Yes |
| Guitar Pro 3–8, Capella, alphaTex | Yes | Guitar Pro 7 and alphaTex |
| NoteSequence, Tone.js JSON, JAMS, UTAU, Sonic Visualiser | Yes | Yes |
| Synthesizer V, OpenUtau, UtaFormatix, LMMS (`.mmp`, `.mpt`, `.mmpz`) | Yes | Yes |
| Tracker modules, including MOD, XM, IT, S3M and MED | Notes only | No |
| LilyPond | No | Yes |
| ZIP containing exactly one MIDI file | Yes | No |

Choose a format under **Export notes** in the project menu and press **Export notes** to download it. **Save project** preserves the complete XR DAW session; **Export WAV** renders its sound.

MIDI, RIFF MIDI and XR DAW projects preserve tempo, time signatures, sustain, pitch bend and instrument programs. Other note imports retain performed timing on a 120 BPM, 4/4 grid. Other note exports use the first project tempo and begin at the first note; score formats may quantize rhythms. These exports support up to 15 melodic tracks. RTTTL requires a single melody. Tracker samples and effects, lyrics, plugin settings and score engraving do not become part of the XR DAW project. Musical containers are limited to 64 MB; MIDI files to 10 MB. Unsupported or invalid files leave the current project intact.

## Audio waveforms

Drop a MIDI, audio, or project file anywhere on the app, or choose **Open media or project** from the project menu. WAV/WAVE and other audio formats supported by your browser (such as MP3, Ogg, FLAC, and M4A) open in **Waveform** view, alongside your MIDI views.

Each audio channel forms a stack of circular cross-sections in 3D. Time runs along the stack, amplitude controls each circle's radius, and a windowed FFT colors each circle by its local spectral frequency. Long files use peak-preserving time buckets, with up to 8,192 circles across the channels.

Press anywhere on the waveform to play from that time. Hold and drag to scratch: moving left plays audio backward, moving right plays forward, and speed follows your movement. Release to continue normal playback from that point. Left and right arrow keys jump one second. Play, pause, stop, loop, gain, and mute also work on audio.

Audio stays in memory for the current session; MIDI project autosaves do not embed it. **Download audio** keeps the original file, and **Export WAV** saves the decoded audio as WAV. Audio imports support up to ten minutes, eight channels, and a 100 MB file size.

Enable **Vinyl** in the transport to hear the audio through [rauchg/vinyl](https://github.com/rauchg/vinyl)'s physical groove, stylus, cartridge, and phono simulation. Choose **Clean**, **Worn**, or **Damaged** in the editing menu to change the pressing and stylus condition. Your audio is cut into a simulated stereo record in a background worker; waveform scratching then controls its platter, including reverse motion and inertia. Disable Vinyl to return to the original audio. The VR menu provides the same Vinyl and condition controls.

With Vinyl enabled, **Export WAV** renders the selected vinyl condition; **Download audio** always keeps the original file. Multichannel audio is folded into a stereo groove for Vinyl playback. The engine source and MIT license are included under `apps/web/public/vendor/vinyl`.

MIDI playback and WAV export use audiobus's polyphonic FM synthesizer and the synthesized drum kit. MIDI formats 0 and 1 are supported, including multiple tracks and tempo changes. Bar labels follow the time-signature map. WAV export supports projects up to ten minutes long.

## Live output in 3D

Use the output selector beside **Notes** and **Velocity** to see the sound being played, including MIDI instruments, audio files and Vinyl processing. In VR, open **Menu** and press the output button to cycle modes. Switching modes keeps playback and the project intact; choose **Output off** to return to editing.

Dropping an audio file shows **Spectrum** alongside its waveform by default when no visualisers are selected. Open **Visualisers** beside **Waveform** to select one or several scopes; existing selections are kept when another audio file is loaded. Each selection adds a labelled 3D display to a grid above and behind the waveform. The waveform stays interactive for seeking and scratching while the scopes show the processed audio output. Untick a scope to remove it, or choose **Clear visualisers** to leave only the waveform. Every scope shares the same stereo analyser and audio-clock history. In VR, use the scope choice button to browse, **Add** / **Remove** to toggle that scope, and **Clear scopes** to remove the set; the existing output button still switches to a single view.

| Mode | Spatial data |
| --- | --- |
| **Spectrum** | X is logarithmic frequency from 20 Hz to 20 kHz (or the audio's Nyquist limit), Y is spectral level, and Z is recent time. Paired dots separate left and right channels. |
| **Rings** | Frequency wraps around each ring, spectral level changes its radius, and recent time stacks vertically. Left and right channels form separate nested traces. |
| **Stereo scope** | Left waveform samples control X, right samples control Y, and recent time runs along Z. Correlated stereo forms a diagonal; differences between the channels open it into shapes. |
| **Floor scope** | A waveform with a flat underside on the floor. Positive and negative excursions both become upward peaks using the greater of `abs(left)` and `abs(right)`, so opposite-phase stereo cannot cancel. X runs through the waveform window; depth shows recent history. |
| **FFT waterfall** | Columns map linear frequency from zero to Nyquist across X, spectral level to height, and recent time to depth. Useful for seeing the spacing of harmonics. |
| **Stereo frequency field** | Log frequency runs across X, spectral level controls Y, and the power balance of each band moves it between left and right along Z. Colour shows age. |
| **Pitch-class tower** | Twelve spokes run from C to B around a tower. Radius shows energy folded across octaves into each pitch class, and height shows time. This is a coarse spectral view, not a note detector. |
| **Spectral attacks** | Columns show positive changes in log-band dB level between analysis frames. Frequency runs across X and history along Z, separating attacks from sustained sound. |
| **Mid / side tunnel** | Side signal `(L − R) / 2` controls X, mid signal `(L + R) / 2` controls Y, and history runs along Z. Mono audio collapses to the centre; opposite-phase material spreads sideways. |
| **Delay phase space** | Mid amplitude now, mid amplitude 32 native samples earlier, and side amplitude occupy X, Y and Z. Colour shows age. Delay in seconds depends on the audio sample rate. |
| **Envelope terrain** | Each column retains the largest absolute sample in a section of the full FFT waveform window. X spans that window, height shows amplitude, and depth shows history. Transients survive the reduced display resolution. |
| **Stereo waveform ribbon** | Sample time runs along X; left and right amplitudes bend the trace in Y and Z. Older traces move deeper into the scene. |
| **Spectral trajectory** | A trail maps power-weighted spectral centroid to X, RMS amplitude to Y and spectral spread to Z. Size shows peak amplitude and colour shows age. |
| **Stereo dynamics trail** | Stereo correlation occupies X (−1 opposite phase, +1 in phase), RMS amplitude occupies Y, and time occupies Z. Size shows peak amplitude; colour shows crest factor from 0 to 24 dB. |
| **Aurora** | Glowing spectral curtains ripple and twist in depth, with band energy shaping their height and brightness. |
| **Spiral galaxy** | Two rotating stereo arms curl around a common centre. Frequency sets radius; spectral energy and RMS illuminate the particles. |
| **Neon knot** | A luminous torus knot rotates through space. The stereo waveform bends its intertwined strands. |
| **Kaleidoscope** | Waveform petals form rotating, mirrored flowers, with older layers extending into depth. |
| **Nebula** | A rotating particle shell breathes with RMS and spectral energy. |
| **Wave flight** | Connected stereo waveform traces stream from the distance toward and past the screen, fading as they age. This mode occupies the full stage, including alongside other selected scopes. The waveform remains available for scratching, and the camera stays under your control. |

Aurora, Spiral galaxy, Neon knot, Kaleidoscope and Nebula are artistic audio-reactive displays. Their rotation, symmetry and colour motion are decorative rather than calibrated measurements. They use additive glow and audio-clock animation, and fade away when the signal goes silent. Wave flight preserves each captured stereo trace while moving it through depth; it moves the geometry rather than the camera, including in VR.

The stereo analyser reads a 4096-sample FFT and waveform window at up to 30 frames per audio second, without spectral smoothing. Frequency resolution is sample rate / 4096 (about 11.7 Hz at 48 kHz). Spectral levels use a fixed −90 to −6 dB display range; waveform amplitudes remain on a fixed full-scale basis, preserving dynamics. Short scopes retain 128 consecutive native samples; the envelope and RMS measurements use the full window. Centroid and spread use linear spectral power, and stereo balance uses independent channel power.

The views retain up to 1.6 seconds of audio-clock history. Spectrum and ring colours show frequency; scope colours follow position within the waveform window unless stated otherwise above. Point size and brightness show signal level. Silence creates no new visible points. A steady mono signal can form a line or a stationary cluster: the axes show the measured signal rather than artificial motion. The desktop camera switches to 3D for these views; drag or touch to orbit and zoom, and move naturally around them in VR. Switching output off restores the previous desktop camera mode.

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

Install **Node.js 22.12 or later** and [pnpm](https://pnpm.io/installation), then clone the repository with its submodules:

```sh
git clone --recurse-submodules https://github.com/designerzen/xr-daw.git
cd xr-daw
pnpm install
pnpm run dev
```

Open `https://localhost:8081/`. The development server uses a self-signed HTTPS certificate; your browser may ask you to accept it.

The repository uses pnpm workspaces and Turborepo. The web application lives in `apps/web`, including its source, assets, spatial UI, and tests. The [netronome](https://github.com/designerzen/netronome) timing library and the [audiobus](https://github.com/designerzen/audiobus) audio engine are git submodules under `packages/`, linked into the app as workspace packages. Run commands from the repository root:

```sh
pnpm test                    # Run unit tests
pnpm run typecheck           # Check TypeScript
pnpm run build               # Type-check and build the app
pnpm run check               # Run tests, type checks, and the build
pnpm run serve               # Preview the production build
pnpm run format              # Format application code and tests
pnpm run upgrade:packages    # Move the submodules to their latest upstream commits
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
pnpm run build
```

Upload the contents of `apps/web/dist` to a static host. The build supports hosting under a project subpath.

For Cloudflare Pages, keep the root directory at the repository root and use `pnpm run build` as the build command. The root `wrangler.toml` sets the build output directory to `apps/web/dist`. If configuring the output directory in the dashboard, use `apps/web/dist` rather than `dist`.

GitHub Actions runs tests and builds the application when commits are pushed to `main`, then deploys the output to GitHub Pages. To use this in a fork, enable **GitHub Actions** as the Pages source in the repository settings.

## How it works

TypeScript and IWSDK manage the Three.js scene, spatial controls, and WebXR input. A shared musical project describes tracks, notes, and tempo changes. Both desktop and immersive controls edit that same project.

Web Audio schedules synthesis against the audio clock, independently of the scene's frame rate. Offline rendering turns the project into a WAV file, while IndexedDB stores the local autosave.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
