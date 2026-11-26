import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InteractionFeedback,
  FEEDBACK_CUES,
  actionCue,
} from "../src/app/interaction-feedback";
import {
  profiles,
  type Parameters,
  type Phase,
} from "../src/vendor/button-synth/synth";

class Synth {
  calls: { profile: string; phase: Phase; parameters: Partial<Parameters> }[] =
    [];
  muted = false;
  disposed = false;
  async trigger(
    profile: unknown,
    phase: Phase = "down",
    parameters: Partial<Parameters> = {},
  ) {
    this.calls.push({ profile: String(profile), phase, parameters });
  }
  setMuted(muted: boolean) {
    this.muted = muted;
  }
  async dispose() {
    this.disposed = true;
  }
}

test("wheel gestures before browser activation cannot queue an audio burst", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const activation = { hasBeenActive: false, isActive: false };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userActivation: activation },
  });
  const synth = new Synth();
  const feedback = new InteractionFeedback(synth);
  try {
    for (let i = 0; i < 20; i++) feedback.play("adjust");
    assert.equal(synth.calls.length, 0);
    activation.hasBeenActive = activation.isActive = true;
    feedback.play("press");
    assert.equal(synth.calls.length, 1);
  } finally {
    await feedback.dispose();
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("every interaction cue resolves to an upstream sound with distinct semantic choices", () => {
  const ids = new Set(profiles.map((profile) => profile.id));
  for (const cue of Object.values(FEEDBACK_CUES))
    assert.ok(ids.has(cue.profile), cue.profile);
  assert.notEqual(FEEDBACK_CUES.play.profile, FEEDBACK_CUES.pause.profile);
  assert.notEqual(FEEDBACK_CUES.on.profile, FEEDBACK_CUES.off.profile);
  assert.notEqual(FEEDBACK_CUES.grab.profile, FEEDBACK_CUES.drop.profile);
  assert.notEqual(FEEDBACK_CUES.success.profile, FEEDBACK_CUES.error.profile);
  assert.equal(actionCue("play", true), "pause");
  assert.equal(actionCue("track-solo", false), "on");
  assert.equal(actionCue("track-solo", true), "off");
  assert.equal(actionCue("delete"), "erase");
  assert.equal(actionCue("paste"), "create");
});

test("audio stays lazy until engagement, pairs press/release, and scales volume", async () => {
  const synth = new Synth();
  const feedback = new InteractionFeedback(synth);
  feedback.play("hover");
  feedback.play("success");
  feedback.play("error");
  assert.equal(
    synth.calls.length,
    0,
    "background events do not unlock feedback audio",
  );
  feedback.configure({ volume: 0.5 });
  feedback.play("press");
  feedback.play("press", "up");
  assert.equal(synth.calls.length, 2);
  assert.equal(synth.calls[0].parameters.volume, 0.35);
  assert.ok(
    synth.calls[1].parameters.volume! < synth.calls[0].parameters.volume!,
  );
  assert.equal(synth.calls[1].phase, "up");
  feedback.play("success");
  assert.equal(synth.calls.at(-1)?.profile, FEEDBACK_CUES.success.profile);
  await feedback.dispose();
  feedback.play("press");
  assert.equal(synth.calls.length, 3);
  assert.equal(synth.disposed, true);
});

test("muting silences all interaction categories and rapid detents are rate-limited", async () => {
  const synth = new Synth();
  const feedback = new InteractionFeedback(synth);
  feedback.configure({ muted: true });
  feedback.play("play");
  feedback.play("error");
  assert.equal(synth.calls.length, 0);
  assert.equal(synth.muted, true);
  feedback.configure({ muted: false });
  feedback.play("adjust", "down", 1);
  for (let i = 0; i < 100; i++) feedback.play("adjust", "down", i / 100);
  assert.equal(synth.calls.length, 1);
  assert.equal(synth.calls[0].parameters.pitch, 5);
  feedback.play("drop");
  assert.equal(
    synth.calls.length,
    2,
    "release remains distinct from throttled motion",
  );
  feedback.configure({ volume: 0 });
  feedback.play("press");
  assert.equal(synth.calls.length, 2);
  await feedback.dispose();
});

test("feedback preferences persist and malformed storage or denied audio cannot break editing", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const first = new InteractionFeedback(new Synth());
    first.configure({ volume: 0.42, muted: true });
    const next = new InteractionFeedback(new Synth());
    assert.equal(next.muted, true);
    assert.equal(next.volume, 0.42);
    values.set("xr-daw.interaction-sounds", "malformed");
    const denied = new Synth();
    denied.trigger = async () => {
      throw new Error("Audio unavailable");
    };
    const safe = new InteractionFeedback(denied);
    assert.equal(safe.volume, 0.7);
    assert.doesNotThrow(() => safe.play("press"));
    await Promise.resolve();
    await Promise.all([first.dispose(), next.dispose(), safe.dispose()]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
