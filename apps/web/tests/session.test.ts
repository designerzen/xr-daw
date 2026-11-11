import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_TRACKS, Session } from "../src/app/session";
import { demoProject } from "../src/app/project";

test("the full song is reachable and manual navigation suspends playback following", () => {
  const project = demoProject();
  project.notes[0].start = 480 * 80;
  const session = new Session(project);
  session.goToPage(5);
  assert.equal(session.pageTick, 480 * 80);
  assert.equal(session.followPlayback, false);
  session.goToPage(999);
  assert.equal(session.pageTick, 480 * 80);
  session.goToPage(-1);
  assert.equal(session.pageTick, 0);
  session.audio.playing = true;
  Object.defineProperty(session.audio, "positionTick", { get: () => 480 * 36 });
  session.followPlayhead();
  assert.equal(session.pageTick, 0);
  session.toggleFollow();
  assert.equal(session.pageTick, 480 * 32);
  assert.equal(session.followPlayback, true);
  session.setViewSpan("song");
  assert.equal(session.pageTick, 0);
  assert.equal(session.pageSize, 480 * 84);
  session.dispose();
});

test("playback following is the default and returns whenever playback starts or stops", async () => {
  const session = new Session(demoProject());
  assert.equal(session.followPlayback, true);
  session.audio.play = async () => {
    session.audio.playing = true;
  };
  session.page(1);
  assert.equal(session.followPlayback, false);
  await session.togglePlay();
  assert.equal(session.followPlayback, true);
  session.page(1);
  assert.equal(session.followPlayback, false);
  session.stop();
  assert.equal(session.followPlayback, true);
  session.dispose();
});

test("view navigation preserves the project, selection, timeline and undo history", () => {
  const session = new Session(demoProject());
  const project = session.store.project;
  const id = project.notes[0].id;
  session.store.select(id);
  const revision = session.store.revision;
  let changes = 0;
  session.subscribe(() => changes++);
  session.setView("velocity");
  assert.equal(session.view, "velocity");
  session.setView("notes");
  assert.equal(session.view, "notes");
  assert.equal(changes, 2);
  assert.equal(session.store.project, project);
  assert.equal(session.store.selectedId, id);
  assert.equal(session.store.revision, revision);
  assert.equal(session.store.canUndo, false);
  assert.equal(session.pageTick, 0);
  session.dispose();
});

test("timeline pages stay on four-bar boundaries for a partial final page", () => {
  const project = demoProject();
  project.notes[0].start = 480 * 19;
  const session = new Session(project);
  session.page(1);
  assert.equal(session.pageTick, 480 * 16);
  session.page(1);
  assert.equal(session.pageTick, 480 * 16);
  session.page(-1);
  assert.equal(session.pageTick, 0);
  session.dispose();
});

test("note creation, nudge, resize, and deletion use the same undoable model", () => {
  const session = new Session(demoProject());
  session.addNote();
  const id = session.store.selectedId!;
  assert.equal(session.store.project.notes.length, 17);
  session.nudge(1, 2);
  session.resize(1);
  assert.equal(session.store.selected?.start, 120);
  assert.equal(session.store.selected?.duration, 600);
  session.deleteNote();
  assert.equal(session.store.project.notes.length, 16);
  session.store.undo();
  assert.ok(session.store.project.notes.some((n) => n.id === id));
  session.dispose();
});

test("every track is shown at once and the pitch axis covers the whole song", () => {
  const project = demoProject();
  project.tracks.push({ id: "bass", name: "Bass", gain: 0.7, muted: false });
  project.notes.push(
    {
      id: "low",
      trackId: "bass",
      pitch: 28,
      start: 480 * 40,
      duration: 480,
      velocity: 0.5,
    },
    {
      id: "high",
      trackId: "track-1",
      pitch: 96,
      start: 0,
      duration: 480,
      velocity: 0.5,
    },
  );
  const session = new Session(project);
  assert.equal(session.allTracks, true);
  assert.ok(session.basePitch <= 28);
  assert.ok(session.basePitch + session.pitchRows > 96);
  assert.equal(session.pitchRows % 12, 0);
  assert.ok(session.visibleNotes.some((n) => n.id === "high"));
  session.goToPage(10);
  assert.ok(session.visibleNotes.some((n) => n.id === "low"));
  session.store.select("low");
  assert.equal(session.trackId, "bass");
  assert.equal(session.allTracks, true);
  session.selectTrack("track-1");
  assert.equal(session.allTracks, false);
  assert.ok(session.visibleNotes.every((n) => n.trackId === "track-1"));
  assert.ok(session.basePitch > 28);
  session.selectTrack(ALL_TRACKS);
  assert.equal(session.allTracks, true);
  session.dispose();
});

test("scroll mode centres the playhead once it reaches the middle of the view", async () => {
  const project = demoProject();
  project.notes[0].start = 480 * 4 * 23;
  const session = new Session(project);
  let position = 0;
  Object.defineProperty(session.audio, "positionTick", { get: () => position });
  session.setTimeline("scroll");
  const view = session.pageSize;
  // Before the middle the view rests at the start, so the playhead walks in.
  position = view / 4;
  assert.equal(session.viewStart, 0);
  // Past the middle the view trails the playhead by half a view.
  position = view * 2.3;
  assert.equal(session.viewStart, position - view / 2);
  assert.ok(session.visibleNotes.every((n) => n.start < position + view / 2));
  // At the end the view stops so the song never scrolls off the board.
  position = 480 * 4 * 24 - 1;
  assert.equal(session.viewStart, 480 * 4 * 24 - view);
  session.followPlayhead();
  assert.equal(session.pageTick, 0, "page following is off while scrolling");
  // Returning to pages lands on the page holding the playhead.
  position = 480 * 4 * 9;
  session.setTimeline("pages");
  assert.equal(session.pageTick, 480 * 4 * 8);
  session.dispose();
});
