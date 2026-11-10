import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeWave,
  scratchRate,
  spectralFrequency,
  waveformTime,
} from "../src/app/spectrum";

test("FFT distinguishes low and high frequency tones in Hz", () => {
  for (const frequency of [220, 4000]) {
    const samples = Float32Array.from({ length: 4096 }, (_, i) =>
      Math.sin((2 * Math.PI * frequency * i) / 48000),
    );
    assert.ok(
      Math.abs(spectralFrequency(samples, 2048, 48000) - frequency) < 2,
    );
  }
  assert.equal(spectralFrequency(new Float32Array(2048), 1024, 48000), 0);
});

test("waveform buckets retain transients and independent stereo channels within a bounded circle count", () => {
  const left = new Float32Array(20000);
  const right = new Float32Array(20000);
  left[1234] = -0.9;
  right[1234] = 0.4;
  const analysis = analyzeWave([left, right], 48000);
  assert.equal(analysis.channels.length, 2);
  assert.equal(
    analysis.channels[0].amplitudes.length +
      analysis.channels[1].amplitudes.length,
    8192,
  );
  assert.ok(
    Math.abs(Math.max(...analysis.channels[0].amplitudes) - 0.9) < 1e-6,
  );
  assert.ok(
    Math.abs(Math.max(...analysis.channels[1].amplitudes) - 0.4) < 1e-6,
  );
  assert.equal(analysis.duration, 20000 / 48000);
});

test("waveform hit positions seek accurately and scratching retains direction", () => {
  assert.equal(waveformTime(-1.6, 10), 0);
  assert.equal(waveformTime(0, 10), 5);
  assert.equal(waveformTime(1.6, 10), 10);
  assert.equal(waveformTime(-9, 10), 0);
  assert.equal(waveformTime(9, 10), 10);
  assert.equal(scratchRate(5, 4.9, 0.1).toFixed(2), "-1.00");
  assert.equal(scratchRate(4, 4.1, 0.1).toFixed(2), "1.00");
  assert.equal(scratchRate(1, 9, 0), 4);
});
