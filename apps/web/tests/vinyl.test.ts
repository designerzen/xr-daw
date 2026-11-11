import assert from "node:assert/strict";
import test from "node:test";

const upstream = (file: string) =>
  import(new URL(`../public/vendor/vinyl/${file}`, import.meta.url).href);

test("the real vinyl engine cuts audio, presses different conditions and reads grooves backward", async () => {
  const [
    { cut },
    { press },
    { Engine },
    { W33 },
    { seekEngine, engineTime, CONDITIONS },
  ] = await Promise.all([
    upstream("cut.js"),
    upstream("press.js"),
    upstream("engine.js"),
    upstream("geometry.js"),
    import(new URL("../public/audio/vinyl-controls.js", import.meta.url).href),
  ]);
  const sampleRate = 48000;
  const tone = Float32Array.from(
    { length: sampleRate / 4 },
    (_, i) => Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.25,
  );
  const master = cut([{ L: tone, R: tone }], sampleRate);
  const clean = press(
    {
      ...master,
      wallIn: master.wallIn.slice(),
      wallOut: master.wallOut.slice(),
    },
    CONDITIONS.clean,
    7,
  );
  const damaged = press(
    {
      ...master,
      wallIn: master.wallIn.slice(),
      wallOut: master.wallOut.slice(),
    },
    CONDITIONS.damaged,
    7,
  );
  assert.ok(
    clean.wallIn.some(
      (value: number, i: number) => value !== damaged.wallIn[i],
    ),
    "condition alters physical groove walls",
  );
  const engine = new Engine(sampleRate);
  engine.setRecord(clean);
  seekEngine(engine, 0.1);
  assert.ok(
    Math.abs(engineTime(engine) - 0.1) < 1e-6,
    "seeking accounts for the lathe lead-in",
  );
  const left = new Float32Array(128),
    right = new Float32Array(128);
  let energy = 0;
  for (let i = 0; i < 20; i++) {
    engine.process(left, right, 128);
    assert.ok(left.every(Number.isFinite));
    energy += left.reduce((sum, value) => sum + value * value, 0);
  }
  assert.ok(
    energy > 1e-8,
    "the physics engine produces audible program output",
  );
  const position = engineTime(engine);
  engine.setMotor(false);
  engine.wp = -W33;
  engine.platterHand(true);
  engine.platterMove(-0.2);
  for (let i = 0; i < 8; i++) engine.process(left, right, 128);
  assert.ok(engine.wp < 0, "platter spins backward");
  assert.ok(
    engineTime(engine) < position,
    "stylus reads backward through the program",
  );
});

test("prepared grooves preserve exact audio across seeks and reverse scratching without lazy computation", async () => {
  const [
    { cut },
    { press },
    { Engine },
    { W33 },
    controls,
    { prepareGrooves, installGrooves },
  ] = await Promise.all([
    upstream("cut.js"),
    upstream("press.js"),
    upstream("engine.js"),
    upstream("geometry.js"),
    import(new URL("../public/audio/vinyl-controls.js", import.meta.url).href),
    import(new URL("../public/audio/vinyl-grooves.js", import.meta.url).href),
  ]);
  const fs = 48000;
  const tone = Float32Array.from(
    { length: fs / 4 },
    (_, i) => Math.sin(i * 0.07) * 0.25,
  );
  const master = cut([{ L: tone, R: tone }], fs);
  for (const condition of ["clean", "worn", "damaged"]) {
    const record = press(
      {
        ...master,
        wallIn: master.wallIn.slice(),
        wallOut: master.wallOut.slice(),
      },
      controls.CONDITIONS[condition],
      7,
    );
    const grooves = prepareGrooves(record, condition);
    const original = new Engine(fs),
      prepared = new Engine(fs);
    original.setRecord(record);
    // Playback has no raw walls from which it could reconstruct a missing block.
    prepared.setRecord({ ...record, wallIn: undefined, wallOut: undefined });
    controls.setCondition(original, condition);
    controls.setCondition(prepared, condition);
    installGrooves(prepared, grooves);
    prepared.reader.compute = () => {
      throw new Error("Reconstruction on the audio thread");
    };
    const a = new Float32Array(128),
      b = new Float32Array(128);
    const c = new Float32Array(128),
      d = new Float32Array(128);
    for (const j of [-10, 2030, record.n * 2 - 30, record.n * 2 + 10]) {
      original.reader.fill(j, 128, a, b);
      prepared.reader.fill(j, 128, c, d);
      assert.deepEqual(c, a);
      assert.deepEqual(d, b);
    }
    for (const time of [0.1, 0.24, 0]) {
      for (const engine of [original, prepared])
        controls.seekEngine(engine, time);
      for (let i = 0; i < 24; i++) {
        if (i === 8)
          for (const engine of [original, prepared]) {
            engine.setMotor(false);
            engine.wp = -W33;
            engine.platterHand(true);
            engine.platterMove(-0.2);
          }
        if (i === 16)
          for (const engine of [original, prepared]) {
            engine.platterHand(false);
            engine.setMotor(true);
          }
        original.process(a, b, 128);
        prepared.process(c, d, 128);
        assert.deepEqual(c, a, `${condition} left output`);
        assert.deepEqual(d, b, `${condition} right output`);
      }
    }
  }
});

test("worker channel mixing preserves mono, stereo and every multichannel lane", async () => {
  const { mixChannels } = await import(
    new URL("../public/audio/vinyl-grooves.js", import.meta.url).href
  );
  const channels = [1, 2, 3, 4, 5].map((n) => Float32Array.of(n, -n));
  assert.deepEqual(mixChannels(channels.slice(0, 1)), {
    L: channels[0],
    R: channels[0],
  });
  assert.deepEqual(mixChannels(channels.slice(0, 2)), {
    L: channels[0],
    R: channels[1],
  });
  assert.deepEqual(mixChannels(channels), {
    L: Float32Array.of(3, -3),
    R: Float32Array.of(3, -3),
  });
  assert.deepEqual(
    channels[0],
    Float32Array.of(1, -1),
    "source PCM stays intact",
  );
});
