import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioEngine } from "../src/app/audio";
import { demoProject } from "../src/app/project";

class Parameter {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
class Node {
  gain = new Parameter();
  frequency = new Parameter();
  threshold = new Parameter();
  ratio = new Parameter();
  type = "";
  started = -1;
  stopped = -1;
  onended?: () => void;
  connect(destination: Node) {
    return destination;
  }
  disconnect() {}
  addEventListener() {}
  start(at: number) {
    this.started = at;
  }
  stop(at = 0) {
    this.stopped = at;
  }
}
class Context {
  static instance: Context;
  currentTime = 0;
  state = "running";
  destination = new Node();
  nodes: Node[] = [];
  onstatechange?: () => void;
  constructor() {
    Context.instance = this;
  }
  async resume() {}
  async close() {}
  createGain() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createOscillator() {
    const node = new Node();
    this.nodes.push(node);
    return node;
  }
}
class Worker {
  static instance: Worker;
  onmessage?: () => void;
  constructor() {
    Worker.instance = this;
  }
  terminate() {}
}

test("lookahead schedules simultaneous voices in audio seconds, then pauses and seeks without hanging notes", async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorker = globalThis.Worker;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.Worker = Worker as unknown as typeof globalThis.Worker;
  const engine = new AudioEngine();
  try {
    const project = demoProject();
    project.tempos = [{ tick: 0, bpm: 120 }];
    project.notes = [
      { ...project.notes[0], start: 0, duration: 960 },
      { ...project.notes[1], start: 0, duration: 480 },
      { ...project.notes[2], start: 480, duration: 480 },
    ];
    await engine.play(project);
    const context = Context.instance;
    assert.equal(
      context.nodes.length,
      2,
      "both chord voices are scheduled before the first render frame",
    );
    assert.deepEqual(
      context.nodes.map((n) => n.started),
      [0.04, 0.04],
    );
    context.currentTime = 0.45;
    Worker.instance.onmessage?.();
    assert.equal(context.nodes.length, 3);
    assert.ok(Math.abs(context.nodes[2].started - 0.54) < 1e-8);
    context.currentTime = 0.54;
    assert.ok(Math.abs(engine.positionTick - 480) < 1e-8);
    engine.pause();
    assert.ok(
      context.nodes.every((n) => n.stopped === 0),
      "pause cancels future and active voices",
    );
    await engine.seek(project, 720);
    await engine.play(project);
    assert.equal(
      context.nodes.length,
      5,
      "seek resumes both sustained notes and omits the finished note",
    );
    engine.stop();
    assert.equal(engine.positionTick, 0);
    assert.equal(engine.playing, false);
  } finally {
    engine.dispose();
    globalThis.AudioContext = previousContext;
    globalThis.Worker = previousWorker;
  }
});

test("a pending asynchronous play is cancelled by stop", async () => {
  const previousContext = globalThis.AudioContext;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  const engine = new AudioEngine();
  try {
    const pending = engine.play(demoProject());
    engine.stop();
    await pending;
    assert.equal(engine.playing, false);
    assert.equal(Context.instance.nodes.length, 0);
  } finally {
    engine.dispose();
    globalThis.AudioContext = previousContext;
  }
});

test("looping schedules the next cycle before its boundary on the audio clock", async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorker = globalThis.Worker;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.Worker = Worker as unknown as typeof globalThis.Worker;
  const engine = new AudioEngine();
  try {
    const project = demoProject();
    project.tempos = [{ tick: 0, bpm: 120 }];
    project.notes = [{ ...project.notes[0], start: 0, duration: 120 }];
    engine.loop = true;
    await engine.play(project);
    const context = Context.instance;
    context.currentTime = 1.95;
    Worker.instance.onmessage?.();
    assert.equal(context.nodes.length, 2);
    assert.equal(
      context.nodes[1].started,
      2.04,
      "next loop is scheduled ahead rather than on a late worker tick",
    );
    context.currentTime = 2.29;
    assert.ok(Math.abs(engine.positionTick - 240) < 1e-8);
  } finally {
    engine.dispose();
    globalThis.AudioContext = previousContext;
    globalThis.Worker = previousWorker;
  }
});
