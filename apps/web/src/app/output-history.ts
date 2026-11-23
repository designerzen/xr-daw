import {
  OUTPUT_BANDS,
  OUTPUT_SAMPLES,
  OUTPUT_METRICS,
  type OutputFrame,
} from "./output-analysis";

export const OUTPUT_MODES = {
  off: { label: "Output off", axes: "" },
  spectrum: {
    label: "Spectrum",
    axes: "X: log frequency · Y: level · Z: history · paired dots: L/R",
  },
  rings: {
    label: "Rings",
    axes: "Angle: log frequency · Radius: level + L/R · Height: history",
  },
  scope: {
    label: "Stereo scope",
    axes: "X: left waveform · Y: right waveform · Z: history",
  },
  floor: {
    label: "Floor scope",
    axes: "X: waveform time · Height: folded amplitude · Depth: history",
  },
  waterfall: {
    label: "FFT waterfall",
    axes: "X: linear frequency to Nyquist · Height: dB level · Depth: history",
  },
  balance: {
    label: "Stereo frequency field",
    axes: "X: log frequency · Y: level · Z: power balance L → R · Colour: age",
  },
  chroma: {
    label: "Pitch-class tower",
    axes: "Angle: C → B · Radius: pitch-class energy · Height: history (not pitch detection)",
  },
  flux: {
    label: "Spectral attacks",
    axes: "X: log frequency · Height: positive dB change / analysis frame · Depth: history",
  },
  midside: {
    label: "Mid / side tunnel",
    axes: "X: (L − R) / 2 · Y: (L + R) / 2 · Z: history",
  },
  delay: {
    label: "Delay phase space",
    axes: "X: mid now · Y: mid 32 samples ago · Z: (L − R) / 2 · Colour: age",
  },
  envelope: {
    label: "Envelope terrain",
    axes: "X: full FFT waveform window · Height: peak amplitude per bin · Depth: history",
  },
  ribbon: {
    label: "Stereo waveform ribbon",
    axes: "X: sample time · Y: left amplitude · Z: right amplitude + history",
  },
  centroid: {
    label: "Spectral trajectory",
    axes: "X: centroid / Nyquist · Y: RMS · Z: spread / Nyquist · Colour: age · Size: peak",
  },
  dynamics: {
    label: "Stereo dynamics trail",
    axes: "X: correlation −1 → +1 · Y: RMS · Z: history · Size: peak · Colour: crest factor",
  },
  aurora: {
    label: "Aurora",
    axes: "Visual: flowing spectral curtains · Height and glow follow band energy",
  },
  galaxy: {
    label: "Spiral galaxy",
    axes: "Visual: rotating stereo spiral arms · Frequency sets radius · Energy sets glow",
  },
  knot: {
    label: "Neon knot",
    axes: "Visual: orbiting torus knot · Waveform bends the strands · Energy sets glow",
  },
  kaleidoscope: {
    label: "Kaleidoscope",
    axes: "Visual: mirrored waveform petals · Spectrum colours · History forms layered flowers",
  },
  nebula: {
    label: "Nebula",
    axes: "Visual: breathing particle shell · Spectral energy expands the surface",
  },
  flight: {
    label: "Wave flight",
    axes: "Travelling stereo waveforms · New traces start far away and fly through the screen",
  },
} as const;
export type OutputMode = keyof typeof OUTPUT_MODES;
export const HISTORY_ROWS = 48;
export const POINTS_PER_ROW = OUTPUT_SAMPLES;

/** Ring storage sampled in audio seconds, independent of headset/render frame rate. */
export class OutputHistory {
  private levels = new Float32Array(HISTORY_ROWS * POINTS_PER_ROW);
  private leftWave = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private rightWave = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private linear = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private balance = new Float32Array(HISTORY_ROWS * OUTPUT_BANDS);
  private chroma = new Float32Array(HISTORY_ROWS * 12);
  private flux = new Float32Array(HISTORY_ROWS * OUTPUT_BANDS);
  private envelope = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private delayed = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private metrics = new Float32Array(HISTORY_ROWS * OUTPUT_METRICS);
  private glow = new Float32Array(HISTORY_ROWS);
  private head = -1;
  private timestamps = new Float64Array(HISTORY_ROWS);
  private lastTime = -Infinity;
  frames = 0;

