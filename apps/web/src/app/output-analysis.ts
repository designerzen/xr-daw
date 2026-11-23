export const OUTPUT_BANDS = 64;
export const OUTPUT_SAMPLES = 128;
export const OUTPUT_FFT_SIZE = 4096;
/** RMS, peak, centroid / Nyquist, spread / Nyquist, stereo correlation. */
export const OUTPUT_METRICS = 5;
export interface OutputFrame {
  time: number;
  left: Float32Array;
  right: Float32Array;
  leftWave: Float32Array;
  rightWave: Float32Array;
  linear: Float32Array;
  balance: Float32Array;
  chroma: Float32Array;
  flux: Float32Array;
  envelope: Float32Array;
  delayed: Float32Array;
  metrics: Float32Array;
}

export function createOutputFrame(time = 0): OutputFrame {
  return {
    time,
    left: new Float32Array(OUTPUT_BANDS),
    right: new Float32Array(OUTPUT_BANDS),
    leftWave: new Float32Array(OUTPUT_SAMPLES),
    rightWave: new Float32Array(OUTPUT_SAMPLES),
    linear: new Float32Array(OUTPUT_SAMPLES),
    balance: new Float32Array(OUTPUT_BANDS),
    chroma: new Float32Array(12),
    flux: new Float32Array(OUTPUT_BANDS),
    envelope: new Float32Array(OUTPUT_SAMPLES),
    delayed: new Float32Array(OUTPUT_SAMPLES),
    metrics: new Float32Array(OUTPUT_METRICS),
  };
}

/** Power-weighted spectral measurements; no per-frame auto-normalisation. */
export function spectralFeatures(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  frame: OutputFrame,
) {
  frame.linear.fill(0);
  frame.chroma.fill(0);
  frame.balance.fill(0);
  let power = 0,
    moment = 0,
    second = 0;
  const high = Math.min(20000, sampleRate / 2);
  // Reuse flux temporarily for right-channel band power; capture flux afterwards.
  frame.flux.fill(0);
  for (let bin = 1; bin < left.length; bin++) {
    const hz = (bin * sampleRate) / (left.length * 2);
    const l = 10 ** (left[bin] / 10),
      r = 10 ** (right[bin] / 10),
      p = (l + r) / 2;
    power += p;
    moment += p * hz;
    second += p * hz * hz;
    const index = Math.min(
      OUTPUT_SAMPLES - 1,
      Math.floor((bin / left.length) * OUTPUT_SAMPLES),
    );
    frame.linear[index] = Math.max(
      frame.linear[index],
      Math.max(0, Math.min(1, (10 * Math.log10(p) + 90) / 84)),
    );
    if (hz >= 20 && hz <= high) {
      const band = Math.min(
        OUTPUT_BANDS - 1,
        Math.floor((Math.log(hz / 20) / Math.log(high / 20)) * OUTPUT_BANDS),
      );
      frame.balance[band] += l;
      frame.flux[band] += r;
    }
    // Exclude very low bins whose resolution cannot distinguish semitones.
    if (hz >= 130.81 && hz <= 5000) {
      const pitch =
        ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12;
      frame.chroma[pitch] += p;
    }
  }
  for (let i = 0; i < OUTPUT_BANDS; i++) {
    const l = frame.balance[i],
      r = frame.flux[i];
    frame.balance[i] = l + r > 1e-12 ? (r - l) / (l + r) : 0;
  }
  frame.flux.fill(0);
  for (let i = 0; i < 12; i++)
    frame.chroma[i] = Math.max(
      0,
      Math.min(1, (10 * Math.log10(frame.chroma[i]) + 90) / 84),
    );
  const centroid = power > 1e-12 ? moment / power : 0;
  frame.metrics[2] = centroid / (sampleRate / 2);
  frame.metrics[3] =
    power > 1e-12
      ? Math.sqrt(Math.max(0, second / power - centroid * centroid)) /
        (sampleRate / 2)
      : 0;
}

