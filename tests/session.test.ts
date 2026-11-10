import assert from "node:assert/strict";
import { test } from "node:test";
import { Session } from "../src/app/session";
import { demoProject } from "../src/app/project";

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
