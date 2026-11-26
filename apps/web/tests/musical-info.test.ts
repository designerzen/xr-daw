import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMidi, writeMidi, type MidiData, type MidiEvent } from "midi-file";
import { demoProject, projectEnd, validateProject } from "../src/app/project";
import {
  barAt,
  barPosition,
  beatTick,
  nextBeatTick,
  tickAtBar,
} from "../src/app/meter";
import { PerformanceMap } from "../src/app/performance";
import { importMidi, exportMidi } from "../src/app/midi";
import { Session } from "../src/app/session";
import { importMediaFile, exportNotes } from "../src/app/media-formats";

function midiFixture() {
  const entries: { tick: number; event: MidiEvent }[] = [
    { tick: 0, event: { type: "trackName", text: "Mixed", deltaTime: 0 } },
    {
      tick: 0,
      event: {
        type: "timeSignature",
        numerator: 3,
        denominator: 4,
        metronome: 24,
        thirtyseconds: 8,
        deltaTime: 0,
      },
    },
    {
      tick: 0,
      event: {
        type: "programChange",
        channel: 0,
        programNumber: 32,
        deltaTime: 0,
      },
    },
    {
      tick: 0,
      event: {
        type: "programChange",
        channel: 1,
        programNumber: 73,
        deltaTime: 0,
      },
    },
    {
      tick: 0,
      event: {
        type: "noteOn",
        channel: 0,
        noteNumber: 60,
        velocity: 100,
        deltaTime: 0,
      },
    },
    {
      tick: 0,
      event: {
        type: "noteOn",
        channel: 1,
        noteNumber: 67,
        velocity: 90,
        deltaTime: 0,
      },
    },
    {
      tick: 120,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 64,
        value: 100,
        deltaTime: 0,
      },
    },
    {
      tick: 120,
      event: { type: "pitchBend", channel: 1, value: -2048, deltaTime: 0 },
    },
    {
      tick: 180,
      event: { type: "pitchBend", channel: 0, value: 4096, deltaTime: 0 },
    },
    {
      tick: 240,
      event: {
        type: "noteOff",
        channel: 0,
        noteNumber: 60,
        velocity: 0,
        deltaTime: 0,
      },
    },
    {
      tick: 480,
      event: {
        type: "noteOff",
        channel: 1,
        noteNumber: 67,
        velocity: 0,
        deltaTime: 0,
      },
    },
    {
      tick: 480,
      event: {
        type: "programChange",
        channel: 0,
        programNumber: 80,
        deltaTime: 0,
      },
    },
    {
      tick: 480,
      event: {
        type: "noteOn",
        channel: 0,
        noteNumber: 64,
        velocity: 80,
        deltaTime: 0,
      },
    },
    {
      tick: 600,
      event: { type: "pitchBend", channel: 0, value: -4096, deltaTime: 0 },
    },
    {
      tick: 720,
      event: {
        type: "noteOff",
        channel: 0,
        noteNumber: 64,
        velocity: 0,
        deltaTime: 0,
      },
    },
    {
      tick: 960,
      event: {
        type: "controller",
        channel: 0,
        controllerType: 64,
        value: 0,
        deltaTime: 0,
      },
    },
    {
      tick: 1440,
      event: {
        type: "timeSignature",
        numerator: 6,
        denominator: 8,
        metronome: 36,
        thirtyseconds: 8,
        deltaTime: 0,
      },
    },
  ];
  let previous = 0;
  const track = entries.map(({ tick, event }) => {
    const next = { ...event, deltaTime: tick - previous };
    previous = tick;
    return next;
  });
  track.push({ type: "endOfTrack", deltaTime: 0 });
  return Uint8Array.from(
    writeMidi({
      header: { format: 0, ticksPerBeat: 480 },
      tracks: [track],
    } as MidiData),
  );
}

test("mixed-channel MIDI retains meter metadata, exact pedal/bend values and timed programs", async () => {
  let project = importMidi(midiFixture(), "Fidelity");
  assert.deepEqual(
    project.tracks.map((t) => [t.channel, t.program]),
    [
      [0, 32],
      [1, 73],
    ],
  );
  assert.equal(
    project.notes[0].duration,
    240,
    "pedal does not overwrite key duration",
  );
  assert.equal(project.sustain?.[0].value, 100);
  assert.deepEqual(
    project.pitchBends?.map((e) => e.value),
    [-2048, 4096, -4096],
  );
  assert.deepEqual(
    project.timeSignatures?.map((s) => [
      s.tick,
      s.numerator,
      s.denominator,
      s.metronome,
    ]),
    [
      [0, 3, 4, 24],
      [1440, 6, 8, 36],
    ],
  );
  const normalized = (p: typeof project) => ({
    signatures: p.timeSignatures,
    parts: p.tracks.map((track) => ({
      name: track.name,
      channel: track.channel,
      program: track.program,
      notes: p.notes
        .filter((n) => n.trackId === track.id)
        .map(({ id, trackId, ...n }) => n),
      sustain: p.sustain
        ?.filter((e) => e.trackId === track.id)
        .map(({ trackId, ...e }) => e),
      bends: p.pitchBends
        ?.filter((e) => e.trackId === track.id)
        .map(({ trackId, ...e }) => e),
      programs: p.programChanges
        ?.filter((e) => e.trackId === track.id)
        .map(({ trackId, ...e }) => e),
    })),
  });
  const original = normalized(project);
  for (let i = 0; i < 3; i++) {
    const bytes = new Uint8Array(await exportMidi(project).arrayBuffer());
    const midi = parseMidi(bytes);
    assert.ok(
      midi.tracks
        .flat()
        .some((e) => e.type === "controller" && e.controllerType === 64),
    );
    project = importMidi(bytes, "Round trip");
    assert.deepEqual(normalized(project), original);
  }
});