  clear() {
    this.levels.fill(0);
    this.leftWave.fill(0);
    this.rightWave.fill(0);
    this.linear.fill(0);
    this.balance.fill(0);
    this.chroma.fill(0);
    this.flux.fill(0);
    this.envelope.fill(0);
    this.delayed.fill(0);
    this.metrics.fill(0);
    this.glow.fill(0);
    this.head = -1;
    this.lastTime = -Infinity;
    this.frames = 0;
  }

  capture(frame: OutputFrame) {
    if (frame.time < this.lastTime) this.clear();
    if (
      frame.time === this.lastTime ||
      frame.time - this.lastTime < 1 / 30 - 1e-6
    )
      return false;
    if (frame.time - this.lastTime > 0.25) this.clear();
    this.lastTime = frame.time;
    this.head = (this.head + 1) % HISTORY_ROWS;
    this.timestamps[this.head] = frame.time;
    this.levels.set(frame.left, this.head * POINTS_PER_ROW);
    this.levels.set(frame.right, this.head * POINTS_PER_ROW + OUTPUT_BANDS);
    this.leftWave.set(frame.leftWave, this.head * OUTPUT_SAMPLES);
    this.rightWave.set(frame.rightWave, this.head * OUTPUT_SAMPLES);
    this.linear.set(frame.linear, this.head * OUTPUT_SAMPLES);
    this.balance.set(frame.balance, this.head * OUTPUT_BANDS);
    this.chroma.set(frame.chroma, this.head * 12);
    this.flux.set(frame.flux, this.head * OUTPUT_BANDS);
    this.envelope.set(frame.envelope, this.head * OUTPUT_SAMPLES);
    this.delayed.set(frame.delayed, this.head * OUTPUT_SAMPLES);
    this.metrics.set(frame.metrics, this.head * OUTPUT_METRICS);
    this.glow[this.head] = Math.min(
      1,
      Math.log10(1 + frame.metrics[0] * 100) / 2,
    );
    this.frames++;
    return true;
  }

