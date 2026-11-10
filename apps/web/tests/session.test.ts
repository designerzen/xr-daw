import assert from "node:assert/strict";
import { test } from "node:test";
import { Session } from "../src/app/session";
import { demoProject } from "../src/app/project";

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
