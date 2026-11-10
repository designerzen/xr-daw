import assert from "node:assert/strict";
import test from "node:test";
import { noteDepth } from "../src/app/note-depth";

test("audible MIDI velocities occupy proportional depths", () => {
  assert.equal(noteDepth(0.25), 0.2);
  assert.equal(noteDepth(0.5), 0.4);
  assert.equal(noteDepth(1), 0.8);
  assert.equal(noteDepth(1 / 127) * 127, noteDepth(1));
});

test("silent notes retain a selectable volume", () => {
  assert.ok(noteDepth(0) > 0);
  assert.ok(noteDepth(0) < noteDepth(1 / 127));
});