  /** Reuses the caller's output to avoid per-point allocations in XR. */
  point(
    mode: Exclude<OutputMode, "off">,
    age: number,
    index: number,
    out: Float32Array,
    now = this.lastTime,
  ) {
    const row = (this.head - age + HISTORY_ROWS) % HISTORY_ROWS;
    const elapsed = Math.max(0, now - this.timestamps[row]);
    const time = Math.min(1, elapsed / (HISTORY_ROWS / 30));
    const band = index % OUTPUT_BANDS,
      channel = Math.floor(index / OUTPUT_BANDS);
    const level = this.levels[row * POINTS_PER_ROW + index];
    const frequency = band / (OUTPUT_BANDS - 1);
    out[3] = level < 0.025 ? 0 : 0.006 + level * 0.014;
    out[4] = frequency * 0.75;
    out[5] = level;
    if (mode === "spectrum") {
      out[0] = -1.55 + frequency * 3.1;
      out[1] = 0.95 + level * 1.15;
      out[2] = -1.4 - time * 1.4 + (channel ? 0.018 : -0.018);
    } else if (mode === "rings") {
      const angle = frequency * Math.PI * 2;
      const radius = 0.2 + level * 0.8 + channel * 0.06;
      out[0] = Math.cos(angle) * radius;
      out[1] = 0.95 + time * 1.3;
      out[2] = -2.1 + Math.sin(angle) * radius;
    } else if (mode === "floor") {
      // Full-wave rectification: either polarity rises from the same flat floor.
      // Taking the stronger channel also keeps opposite-phase stereo from cancelling.
      const amplitude = Math.min(
        1,
        Math.max(
          Math.abs(this.leftWave[row * OUTPUT_SAMPLES + index]),
          Math.abs(this.rightWave[row * OUTPUT_SAMPLES + index]),
        ),
      );
      out[0] = -1.55 + (index / (OUTPUT_SAMPLES - 1)) * 3.1;
      out[1] = 0.02;
      out[2] = -1.4 - time * 1.4;
      out[3] = amplitude < 0.001 ? 0 : 1;
      out[4] = (index / (OUTPUT_SAMPLES - 1)) * 0.75;
      out[5] = amplitude;
    } else if (mode === "scope") {
      const left = this.leftWave[row * OUTPUT_SAMPLES + index];
      const right = this.rightWave[row * OUTPUT_SAMPLES + index];
      const energy = Math.min(1, Math.hypot(left, right));
      out[0] = Math.max(-1, Math.min(1, left)) * 1.5;
      out[1] = 1.6 + Math.max(-1, Math.min(1, right)) * 0.65;
      out[2] = -1.4 - time * 1.4 - (index / OUTPUT_SAMPLES) * 0.02;
      out[3] = energy < 0.001 ? 0 : 0.005 + energy * 0.012;
      out[4] = (index / OUTPUT_SAMPLES) * 0.75;
      out[5] = energy;
    } else {
      const offset = row * OUTPUT_SAMPLES + index;
      const l = this.leftWave[offset],
        r = this.rightWave[offset];
      const mid = (l + r) / 2,
        side = (l - r) / 2;
      const m = row * OUTPUT_METRICS;
      let strength = Math.min(1, Math.hypot(l, r));
      out[0] = -1.55 + (index / (OUTPUT_SAMPLES - 1)) * 3.1;
      out[1] = 0.95;
      out[2] = -1.4 - time * 1.4;
      if (isVisualMode(mode)) {
        // These are deliberately artistic mappings, rather than calibrated charts.
        const phase = now * 0.35,
          u = index / OUTPUT_SAMPLES;
        const energy = Math.max(
          this.levels[row * POINTS_PER_ROW + band],
          this.levels[row * POINTS_PER_ROW + band + OUTPUT_BANDS],
        );
        strength = Math.max(energy * 0.7, this.glow[row]);
        out[4] = (u * 0.8 + time * 0.3 + phase * 0.08) % 1;
        if (mode === "aurora") {
          const sweep = frequency * Math.PI * 2 + phase + time * 2;
          out[0] = -1.5 + frequency * 3;
          out[1] = 1 + energy * (0.5 + 0.5 * Math.sin(sweep)) + channel * 0.12;
          out[2] = -2.1 + Math.cos(sweep) * 0.35 - time * 0.7;
        } else if (mode === "galaxy") {
          const angle =
            frequency * Math.PI * 5 + phase + channel * Math.PI + time;
          const radius = 0.08 + frequency * 1.25 + energy * 0.15;
          out[0] = Math.cos(angle) * radius;
          out[1] = 1.6 + Math.sin(angle) * radius * 0.48;
          out[2] = -2.1 + (energy - 0.5) * 0.5 + (time - 0.5) * 0.8;
        } else if (mode === "knot") {
          const angle = u * Math.PI * 2,
            spin = phase + time * 0.5;
          const radius = 0.75 + 0.28 * Math.cos(3 * angle) + mid * 0.3;
          out[0] = Math.cos(2 * angle + spin) * radius;
          out[1] = 1.6 + Math.sin(3 * angle + spin) * (0.42 + side * 0.2);
          out[2] = -2.1 + Math.sin(2 * angle + spin) * radius * 0.65;
        } else if (mode === "kaleidoscope") {
          const angle = u * Math.PI * 2 + phase * 0.25;
          const radius =
            0.2 +
            Math.abs(Math.sin(u * Math.PI * 12)) * (0.65 + Math.abs(mid) * 0.5);
          out[0] = Math.cos(angle) * radius;
          out[1] = 1.6 + Math.sin(angle) * radius * 0.65;
          out[2] = -1.4 - time * 1.4 + side * 0.25;
        } else if (mode === "nebula") {
          const latitude = 1 - (2 * (index + 0.5)) / OUTPUT_SAMPLES;
          const angle =
            index * Math.PI * (3 - Math.sqrt(5)) + phase + time * 0.6;
          const radius = 0.5 + energy * 0.6 + this.metrics[m] * 0.3;
          const ring = Math.sqrt(1 - latitude * latitude);
          out[0] = Math.cos(angle) * ring * radius;
          out[1] = 1.6 + latitude * radius * 0.65;
          out[2] = -2.1 + Math.sin(angle) * ring * radius;
        } else {
          // A real stereo waveform, advected toward and past the viewing plane.
          strength = Math.min(1, Math.hypot(l, r));
          out[0] = -1.6 + u * 3.2;
          out[1] = 1.6 + l * 0.85;
          out[2] = -8 + time * 20 + r * 0.4;
          out[4] = (u * 0.65 + time * 0.25) % 1;
        }
      } else if (mode === "waterfall") {
        strength = this.linear[offset];
        out[1] = 0.86;
        out[4] = (index / OUTPUT_SAMPLES) * 0.75;
      } else if (mode === "balance") {
        strength = Math.max(
          this.levels[row * POINTS_PER_ROW + band],
          this.levels[row * POINTS_PER_ROW + band + OUTPUT_BANDS],
        );
        out[0] = -1.55 + frequency * 3.1;
        out[1] = 0.95 + strength * 1.15;
        out[2] = -2.1 + this.balance[row * OUTPUT_BANDS + band] * 0.9;
        out[4] = time * 0.75;
        if (channel) strength = 0;
      } else if (mode === "chroma") {
        const pitch = index % 12;
        strength = index < 12 ? this.chroma[row * 12 + pitch] : 0;
        const angle = (pitch / 12) * Math.PI * 2;
        out[0] = Math.cos(angle) * (0.2 + strength);
        out[1] = 0.95 + time * 1.3;
        out[2] = -2.1 + Math.sin(angle) * (0.2 + strength);
        out[4] = pitch / 12;
      } else if (mode === "flux") {
        strength = channel ? 0 : this.flux[row * OUTPUT_BANDS + band];
        out[0] = -1.55 + frequency * 3.1;
        out[1] = 0.86;
      } else if (mode === "envelope") {
        strength = this.envelope[offset];
        out[1] = 0.86;
        out[4] = (index / OUTPUT_SAMPLES) * 0.75;
      } else if (mode === "midside") {
        out[0] = side * 1.5;
        out[1] = 1.6 + mid * 0.65;
      } else if (mode === "delay") {
        out[0] = mid * 1.5;
        out[1] = 1.6 + this.delayed[offset] * 0.65;
        out[2] = -2.1 + side * 0.9;
        out[4] = time * 0.75;
      } else if (mode === "ribbon") {
        out[1] = 1.6 + l * 0.65;
        out[2] += r * 0.3;
        out[4] = (index / OUTPUT_SAMPLES) * 0.75;
      } else if (mode === "centroid" || mode === "dynamics") {
        const rms = this.metrics[m],
          peak = this.metrics[m + 1];
        strength = index === 0 ? Math.min(1, peak) : 0;
        out[1] = 0.95 + Math.min(1, rms) * 1.3;
        if (mode === "centroid") {
          out[0] = -1.55 + this.metrics[m + 2] * 3.1;
          out[2] = -3 + this.metrics[m + 3] * 1.8;
          out[4] = time * 0.75;
        } else {
          out[0] = this.metrics[m + 4] * 1.5;
          out[4] =
            Math.min(1, rms > 0 ? Math.log2(Math.max(1, peak / rms)) / 4 : 0) *
            0.75;
        }
      }
      out[5] = strength;
      out[3] = strength < 0.001 ? 0 : 0.006 + strength * 0.02;
      if (isVisualMode(mode)) out[3] *= 1.4 * (1 - time * 0.8);
      if (mode === "centroid" || mode === "dynamics") out[3] *= 3;
    }
    if (
      age >= Math.min(this.frames, HISTORY_ROWS) ||
      elapsed > HISTORY_ROWS / 30
    )
      out[3] = 0;
  }
}

export function isVisualMode(mode: OutputMode) {
  return (
    mode === "aurora" ||
    mode === "galaxy" ||
    mode === "knot" ||
    mode === "kaleidoscope" ||
    mode === "nebula" ||
    mode === "flight"
  );
}