test("RIFF MIDI uses the same musical metadata path as standard MIDI", async () => {
  const project = importMidi(midiFixture(), "Wrapped");
  const blob = await exportNotes(project, "rmid");
  const result = await importMediaFile(
    new File([blob], "wrapped.rmi", { type: "audio/rmid" }),
  );
  assert.equal(result.kind, "project");
  if (result.kind !== "project") return;
  assert.deepEqual(result.project.timeSignatures, project.timeSignatures);
  assert.deepEqual(
    result.project.sustain?.map(({ tick, value }) => [tick, value]),
    project.sustain?.map(({ tick, value }) => [tick, value]),
  );
  assert.deepEqual(
    result.project.pitchBends?.map(({ tick, value }) => [tick, value]),
    project.pitchBends?.map(({ tick, value }) => [tick, value]),
  );
  assert.deepEqual(
    result.project.programChanges?.map(({ tick, program }) => [tick, program]),
    project.programChanges?.map(({ tick, program }) => [tick, program]),
  );
});

test("pedal, bend and program state are independent per imported channel and survive save/load", () => {
  const project = validateProject(
    JSON.parse(JSON.stringify(importMidi(midiFixture(), "State"))),
  );
  const map = new PerformanceMap(project);
  assert.equal(map.end(project.notes[0]), 960);
  assert.equal(map.end(project.notes[1]), 480);
  assert.equal(map.end(project.notes[2]), 960);
  const id = project.tracks[0].id;
  assert.equal(map.program(id, 0), 32);
  assert.equal(map.program(id, 700), 80);
  assert.deepEqual(
    map.pitch(id, 300, 900).map(({ tick, value }) => [tick, value]),
    [
      [300, 4096],
      [600, -4096],
    ],
  );
});

test("meter helpers count 3/4, 6/8 and 5/4 bars and denominator beats", () => {
  const project = demoProject();
  project.timeSignatures = [
    { tick: 0, numerator: 3, denominator: 4 },
    { tick: 2880, numerator: 6, denominator: 8 },
    { tick: 5760, numerator: 5, denominator: 4 },
  ];
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((bar) => tickAtBar(project, bar)),
    [0, 1440, 2880, 4320, 5760, 8160],
  );
  assert.equal(barAt(project, 3120).beat, 2);
  assert.equal(barAt(project, 3120).index, 2);
  assert.equal(beatTick(project, 3200), 3120);
  for (const tick of [0, 123, 2879, 2880, 3120, 5759, 5760, 10000])
    assert.ok(
      Math.abs(tickAtBar(project, barPosition(project, tick)) - tick) < 1e-7,
    );
  project.ppq = 32767;
  project.timeSignatures = [{ tick: 0, numerator: 4, denominator: 4 }];
  assert.equal(nextBeatTick(project, 32767), 65534);
  project.ppq = 480;
  project.timeSignatures = [
    { tick: 0, numerator: 4, denominator: 4 },
    { tick: 1000, numerator: 3, denominator: 8 },
  ];
  assert.equal(
    tickAtBar(project, 1),
    1000,
    "a mid-bar signature change starts a new bar",
  );
  assert.equal(tickAtBar(project, 0.5), 500);
  assert.equal(barAt(project, 1000).index, 1);
});

test("pages and loop selections use changing meters and meter edits are undoable", () => {
  const project = demoProject();
  project.timeSignatures = [
    { tick: 0, numerator: 3, denominator: 4 },
    { tick: 2880, numerator: 6, denominator: 8 },
    { tick: 5760, numerator: 5, denominator: 4 },
  ];
  project.notes = [{ ...project.notes[0], start: 20000, duration: 240 }];
  const session = new Session(project);
  try {
    assert.equal(session.pageSize, 5760);
    session.goToPage(1);
    assert.equal(session.pageTick, 5760);
    assert.equal(session.pageSize, 9600);
    session.page(1);
    assert.equal(session.pageTick, 15360);
    assert.equal(session.lastPageIndex, 2);
    assert.equal(projectEnd(project), 22560);
    session.setTimeSignature(7, 8, 0);
    assert.equal(session.store.project.timeSignatures?.[0].numerator, 7);
    session.store.undo();
    assert.equal(session.store.project.timeSignatures?.[0].numerator, 3);
    assert.throws(() => session.setTimeSignature(0, 3));
  } finally {
    session.dispose();
  }
});

test("expression and signature validation rejects malformed data while legacy projects retain 4/4", () => {
  const project = demoProject();
  assert.equal(barAt(project, 1920).index, 1);
  for (const timeSignatures of [
    [],
    [{ tick: 1, numerator: 3, denominator: 4 }],
    [{ tick: 0, numerator: 0, denominator: 4 }],
    [{ tick: 0, numerator: 3, denominator: 3 }],
  ])
    assert.throws(() => validateProject({ ...project, timeSignatures }));
  for (const sustain of [
    [null],
    [{ trackId: "missing", tick: 0, value: 0 }],
    [{ trackId: "track-1", tick: -1, value: 127 }],
    [{ trackId: "track-1", tick: 0, value: 128 }],
  ])
    assert.throws(() => validateProject({ ...project, sustain }));
  assert.throws(() =>
    validateProject({
      ...project,
      pitchBends: [{ trackId: "track-1", tick: 0, value: 8192 }],
    }),
  );
  assert.throws(() =>
    validateProject({
      ...project,
      programChanges: [{ trackId: "track-1", tick: 0, program: 128 }],
    }),
  );
});