export function waveformFeatures(
  left: Float32Array,
  right: Float32Array,
  frame: OutputFrame,
) {
  let l2 = 0,
    r2 = 0,
    cross = 0,
    peak = 0;
  frame.envelope.fill(0);
  for (let i = 0; i < left.length; i++) {
    const l = left[i],
      r = right[i],
      amplitude = Math.max(Math.abs(l), Math.abs(r));
    l2 += l * l;
    r2 += r * r;
    cross += l * r;
    peak = Math.max(peak, amplitude);
    const bin = Math.min(
      OUTPUT_SAMPLES - 1,
      Math.floor((i / left.length) * OUTPUT_SAMPLES),
    );
    frame.envelope[bin] = Math.max(frame.envelope[bin], amplitude);
  }
  frame.metrics[0] = Math.sqrt((l2 + r2) / (2 * left.length));
  frame.metrics[1] = peak;
  frame.metrics[4] =
    l2 * r2 > 1e-20 ? Math.max(-1, Math.min(1, cross / Math.sqrt(l2 * r2))) : 0;
  for (let i = 0; i < OUTPUT_SAMPLES; i++) {
    const offset = left.length - OUTPUT_SAMPLES + i;
    frame.leftWave[i] = left[offset];
    frame.rightWave[i] = right[offset];
    // 32 native samples of delay, not decimation of the displayed trace.
    frame.delayed[i] = (left[offset - 32] + right[offset - 32]) / 2;
  }
}

/** Log-frequency bands, expressed as normalized dB above the analyser noise floor. */
export function frequencyBands(
  db: Float32Array,
  sampleRate: number,
  output: Float32Array,
) {
  const nyquist = sampleRate / 2,
    high = Math.min(20000, nyquist);
  for (let band = 0; band < output.length; band++) {
    const lowHz = 20 * (high / 20) ** (band / output.length);
    const highHz = 20 * (high / 20) ** ((band + 1) / output.length);
    const start = Math.min(
      db.length - 1,
      Math.floor((lowHz / nyquist) * db.length),
    );
    const end = Math.min(
      db.length,
      Math.max(start + 1, Math.ceil((highHz / nyquist) * db.length)),
    );
    let peak = -90;
    for (let bin = start; bin < end; bin++) peak = Math.max(peak, db[bin]);
    output[band] = Math.max(0, Math.min(1, (peak + 90) / 84));
  }
}

/** A non-audible stereo tap after output gain/effects. The audible graph is untouched. */
export class OutputAnalysis {
  private input: GainNode;
  private splitter: ChannelSplitterNode;
  private analysers: AnalyserNode[];
  private frequencies = [
    new Float32Array(OUTPUT_FFT_SIZE / 2),
    new Float32Array(OUTPUT_FFT_SIZE / 2),
  ];
  private waveform = [
    new Float32Array(OUTPUT_FFT_SIZE),
    new Float32Array(OUTPUT_FFT_SIZE),
  ];
  private previous = new Float32Array(OUTPUT_BANDS);
  private lastTime = -Infinity;
  private frame = createOutputFrame();

  constructor(
    private context: AudioContext,
    private source: AudioNode,
  ) {
    this.input = context.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = "explicit";
    this.input.channelInterpretation = "speakers";
    this.splitter = context.createChannelSplitter(2);
    source.connect(this.input).connect(this.splitter);
    this.analysers = [0, 1].map((channel) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = OUTPUT_FFT_SIZE;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -6;
      analyser.smoothingTimeConstant = 0;
      this.splitter.connect(analyser, channel);
      return analyser;
    });
  }

  read(): OutputFrame {
    if (
      this.context.currentTime >= this.lastTime &&
      this.context.currentTime - this.lastTime < 1 / 30 - 1e-6
    )
      return this.frame;
    const reset =
      this.context.currentTime - this.lastTime > 0.25 ||
      this.context.currentTime < this.lastTime;
    this.frame.time = this.context.currentTime;
    this.analysers.forEach((analyser, channel) => {
      analyser.getFloatFrequencyData(this.frequencies[channel]);
      frequencyBands(
        this.frequencies[channel],
        this.context.sampleRate,
        channel ? this.frame.right : this.frame.left,
      );
      analyser.getFloatTimeDomainData(this.waveform[channel]);
    });
    spectralFeatures(
      this.frequencies[0],
      this.frequencies[1],
      this.context.sampleRate,
      this.frame,
    );
    waveformFeatures(this.waveform[0], this.waveform[1], this.frame);
    for (let band = 0; band < OUTPUT_BANDS; band++) {
      const level = (this.frame.left[band] + this.frame.right[band]) / 2;
      this.frame.flux[band] = reset
        ? 0
        : Math.max(0, level - this.previous[band]);
      this.previous[band] = level;
    }
    this.lastTime = this.frame.time;
    return this.frame;
  }

  dispose() {
    this.source.disconnect(this.input);
    this.input.disconnect();
    this.splitter.disconnect();
    this.analysers.forEach((analyser) => analyser.disconnect());
  }
}
