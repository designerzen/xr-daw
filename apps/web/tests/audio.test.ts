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
    value?: number;
    patch?: { program: number };
  }[] = [];
  port = {
    postMessage: (message: AudioWorkletNode["messages"][number]) =>
      this.messages.push(message),
    close: () => {
      this.closed = true;
    },
  };
  constructor(
    _context: unknown,
    name: string,
    options?: { processorOptions?: { events?: AudioWorkletNode["messages"] } },
  ) {
    super();
    // Exercise the worker-clock fallback independently of the FM instrument worklet.
    if (name !== "harmoneasy-fm")
      throw new Error("Clock worklet unavailable in test");
    AudioWorkletNode.instances.push(this);
    this.messages.push(...(options?.processorOptions?.events ?? []));
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
  sampleRate = 44100;
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
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource() {
    return this.createOscillator();
  }
  createBiquadFilter() {
    return new Node();
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

test("loop regions clip crossing notes, exclude outside notes and repeat across tempo changes", async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorker = globalThis.Worker;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.Worker = Worker as unknown as typeof globalThis.Worker;
  const engine = new AudioEngine();
  try {
    const project = demoProject();
    project.tempos = [
      { tick: 0, bpm: 120 },
      { tick: 960, bpm: 60 },
    ];
    project.loopRegion = { start: 480, end: 1440 };
    project.notes = [
      { ...project.notes[0], start: 0, duration: 960 },
      { ...project.notes[1], start: 960, duration: 960 },
      { ...project.notes[2], start: 1440, duration: 240 },
    ];
    engine.loop = true;
    await engine.play(project);
    assert.equal(engine.positionTick, 480);
    assert.equal(notes().length, 1);
    assert.ok(Math.abs(notes()[0].time! - 0.04) < 1e-8);
    Context.instance.currentTime = 0.45;
    Worker.instance.onmessage?.();
    assert.equal(notes().length, 2);
    const offs = AudioWorkletNode.instances.flatMap((n) =>
      n.messages.filter((m) => m.type === "off"),
    );
    assert.ok(
      Math.abs(offs[1].time! - 1.54) < 1e-8,
      "crossing note ends at the region boundary",
    );
    Context.instance.currentTime = 1.45;
    Worker.instance.onmessage?.();
    assert.equal(notes().length, 3);
    assert.ok(Math.abs(notes()[2].time! - 1.54) < 1e-8);
    Context.instance.currentTime = 1.79;
    assert.ok(Math.abs(engine.positionTick - 720) < 1e-8);
    assert.ok(notes().every((n) => n.note !== project.notes[2].pitch));
  } finally {
    engine.dispose();
    globalThis.AudioContext = previousContext;
    globalThis.Worker = previousWorker;
  }
});

test("metronome follows tempo changes, count-in delays notes, and pause cancels clicks", async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorker = globalThis.Worker;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.Worker = Worker as unknown as typeof globalThis.Worker;
  const engine = new AudioEngine();
  try {
    const project = demoProject();
    project.tempos = [
      { tick: 0, bpm: 120 },
      { tick: 480, bpm: 60 },
    ];
    engine.metronome = true;
    engine.countIn = true;
    await engine.play(project, 0, true);
    const context = Context.instance;
    assert.deepEqual(
      context.nodes.map((n) => n.started),
      [0.04, 0.54, 1.04, 1.54],
    );
    assert.equal(notes().length, 0);
    context.currentTime = 1;
    assert.equal(engine.positionTick, 0, "playhead waits through count-in");
    context.currentTime = 1.95;
    Worker.instance.onmessage?.();
    assert.equal(context.nodes[4].started, 2.04);
    assert.equal(notes()[0].time, 2.04);
    context.currentTime = 2.45;
    Worker.instance.onmessage?.();
    assert.equal(context.nodes[5].started, 2.54);
    context.currentTime = 3.45;
    Worker.instance.onmessage?.();
    assert.equal(
      context.nodes[6].started,
      3.54,
      "second beat interval reflects new tempo",
    );
    engine.pause();
    assert.ok(context.nodes.every((n) => n.stopped === 0));
  } finally {
    engine.dispose();
    globalThis.AudioContext = previousContext;
    globalThis.Worker = previousWorker;
  }
});

