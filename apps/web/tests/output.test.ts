import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frequencyBands,
  OUTPUT_BANDS,
  OUTPUT_SAMPLES,
  type OutputFrame,
  createOutputFrame,
  spectralFeatures,
  waveformFeatures,
  OUTPUT_FFT_SIZE,
} from "../src/app/output-analysis";
import {
  OutputHistory,
  OUTPUT_MODES,
  isVisualMode,
} from "../src/app/output-history";

const frame = (time: number): OutputFrame => ({
  ...createOutputFrame(time),
  time,
  left: new Float32Array(OUTPUT_BANDS).fill(0.6),
  right: new Float32Array(OUTPUT_BANDS).fill(0.3),
  leftWave: new Float32Array(OUTPUT_SAMPLES).fill(0.2),
  rightWave: new Float32Array(OUTPUT_SAMPLES).fill(-0.4),
});

test("wave flight advects unchanged stereo samples through the screen on the audio clock", () => {
  const h = new OutputHistory(),
    p = new Float32Array(6),
    f = frame(1);
  h.capture(f);
  h.point("flight", 0, 20, p, 1);
  const start = [...p];
  h.point("flight", 0, 20, p, 1.8);
  assert.ok(
    p[2] > start[2] + 9,
    "the same recorded trace moves toward the viewer",
  );
  assert.equal(p[0], start[0]);
  assert.equal(p[1], start[1]);
  assert.ok(p[3] < start[3], "older traces fade");
  assert.equal(
    h.frames,
    1,
    "animation does not create fake analysis snapshots",
  );
  h.point("flight", 0, 20, p, 2.61);
  assert.equal(
    p[3],
    0,
    "expired traces are removed after passing the viewing plane",
  );
});

test("artistic views animate reproducibly and respond to measured energy", () => {
  const h = new OutputHistory(),
    p = new Float32Array(6),
    f = frame(1);
  f.metrics[0] = 0.2;
  h.capture(f);
  for (const mode of Object.keys(
    OUTPUT_MODES,
  ) as (keyof typeof OUTPUT_MODES)[]) {
    if (!isVisualMode(mode) || mode === "flight") continue;
    h.point(mode, 0, 17, p, 1);
    const first = [...p];
    h.point(mode, 0, 17, p, 1);
    assert.deepEqual(
      [...p],
      first,
      `${mode} has no random frame-dependent jitter`,
    );
    h.point(mode, 0, 17, p, 1.2);
    assert.ok(
      p.slice(0, 3).some((value, i) => value !== first[i]),
      `${mode} flows between analysis snapshots`,
    );
    assert.ok([...p].every(Number.isFinite));
  }
});

test("FFT features identify pitch class, power balance, centroid and spread", () => {
  const l = new Float32Array(2048).fill(-Infinity),
    r = l.slice(),
    f = createOutputFrame();
  // A4 exactly on bin 40 at this sample rate.
  l[40] = -6;
  r[40] = -12;
  spectralFeatures(l, r, 45056, f);
  assert.equal(f.chroma.indexOf(Math.max(...f.chroma)), 9);
  assert.ok(Math.abs(f.metrics[2] * 22528 - 440) < 0.01);
  assert.ok(f.metrics[3] < 1e-6);
  const pan = f.balance.find((value) => value !== 0)!;
  assert.ok(
    Math.abs(pan - (10 ** -1.2 - 10 ** -0.6) / (10 ** -1.2 + 10 ** -0.6)) <
      1e-6,
  );
  r[400] = -6;
  spectralFeatures(l, r, 45056, f);
  assert.ok(f.metrics[2] * 22528 > 1000);
  assert.ok(f.metrics[3] > 0.01);
  l.fill(-Infinity);
  r.fill(-Infinity);
  spectralFeatures(l, r, 45056, f);
  for (const data of [f.linear, f.chroma, f.balance])
    assert.ok(data.every((value) => value === 0));
  assert.equal(f.metrics[2], 0);
  assert.equal(f.metrics[3], 0);
});

test("full-window waveform metrics retain polarity, correlation, peaks and native delay", () => {
  const l = Float32Array.from(
    { length: OUTPUT_FFT_SIZE },
    (_, i) => Math.sin((i * 2 * Math.PI) / 64) * 0.5,
  );
  const r = l.map((value) => -value),
    f = createOutputFrame();
  waveformFeatures(l, r, f);
  assert.ok(Math.abs(f.metrics[0] - 0.5 / Math.sqrt(2)) < 1e-6);
  assert.equal(f.metrics[1], 0.5);
  assert.equal(f.metrics[4], -1);
  assert.ok(f.envelope.every((value) => value === 0.5));
  assert.ok(
    f.delayed.every((value) => value === 0),
    "anti-phase stereo has zero mid",
  );
  waveformFeatures(l, l, f);
  assert.equal(f.metrics[4], 1);
  assert.equal(f.delayed[20], l[l.length - OUTPUT_SAMPLES + 20 - 32]);
  l.fill(0);
  waveformFeatures(l, l, f);
  assert.ok(f.metrics.every((value) => value === 0));
});

