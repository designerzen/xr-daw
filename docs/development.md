# Development and testing

The application workspace is `apps/web` (`@xr-daw/web`). Root pnpm commands use Turborepo to run its tasks, filtered to the app. `turbo.json` declares dependencies, environment variables, and cached outputs. The production build is `apps/web/dist`.

## Library packages

`packages/netronome` and `packages/audiobus` are git submodules of [designerzen/netronome](https://github.com/designerzen/netronome) and [designerzen/audiobus](https://github.com/designerzen/audiobus), pinned to a commit. `pnpm-workspace.yaml` makes them workspace packages; the app depends on both with `workspace:*`. Run `pnpm run upgrade:packages` to move both to their latest upstream commits, then commit the new submodule pointers. On Windows, run `git config --global core.longpaths true` before cloning, because some audiobus file paths exceed the default limit.

netronome ships its built `dist` in Git, so the app uses it as committed and Turbo does not rebuild it. Make changes in the netronome repository and rebuild there.

audiobus resolves its companion packages from GitHub and installs without dependency-removal overrides. The workspace permits the TypeScript build script for the pinned audiobus-protocol dependency. The app imports focused FM and command subpaths; bundling the entire root entry additionally requires `worker: { format: "es" }` for its AI worker. Run `pnpm --filter audiobus exec vitest run` to check the library separately from the app. Its Magenta and Basic Pitch dependencies currently produce a `seedrandom` peer-range warning through their different TensorFlow versions.

`pnpm-workspace.yaml` also hoists the packages that IWSDK's dev workspace (the Runtime / Editor bar) imports by bare name, which npm used to hoist on its own.

## Automated checks

Run `pnpm run check` from the repository root. Tests cover musical timing, MIDI import, edit history, transport scheduling, and WAV encoding.

Run a workspace command directly with `pnpm --filter @xr-daw/web run <script>`. Use `pnpm run build --force` to rebuild without reading the Turbo cache. Turborepo stores cached task results in `.turbo`; Vite output is cached as `dist/**` relative to the app workspace.

## Browser smoke test

Start the development server with local automation enabled. In PowerShell:

```powershell
$env:IWSDK_DEV_HEADLESS = 'true'
$env:IWSDK_DEV_ALLOW_BROWSER_AUTOMATION = 'true'
pnpm run dev
```

In another terminal, from the repository root:

```sh
pnpm run test:browser
pnpm run test:navigation
pnpm run test:camera
pnpm run test:scroll
pnpm run test:editing
pnpm run test:media
pnpm run test:formats
pnpm run test:vinyl
pnpm run test:xr
pnpm run test:ar
ppnpm run dev:status
ppnpm run dev:down
```

The desktop smoke test checks note dragging, editing, playback, project downloads, autosave, MIDI import, and WAV export. Artifacts are written to `apps/web/artifacts` and are ignored by Git.

The navigation test reaches the final section of a 24-bar fixture, follows playback across a page boundary, and exercises mouse orbit/pan/zoom and native touchscreen orbit/pan/pinch through Chromium's touch input.

The camera test loads a two-track song and checks that every camera mode fits the board between the overlaid controls, that clicking a note selects it in each parallel view, and that zoom and reset work.

The scroll test plays a 24-bar song in scroll mode and checks that the playhead stays centred while the notes move, that the scrubber follows and seeks, that off-screen notes cannot be picked, and that switching back lands on the playhead's page.

The editing test uses real mouse input to draw a note with the Draw tool (checking the hover preview and grid cell), build a selection with Ctrl-click, repeat it with Ctrl+D, clear it with a tap on empty space, erase a note, and undo.

The AR test enters an emulated passthrough session and checks that the studio backdrop and floor give way to the room and return on exit.

The media test generates stereo WAV audio with known frequencies, drops MIDI and WAV files, checks circle instances and FFT colors, seeks through real pointer events, and verifies that backward scratching plays reversed PCM. It also checks file chooser loading and failed-import recovery.

The formats test exports every note format, reimports the readable formats, drops them through the website's shared loading path, and checks pitch and timing. It also imports a generated ProTracker module through the real libopenmpt WASM and checks the export menu's download. Node tests cover the native MIDI tempo-map round trip and browser-independent converters.

The vinyl browser test enables the real AudioWorklet, checks program seeking and negative platter speed while dragging, changes pressing condition, and downloads the rendered vinyl WAV.

The XR entry check enters VR through the app button. For other SDK commands, run the CLI from the app workspace:

```sh
cd apps/web
npx @iwsdk/cli xr status
npx @iwsdk/cli ecs find --input-json '{"withComponents":["NoteView"]}'
```

An active emulated session is required to inspect controller poses and grabbing. Physical headset input, Bluetooth hardware, and audio latency require device testing.

## Audio and MIDI modules

`media-formats.ts` adapts audiobus's format detector, musical importers and note exporters to the app's `Project` model. Heavy notation and tracker engines load on demand. New formats return commands in seconds, converted to a fixed 120 BPM project axis; standard MIDI uses `midi.ts` to retain its tick-based tempo map. Export recordings pair notes with unique input identities so overlapping unisons keep their durations. The native MIDI writer preserves tracks, velocities, leading silence and tempo changes; audiobus interchange exporters normalize their origin to the first note and use one export tempo. XR DAW JSON bypasses generic music-JSON detection. Archive imports never load instrument code.

The active audio graph is in `apps/web/src/app/audio.ts`. A netronome `Timer` running on an AudioWorklet wakes its lookahead scheduler 24 times per beat; if that clock fails, a worker timer takes over. `instrument.ts` routes scheduled note-on/off commands with AudioContext timestamps to audiobus's FM output, with independent parts for overlapping unisons and per-track levels. Playback requires AudioWorklet support. `offline-instrument.ts` uses the same audiobus processor and piano patch for WAV export without the live output's context-resume step; the host starts its OfflineAudioContext after scheduling the project. Acoustic assets are under `apps/web/src/assets/audio/acoustics`.

Audio-file playback is in `clip-player.ts`; `spectrum.worker.ts` analyzes channel peaks and windowed FFT frequencies without blocking the scene. `waveform-system.ts` renders instanced rings and handles seeking/scratching through shared desktop/XR pointer events. Audio clips remain in memory, separate from the MIDI project save format.

`vinyl-playback.ts` adapts the pinned `rauchg/vinyl` modules in `apps/web/public/vendor/vinyl` (commit and license recorded there). The custom worklet and mastering worker under `public/audio` connect linear waveform coordinates to groove angle, seeking, physical platter controls, quality presets, and offline WAV rendering. Keep upstream modules unmodified and preserve their MIT attribution when updating them.

The audiobus submodule provides Bluetooth and MIDI device connections and reverb effects. The app currently uses its FM synthesizer for imported notes; hardware input routing and effect controls are not exposed in the app.