test("sustain, bend automation and timed programs agree in live and offline synthesis", async () => {
  class OfflineContext extends Context {
    async startRendering() {}
  }
  for (const context of [new Context(), new OfflineContext()]) {
    AudioWorkletNode.instances = [];
    const instrument = new ProjectInstrument(
      context as unknown as BaseAudioContext,
      context.destination as unknown as AudioNode,
    );
    const project = demoProject();
    project.tempos = [{ tick: 0, bpm: 120 }];
    project.tracks[0].program = 4;
    project.notes = [
      { ...project.notes[0], start: 0, duration: 240 },
      { ...project.notes[1], pitch: 60, start: 480, duration: 120 },
    ];
    project.sustain = [
      { trackId: "track-1", tick: 0, value: 127 },
      { trackId: "track-1", tick: 960, value: 0 },
    ];
    project.pitchBends = [
      { trackId: "track-1", tick: 0, value: 4096 },
      { trackId: "track-1", tick: 720, value: -8192 },
    ];
    project.programChanges = [{ trackId: "track-1", tick: 480, program: 32 }];
    try {
      await instrument.prepare(project);
      instrument.scheduleProject(project);
      const messages = AudioWorkletNode.instances.flatMap(
        (node) => node.messages,
      );
      const patches = new Map<number, number>();
      const programs: number[] = [];
      for (const message of messages) {
        if (message.type === "patch")
          patches.set(message.part!, message.patch!.program);
        if (message.type === "on")
          programs.push(message.patch?.program ?? patches.get(message.part!)!);
      }
      assert.deepEqual(
        programs,
        [4, 32],
        "program changes affect new notes, preserving the held voice's patch",
      );
      assert.deepEqual(
        messages.filter((m) => m.type === "off").map((m) => m.time),
        [1, 1],
        "pedal release controls sounding duration",
      );
      assert.deepEqual(
        messages.filter((m) => m.type === "on").map((m) => m.part),
        [0, 1],
        "pedal-held unisons retain independent note-offs",
      );
      assert.ok(
        messages.some(
          (m) => m.type === "bend" && m.time === 0.75 && m.value === -2,
        ),
      );
      assert.ok(
        messages.some(
          (m) => m.type === "bend" && m.time === 0.5 && m.value === 1,
        ),
      );
    } finally {
      instrument.dispose();
    }
  }
});

test("seek resumes pedal-held notes and loop boundaries restore their source pitch state", async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorker = globalThis.Worker;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.Worker = Worker as unknown as typeof globalThis.Worker;
  const engine = new AudioEngine();
  try {
    const project = demoProject();
    project.tempos = [{ tick: 0, bpm: 120 }];
    project.notes = [{ ...project.notes[0], start: 0, duration: 120 }];
    project.sustain = [
      { trackId: "track-1", tick: 0, value: 127 },
      { trackId: "track-1", tick: 960, value: 0 },
    ];
    project.pitchBends = [
      { trackId: "track-1", tick: 0, value: 4096 },
      { trackId: "track-1", tick: 720, value: -8192 },
    ];
    await engine.play(project, 720);
    assert.equal(
      notes().length,
      1,
      "a key released earlier is still sounding under the pedal",
    );
    let bends = AudioWorkletNode.instances
      .flatMap((n) => n.messages)
      .filter((m) => m.type === "bend");
    assert.ok(
      bends.some((m) => Math.abs(m.time! - 0.04) < 1e-8 && m.value === -2),
    );
    engine.stop();
    project.loopRegion = { start: 480, end: 960 };
    engine.loop = true;
    await engine.play(project, 480);
    Context.instance.currentTime = 0.45;
    Worker.instance.onmessage?.();
    bends = AudioWorkletNode.instances
      .flatMap((n) => n.messages)
      .filter((m) => m.type === "bend");
    assert.ok(
      bends.some((m) => Math.abs(m.time! - 0.54) < 1e-8 && m.value === 1),
      "each loop restores the bend at the region's start",
    );
  } finally {
    engine.dispose();
    globalThis.AudioContext = previousContext;
    globalThis.Worker = previousWorker;
  }
});

