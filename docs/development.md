# Development and testing

The application workspace is `apps/web` (`@xr-daw/web`). Root npm commands use Turborepo to run its tasks. `turbo.json` declares dependencies, environment variables, and cached outputs. The production build is `apps/web/dist`.

## Automated checks

Run `npm run check` from the repository root. Tests cover musical timing, MIDI import, edit history, transport scheduling, WAV encoding, and the standalone Bluetooth transport with mocked devices.

Run a workspace command directly with `npm run <script> --workspace @xr-daw/web`. Use `npm run build -- --force` to rebuild without reading the Turbo cache. Turborepo stores cached task results in `.turbo`; Vite output is cached as `dist/**` relative to the app workspace.

## Browser smoke test

Start the development server with local automation enabled. In PowerShell:

```powershell
$env:IWSDK_DEV_HEADLESS = 'true'
$env:IWSDK_DEV_ALLOW_BROWSER_AUTOMATION = 'true'
npm run dev
```

In another terminal, from the repository root:

```sh
npm run test:browser
npm run test:xr
npm run dev:status
npm run dev:down
```

The desktop smoke test checks note dragging, editing, playback, project downloads, autosave, MIDI import, and WAV export. Artifacts are written to `apps/web/artifacts` and are ignored by Git.

The XR entry check enters VR through the app button. For other SDK commands, run the CLI from the app workspace:

```sh
cd apps/web
npx @iwsdk/cli xr status
npx @iwsdk/cli ecs find --input-json '{"withComponents":["NoteView"]}'
```

An active emulated session is required to inspect controller poses and grabbing. Physical headset input, Bluetooth hardware, and audio latency require device testing.

## Audio and MIDI modules

The active audio graph is in `apps/web/src/app/audio.ts`. Supporting modules for synthesis, effects, WebMIDI, Electron, and Bluetooth are under `apps/web/src/audio`; acoustic assets are under `apps/web/src/assets/audio/acoustics`.

The Web Bluetooth connection exposes raw BLE-MIDI packets through `onPacket` and accepts already-framed packets through `writePacket`. It does not yet decode BLE-MIDI messages or route hardware into the sequencer. The app plays imported notes using its built-in synthesizer.
