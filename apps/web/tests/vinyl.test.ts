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