test("count-in and metronome follow numerator and denominator instead of fixed four-beat bars", async () => {
  const previousContext = globalThis.AudioContext;
  const previousWorker = globalThis.Worker;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.Worker = Worker as unknown as typeof globalThis.Worker;
  try {
    for (const [numerator, denominator] of [
      [3, 4],
      [6, 8],
    ]) {
      AudioWorkletNode.instances = [];
      const engine = new AudioEngine();
      try {
        const project = demoProject();
        project.tempos = [{ tick: 0, bpm: 120 }];
        project.timeSignatures = [{ tick: 0, numerator, denominator }];
        engine.metronome = engine.countIn = true;
        await engine.play(project, 0, true);
        const beatSeconds = (0.5 * 4) / denominator;
        const context = Context.instance;
        assert.equal(context.nodes.length, numerator);
        assert.ok(
          Math.abs(context.nodes[1].started - (0.04 + beatSeconds)) < 1e-8,
        );
        assert.equal(
          notes().length,
          0,
          "music waits for the meter-sized count-in",
        );
        context.currentTime = numerator * beatSeconds - 0.05;
        Worker.instance.onmessage?.();
        assert.ok(
          Math.abs(
            context.nodes.at(-1)!.started - (0.04 + numerator * beatSeconds),
          ) < 1e-8,
        );
        assert.equal(context.nodes.at(-1)!.frequency.value, 1500);
      } finally {
        engine.dispose();
      }
    }
  } finally {
    globalThis.AudioContext = previousContext;
    globalThis.Worker = previousWorker;
  }
});

test("saved presets and solo are applied in both live and offline instruments", async () => {
  class OfflineContext extends Context {
    async startRendering() {}
  }
  for (const context of [new Context(), new OfflineContext()]) {
    AudioWorkletNode.instances = [];
    const instrument = new ProjectInstrument(
      context as unknown as BaseAudioContext,
      context.destination as unknown as AudioNode,
    );
    try {
      const project = demoProject();
      project.tracks[0].program = 32;
      project.tracks[0].solo = true;
      project.tracks.push({
        id: "other",
        name: "Other",
        gain: 1,
        muted: false,
      });
      project.notes = [
        project.notes[0],
        { ...project.notes[1], trackId: "other" },
      ];
      await instrument.prepare(project);
      instrument.scheduleProject(project);
      assert.equal(notes().length, 1);
      const patch = AudioWorkletNode.instances
        .flatMap((node) => node.messages)
        .find((m) => (m as any).patch) as any;
      assert.equal(patch.patch.program, 32);
    } finally {
      instrument.dispose();
    }
  }
});

test("drum tracks synthesize a kit for playback and export, and release scheduled sources", async () => {
  class OfflineContext extends Context {
    async startRendering() {}
  }
  for (const context of [new Context(), new OfflineContext()]) {
    AudioWorkletNode.instances = [];
    const instrument = new ProjectInstrument(
      context as unknown as BaseAudioContext,
      context.destination as unknown as AudioNode,
    );
    try {
      const project = demoProject();
      project.tracks[0].drums = true;
      project.notes = [36, 38, 42, 46, 49, 45].map((pitch, i) => ({
        ...project.notes[i],
        pitch,
      }));
      await instrument.prepare(project);
      instrument.scheduleProject(project);
      assert.equal(AudioWorkletNode.instances.length, 0);
      assert.equal(context.nodes.length, 6);
      assert.ok(
        context.nodes.every((n) => n.started >= 0 && n.stopped > n.started),
      );
      assert.equal(context.nodes[0].type, "sine");
      instrument.silence();
      assert.ok(context.nodes.every((n) => n.stopped === 0));
    } finally {
      instrument.dispose();
    }
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
    assert.ok(
      (
        messages.find((message) => message.type === "on") as unknown as {
          patch: unknown;
        }
      ).patch,
      "the patch and note queue are supplied at worklet construction",
    );
  } finally {
    instrument.dispose();
  }
});
