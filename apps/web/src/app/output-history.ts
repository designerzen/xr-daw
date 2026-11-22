import {
  OUTPUT_BANDS,
  OUTPUT_SAMPLES,
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
} as const;
export type OutputMode = keyof typeof OUTPUT_MODES;
export const HISTORY_ROWS = 48;
export const POINTS_PER_ROW = OUTPUT_SAMPLES;

/** Ring storage sampled in audio seconds, independent of headset/render frame rate. */
export class OutputHistory {
  private levels = new Float32Array(HISTORY_ROWS * POINTS_PER_ROW);
  private leftWave = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private rightWave = new Float32Array(HISTORY_ROWS * OUTPUT_SAMPLES);
  private head = -1;
  private timestamps = new Float64Array(HISTORY_ROWS);
  private lastTime = -Infinity;
  frames = 0;

  clear() {
    this.levels.fill(0);
    this.leftWave.fill(0);
    this.rightWave.fill(0);
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
    this.frames++;
    return true;
  }

  /** Reuses the caller's output to avoid per-point allocations in XR. */
  point(
    mode: Exclude<OutputMode, "off">,
    age: number,
    index: number,
    out: Float32Array,
  ) {
    const row = (this.head - age + HISTORY_ROWS) % HISTORY_ROWS;
    const elapsed = Math.max(0, this.lastTime - this.timestamps[row]);
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
    } else {
      const left = this.leftWave[row * OUTPUT_SAMPLES + index];
      const right = this.rightWave[row * OUTPUT_SAMPLES + index];
      const energy = Math.min(1, Math.hypot(left, right));
      out[0] = Math.max(-1, Math.min(1, left)) * 1.5;
      out[1] = 1.6 + Math.max(-1, Math.min(1, right)) * 0.65;
      out[2] = -1.4 - time * 1.4 - (index / OUTPUT_SAMPLES) * 0.02;
      out[3] = energy < 0.001 ? 0 : 0.005 + energy * 0.012;
      out[4] = (index / OUTPUT_SAMPLES) * 0.75;
      out[5] = energy;
    }
    if (
      age >= Math.min(this.frames, HISTORY_ROWS) ||
      elapsed > HISTORY_ROWS / 30
    )
      out[3] = 0;
  }
}