test("all modes produce finite bounded geometry and suppress silence and empty history", () => {
  const h = new OutputHistory(),
    p = new Float32Array(6),
    f = createOutputFrame(1);
  h.capture(f);
  for (const mode of Object.keys(OUTPUT_MODES)) {
    if (mode === "off") continue;
    for (let i = 0; i < OUTPUT_SAMPLES; i++) {
      h.point(mode as Exclude<keyof typeof OUTPUT_MODES, "off">, 0, i, p);
      assert.ok([...p].every(Number.isFinite), mode);
      assert.equal(p[3], 0, `${mode} silence`);
    }
  }
  f.balance.fill(1);
  f.left.fill(0.5);
  f.right.fill(0.5);
  f.metrics.set([0.25, 0.5, 0.2, 0.3, -1]);
  f.time = 1.1;
  h.capture(f);
  h.point("balance", 0, 20, p);
  assert.ok(p[2] > -2.1);
  h.point("centroid", 0, 0, p);
  assert.ok(Math.abs(p[0] - (-1.55 + 0.2 * 3.1)) < 1e-6);
  h.point("dynamics", 0, 0, p);
  assert.equal(p[0], -1.5);
});

test("logarithmic analyser bands retain known frequencies and silence", () => {
  const data = new Float32Array(1024).fill(-Infinity),
    result = new Float32Array(64);
  frequencyBands(data, 48000, result);
  assert.ok(result.every((value) => value === 0));
  data[Math.round((1000 / 24000) * data.length)] = -6;
  frequencyBands(data, 48000, result);
  const peak = result.indexOf(1);
  assert.ok(Math.abs(peak - (64 * Math.log(1000 / 20)) / Math.log(1000)) < 2);
});

test("spatial modes encode frequency, independent stereo, amplitude and elapsed audio time", () => {
  const history = new OutputHistory(),
    point = new Float32Array(6);
  history.capture(frame(1));
  history.capture(frame(1.1));
  history.point("spectrum", 0, 0, point);
  const left = [...point];
  history.point("spectrum", 0, 64, point);
  assert.ok(left[1] > point[1], "independent channel levels determine height");
  assert.notEqual(
    left[2],
    point[2],
    "stereo channels remain spatially separate",
  );
  history.point("spectrum", 0, 63, point);
  assert.ok(point[0] > left[0], "frequency occupies the horizontal axis");
  history.point("spectrum", 1, 0, point);
  assert.ok(
    Math.abs(point[2] - (-1.418 - (0.1 / 1.6) * 1.4)) < 1e-6,
    "history depth uses audio seconds",
  );
  history.point("rings", 0, 0, point);
  assert.ok(point[0] > 0);
  history.point("rings", 0, 16, point);
  assert.ok(point[2] > -2.1, "frequency wraps around a genuinely spatial ring");
  history.point("scope", 0, 7, point);
  assert.ok(Math.abs(point[0] - 0.3) < 1e-6);
  assert.ok(Math.abs(point[1] - 1.34) < 1e-6);
});

test("output history is bounded, throttled and resets when its audio clock changes", () => {
  const history = new OutputHistory(),
    point = new Float32Array(6);
  assert.equal(history.capture(frame(1)), true);
  assert.equal(history.capture(frame(1.001)), false);
  assert.equal(history.capture(frame(0)), true);
  assert.equal(history.frames, 1);
  for (let i = 1; i < 200; i++) history.capture(frame(i / 20));
  history.point("scope", 47, 127, point);
  assert.ok([...point].every(Number.isFinite));
  assert.equal(
    point[3],
    0,
    "low frame rates do not pile expired samples onto the rear plane",
  );
  history.clear();
  history.point("spectrum", 0, 0, point);
  assert.equal(point[3], 0, "empty history never draws invented sound");
});

test("floor scope folds both waveform polarities upward without stereo cancellation", () => {
  const history = new OutputHistory(),
    point = new Float32Array(6);
  const first = frame(1);
  first.leftWave.set([0.7, -0.7, 0, 0.2]);
  first.rightWave.set([-0.7, 0.7, 0, -0.5]);
  history.capture(first);
  const heights = [];
  for (let index = 0; index < 4; index++) {
    history.point("floor", 0, index, point);
    assert.ok(
      Math.abs(point[1] - 0.02) < 1e-6,
      "the underside remains on the floor",
    );
    heights.push(point[5]);
  }
  assert.ok(Math.abs(heights[0] - 0.7) < 1e-6);
  assert.equal(
    heights[0],
    heights[1],
    "equal positive and negative excursions produce equal upward peaks",
  );
  assert.equal(heights[2], 0);
  assert.equal(
    heights[3],
    0.5,
    "the stronger channel is retained rather than averaged away",
  );
  history.capture(frame(1.1));
  history.point("floor", 1, 0, point);
  assert.ok(
    point[2] < -1.4,
    "older folded waveforms extend across the floor in depth",
  );
});
