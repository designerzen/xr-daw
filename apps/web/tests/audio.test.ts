import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioEngine } from "../src/app/audio";
import { demoProject } from "../src/app/project";
import { ProjectInstrument } from "../src/app/instrument";

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
class AudioWorkletNode extends Node {
  static instances: AudioWorkletNode[] = [];
  closed = false;
  messages: {
    type: string;
    time?: number;
    note?: number;
    part?: number;
    velocity?: number;
  }[] = [];
  port = {
    postMessage: (message: AudioWorkletNode["messages"][number]) =>
      this.messages.push(message),
    close: () => {
      this.closed = true;
    },
  };
  constructor(_context: unknown, name: string) {
    super();
    // Exercise the worker-clock fallback independently of the FM instrument worklet.
    if (name !== "harmoneasy-fm")
      throw new Error("Clock worklet unavailable in test");
    AudioWorkletNode.instances.push(this);
  }
}
function notes() {
  return AudioWorkletNode.instances.flatMap((node) =>
    node.messages.filter((m) => m.type === "on"),
  );
}
const previousWorklet = globalThis.AudioWorkletNode;
test.beforeEach(() => {
  AudioWorkletNode.instances = [];
  globalThis.AudioWorkletNode =
    AudioWorkletNode as unknown as typeof globalThis.AudioWorkletNode;
});
test.afterEach(() => {
  globalThis.AudioWorkletNode = previousWorklet;
});
class Context {
  static instance: Context;
  currentTime = 0;
  state = "running";
  destination = new Node();
  nodes: Node[] = [];
  gains: Node[] = [];
  onstatechange?: () => void;
  audioWorklet = { addModule: async (_url: string) => {} };
  constructor() {
    Context.instance = this;
  }
  async resume() {}
  async close() {}
  createGain() {
    const node = new Node();
    this.gains.push(node);
    return node;
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
      notes().length,
      2,
      "both chord voices are scheduled before the first render frame",
    );
    assert.deepEqual(
      notes().map((n) => n.time),
      [0.04, 0.04],
    );
    context.currentTime = 0.45;
    Worker.instance.onmessage?.();
    assert.equal(notes().length, 3);
    assert.ok(Math.abs(notes()[2].time! - 0.54) < 1e-8);
    context.currentTime = 0.54;
    assert.ok(Math.abs(engine.positionTick - 480) < 1e-8);
    engine.pause();
    assert.ok(
      AudioWorkletNode.instances.every(
        (n) => n.messages.at(-1)?.type === "panic",
      ),
      "pause cancels future and active voices",
    );
    await engine.seek(project, 720);
    await engine.play(project);
    assert.equal(
      notes().length,
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
    assert.equal(notes().length, 0);
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
    assert.equal(notes().length, 2);
    assert.equal(
      notes()[1].time,
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

test("audiobus preserves overlapping unisons, MIDI velocity, track gain and muted tracks", async () => {
  const context = new Context();
  const instrument = new ProjectInstrument(
    context as unknown as AudioContext,
    context.destination as unknown as AudioNode,
  );
  const project = demoProject();
  project.tracks[0].gain = 0.5;
  project.tracks.push({ id: "muted", name: "Muted", gain: 1, muted: true });
  project.notes = Array.from({ length: 17 }, (_, i) => ({
    ...project.notes[0],
    id: `unison-${i}`,
    pitch: 60,
    velocity: 0.5,
    start: i,
    duration: 960,
  }));
  project.notes.push({
    ...project.notes[0],
    id: "muted-note",
    trackId: "muted",
    pitch: 72,
  });
  try {
    await instrument.prepare(project);
    instrument.scheduleProject(project);
    assert.equal(
      AudioWorkletNode.instances.length,
      2,
      "a second FM instance keeps the seventeenth overlapping unison independent",
    );
    assert.equal(notes().length, 17);
    assert.ok(
      notes().every((note) => note.note === 60 && note.velocity === 64 / 127),
    );
    assert.ok(
      context.gains.every((node) => node.gain.value === 0.2),
      "track gain reaches the output mixer",
    );
    const first = AudioWorkletNode.instances[0];
    assert.deepEqual(
      first.messages.filter((m) => m.type === "on").map((m) => m.part),
      Array.from({ length: 16 }, (_, i) => i),
    );
    const off = first.messages.filter((m) => m.type === "off");
    assert.equal(off.length, 16);
    assert.ok(off[0].time! > 1, "note-off is queued at its future audio time");
    instrument.silence();
    assert.ok(
      AudioWorkletNode.instances.every(
        (node) => node.messages.at(-1)?.type === "panic",
      ),
    );
    await instrument.prepare({ ...project, notes: [], tracks: [] });
    assert.equal(
      AudioWorkletNode.instances.every((node) => node.closed),
      true,
      "replacing the project releases unused outputs",
    );
  } finally {
    instrument.dispose();
  }
});

test("stop during audiobus worklet loading cannot start queued notes later", async () => {
  let ready!: () => void;
  const loading = new Promise<void>((resolve) => {
    ready = resolve;
  });
  class LoadingContext extends Context {
    audioWorklet = { addModule: () => loading };
  }
  const previousContext = globalThis.AudioContext;
  globalThis.AudioContext = LoadingContext as unknown as typeof AudioContext;
  const engine = new AudioEngine();
  try {
    const playing = engine.play(demoProject());
    await new Promise<void>((resolve) => setImmediate(resolve));
    engine.stop();
    ready();
    await playing;
    assert.equal(engine.playing, false);
    assert.equal(notes().length, 0);
  } finally {
    ready();
    engine.dispose();
    globalThis.AudioContext = previousContext;
  }
});

test("offline FM rendering schedules the same notes without resuming its context", async () => {
  class OfflineContext extends Context {
    state = "suspended";
    async resume(): Promise<void> {
      throw new Error("Offline rendering cannot resume before it starts");
    }
    async startRendering() {}
  }
  const context = new OfflineContext();
  const instrument = new ProjectInstrument(
    context as unknown as BaseAudioContext,
    context.destination as unknown as AudioNode,
  );
  const project = demoProject();
  project.notes = [project.notes[0]];
  try {
    await instrument.prepare(project);
    instrument.scheduleProject(project);
    const messages = AudioWorkletNode.instances[0].messages;
    assert.equal(
      messages.find((message) => message.type === "on")?.note,
      project.notes[0].pitch,
    );
    assert.equal(messages.find((message) => message.type === "on")?.time, 0);
    assert.ok(messages.find((message) => message.type === "off")!.time! > 0);
    assert.equal(
      messages.filter((message) => message.type === "patch").length,
      16,
    );
  } finally {
    instrument.dispose();
  }
});
