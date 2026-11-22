export const OUTPUT_BANDS = 64;
export const OUTPUT_SAMPLES = 128;
export interface OutputFrame {
  time: number;
  left: Float32Array;
  right: Float32Array;
  leftWave: Float32Array;
  rightWave: Float32Array;
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
  private frequencies = new Float32Array(1024);
  private waveform = new Float32Array(2048);
  private frame: OutputFrame = {
    time: 0,
    left: new Float32Array(OUTPUT_BANDS),
    right: new Float32Array(OUTPUT_BANDS),
    leftWave: new Float32Array(OUTPUT_SAMPLES),
    rightWave: new Float32Array(OUTPUT_SAMPLES),
  };

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
      analyser.fftSize = 2048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -6;
      analyser.smoothingTimeConstant = 0.65;
      this.splitter.connect(analyser, channel);
      return analyser;
    });
  }

  read(): OutputFrame {
    this.frame.time = this.context.currentTime;
    this.analysers.forEach((analyser, channel) => {
      analyser.getFloatFrequencyData(this.frequencies);
      frequencyBands(
        this.frequencies,
        this.context.sampleRate,
        channel ? this.frame.right : this.frame.left,
      );
      analyser.getFloatTimeDomainData(this.waveform);
      const samples = channel ? this.frame.rightWave : this.frame.leftWave;
      for (let i = 0; i < samples.length; i++)
        // Retain consecutive samples at the native rate: decimation would alias the scope.
        samples[i] = this.waveform[this.waveform.length - samples.length + i];
    });
    return this.frame;
  }

  dispose() {
    this.source.disconnect(this.input);
    this.input.disconnect();
    this.splitter.disconnect();
    this.analysers.forEach((analyser) => analyser.disconnect());
  }
}
