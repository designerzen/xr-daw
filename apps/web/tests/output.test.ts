import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frequencyBands,
  OUTPUT_BANDS,
  OUTPUT_SAMPLES,
  type OutputFrame,
} from "../src/app/output-analysis";
import { OutputHistory } from "../src/app/output-history";

const frame = (time: number): OutputFrame => ({
  time,
  left: new Float32Array(OUTPUT_BANDS).fill(0.6),
  right: new Float32Array(OUTPUT_BANDS).fill(0.3),
  leftWave: new Float32Array(OUTPUT_SAMPLES).fill(0.2),
  rightWave: new Float32Array(OUTPUT_SAMPLES).fill(-0.4),
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
