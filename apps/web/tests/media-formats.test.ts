import assert from "node:assert/strict";
import { test } from "node:test";
import {
  importMediaFile,
  exportNotes,
  NOTE_EXPORT_FORMATS,
} from "../src/app/media-formats";
import { demoProject, tickToSeconds } from "../src/app/project";

test("MIDI interchange preserves leading silence, tempo changes, tracks and velocities", async () => {
  const project = demoProject();
  project.tempos = [
    { tick: 0, bpm: 100 },
    { tick: 960, bpm: 150 },
  ];
  project.notes = project.notes
    .slice(0, 3)
    .map((note) => ({ ...note, start: note.start + 480 }));
  const blob = await exportNotes(project, "midi");
  const imported = await importMediaFile(new File([blob], "renamed.data"));
  assert.equal(imported.kind, "project");
  if (imported.kind !== "project") return;
  assert.deepEqual(imported.project.tempos, project.tempos);
  assert.equal(imported.project.tracks[0].name, project.tracks[0].name);
  assert.deepEqual(
    imported.project.notes.map((note) => [
      note.pitch,
      note.start,
      note.duration,
    ]),
    project.notes.map((note) => [note.pitch, note.start, note.duration]),
  );
  assert.ok(
    Math.abs(imported.project.notes[0].velocity - project.notes[0].velocity) <
      1 / 127,
  );
});

// The remaining converters use browser APIs or Vite's CommonJS interop and are
// exercised by browser-formats.mjs against the actual website.
for (const format of [
  "notesequence",
  "midi-csv",
  "mml",
  "rtttl",
  "abc",
] as const) {
  test(`${format} exports and reimports editable notes through audiobus`, async () => {
    const project = demoProject();
    project.tempos = [{ tick: 0, bpm: 120 }];
    project.notes = [
      { ...project.notes[0], start: 0, duration: 480, pitch: 60 },
      { ...project.notes[1], start: 480, duration: 480, pitch: 64 },
    ];
    const blob = await exportNotes(project, format);
    assert.ok(blob.size > 0);
    const extension = NOTE_EXPORT_FORMATS.find(([id]) => id === format)![2];
    const imported = await importMediaFile(
      new File([blob], `roundtrip.${extension}`),
    );
    assert.equal(imported.kind, "project");
    if (imported.kind !== "project") return;
    assert.deepEqual(
      imported.project.notes.map((note) => note.pitch),
      [60, 64],
    );
    assert.ok(
      Math.abs(
        tickToSeconds(imported.project, imported.project.notes[1].start) - 0.5,
      ) < 0.025,
    );
  });
}

test("MIDI export keeps nested unison releases independent", async () => {
  const project = demoProject();
  project.notes = [
    { ...project.notes[0], id: "long", pitch: 60, start: 0, duration: 960 },
    { ...project.notes[0], id: "short", pitch: 60, start: 240, duration: 120 },
  ];
  const blob = await exportNotes(project, "midi");
  const imported = await importMediaFile(new File([blob], "overlap.mid"));
  assert.equal(imported.kind, "project");
  if (imported.kind === "project")
    assert.deepEqual(
      imported.project.notes.map((note) => [note.start, note.duration]),
      [
        [0, 960],
        [240, 120],
      ],
    );
});

test("native projects and audio keep their existing routes; malformed files cannot become empty projects", async () => {
  const project = demoProject();
  const imported = await importMediaFile(
    new File([JSON.stringify(project)], "saved.json"),
  );
  assert.deepEqual(imported, { kind: "project", project });
  assert.deepEqual(
    await importMediaFile(new File(["RIFF1234WAVE"], "audio.wave")),
    { kind: "audio" },
  );
  await assert.rejects(
    importMediaFile(new File(["not music"], "broken.mid")),
    /MIDI.*header/,
  );
  await assert.rejects(
    importMediaFile(
      new File([JSON.stringify({ version: 99 })], "invalid.xrdaw.json"),
    ),
    /invalid/,
  );
  await assert.rejects(
    importMediaFile(new File(["{}"], "unknown.json")),
    /not.*supported|not a/i,
  );
});
