import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { writeMidi, type MidiData } from "midi-file";
import { compileNotes, encodeWav } from "../src/app/audio";
import { importMidi } from "../src/app/midi";
import {
  demoProject,
  ProjectStore,
  projectEnd,
  secondsToTick,
  snapTick,
  tickToSeconds,
  validateProject,
} from "../src/app/project";

test("tempo conversion integrates changes and inverts seconds without drift", () => {
  const project = demoProject();
  project.tempos = [
    { tick: 0, bpm: 120 },
    { tick: 960, bpm: 60 },
    { tick: 1920, bpm: 180 },
  ];
  assert.equal(tickToSeconds(project, 960), 1);
  assert.equal(tickToSeconds(project, 1920), 3);
  for (const tick of [0, 240, 959, 960, 1440, 1920, 3840, 100000]) {
    assert.ok(
      Math.abs(secondsToTick(project, tickToSeconds(project, tick)) - tick) <
        1e-8,
    );
  }
});

test("edits change musical state and undo/redo preserve all note fields", () => {
  const store = new ProjectStore();
  const original = structuredClone(store.project);
  store.select("note-0");
  store.updateNote("note-0", { pitch: 67, start: 120, duration: 480 });
  assert.equal(store.selected?.pitch, 67);
  assert.equal(store.selected?.start, 120);
  store.undo();
  assert.deepEqual(store.project, original);
  store.redo();
  assert.equal(store.selected?.duration, 480);
  store.undo();
  store.updateNote("note-0", { velocity: 0.3 });
  assert.equal(store.canRedo, false);
  const revision = store.revision;
  store.updateNote("note-0", { velocity: 0.3 });
  assert.equal(
    store.revision,
    revision,
    "unchanged drags must not create history entries",
  );
});

test("invalid edits and malformed project files never replace the valid project", () => {
  const store = new ProjectStore();
  const original = structuredClone(store.project);
  assert.throws(() => store.updateNote("note-0", { pitch: 128 }));
  assert.deepEqual(store.project, original);
  assert.throws(() => validateProject({ ...original, ppq: 0 }));
  assert.throws(() =>
    validateProject({ ...original, tempos: [{ tick: 10, bpm: 100 }] }),
  );
  assert.throws(() =>
    validateProject({
      ...original,
      notes: [original.notes[0], original.notes[0]],
    }),
  );
  assert.throws(() =>
    validateProject({
      ...original,
      notes: [{ ...original.notes[0], duration: Infinity }],
    }),
  );
});

test("MIDI type 1 keeps tracks simultaneous, tempo changes, overlaps, and zero-velocity note offs", () => {
  const fixture: MidiData = {
    header: { format: 1, numTracks: 3, ticksPerBeat: 480 },
    tracks: [
      [
        { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500000 },
        { deltaTime: 480, type: "setTempo", microsecondsPerBeat: 1000000 },
        { deltaTime: 0, type: "endOfTrack" },
      ],
      [
        { deltaTime: 0, type: "trackName", text: "Piano" },
        {
          deltaTime: 0,
          type: "noteOn",
          channel: 0,
          noteNumber: 60,
          velocity: 100,
        },
        {
          deltaTime: 120,
          type: "noteOn",
          channel: 0,
          noteNumber: 60,
          velocity: 80,
        },
        {
          deltaTime: 120,
          type: "noteOff",
          channel: 0,
          noteNumber: 60,
          velocity: 0,
        },
        {
          deltaTime: 240,
          type: "noteOn",
          channel: 0,
          noteNumber: 60,
          velocity: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
      [
        {
          deltaTime: 0,
          type: "noteOn",
          channel: 1,
          noteNumber: 67,
          velocity: 127,
        },
        {
          deltaTime: 960,
          type: "noteOff",
          channel: 1,
          noteNumber: 67,
          velocity: 0,
        },
        { deltaTime: 0, type: "endOfTrack" },
      ],
    ],
  };
  const project = importMidi(new Uint8Array(writeMidi(fixture)), "Fixture");
  assert.equal(project.tracks.length, 2);
  assert.equal(project.tracks[0].name, "Piano");
  assert.deepEqual(
    project.notes.map((n) => [n.start, n.duration]),
    [
      [0, 240],
      [120, 360],
      [0, 960],
    ],
  );
  const notes = compileNotes(project);
  assert.equal(notes.find((n) => n.note.pitch === 67)?.end, 1.5);
  assert.equal(notes.filter((n) => n.start === 0).length, 2);
});

test("all bundled MIDI presets import into valid projects", () => {
  const directory = new URL("../src/assets/midi/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) =>
    name.endsWith(".mid"),
  )) {
    const project = importMidi(
      readFileSync(new URL(encodeURIComponent(name), directory)),
      name,
    );
    assert.ok(project.notes.length > 0, name);
    assert.ok(projectEnd(project) >= project.notes.at(-1)!.start, name);
  }
});

test("sixteenth snapping clamps to zero and supports odd PPQ resolutions", () => {
  assert.equal(snapTick(-130, 480), 0);
  assert.equal(snapTick(179, 480), 120);
  assert.equal(snapTick(181, 480), 240);
  assert.equal(snapTick(31, 100), 25);
});

test("project save format round trips edits and tempo maps", () => {
  const store = new ProjectStore();
  store.updateNote("note-1", { duration: 720, velocity: 0.9 });
  assert.deepEqual(
    validateProject(JSON.parse(JSON.stringify(store.project))),
    store.project,
  );
});

test("WAV encoding writes interleaved PCM, sample rate, and clipped signed samples", async () => {
  const buffer = {
    numberOfChannels: 2,
    length: 2,
    sampleRate: 48000,
    getChannelData: (channel: number) =>
      new Float32Array(channel ? [-1, 0.5] : [1, 2]),
  } as AudioBuffer;
  const wav = await encodeWav(buffer).arrayBuffer();
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual(
    [44, 46, 48, 50].map((offset) => view.getInt16(offset, true)),
    [32767, -32768, 32767, 16383],
  );
});
