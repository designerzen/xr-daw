import { NOTE_ON } from "audiobus/commands/commands.ts";
import type { IAudioCommand } from "audiobus/commands/audio-command-interface.ts";

/** Small synthesized kit shared by real-time playback and offline export. */
export class DrumInstrument {
  readonly output: GainNode;
  private noise: AudioBuffer;
  private voices = new Set<AudioScheduledSourceNode>();

  constructor(
    private context: BaseAudioContext,
    mixer: AudioNode,
    volume: number,
  ) {
    this.output = context.createGain();
    this.output.gain.value = volume;
    this.output.connect(mixer);
    this.noise = context.createBuffer(
      1,
      context.sampleRate,
      context.sampleRate,
    );
    const data = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = seed / 2147483648;
    }
  }
  configure({
    volume = this.output.gain.value,
  }: {
    volume?: number;
    preset?: number;
  }) {
    this.output.gain.value = volume;
  }
  async connect() {}
  async sendCommand(command: IAudioCommand) {
    if (command.type !== NOTE_ON || command.velocity <= 0) return;
    const pitch = command.number;
    const at = Math.max(this.context.currentTime, command.audioTime ?? 0);
    const velocity = command.velocity / 127;
    const kick = pitch === 35 || pitch === 36;
    const snare = [38, 39, 40].includes(pitch);
    const hat = [42, 44, 46].includes(pitch);
    const cymbal = [49, 51, 52, 53, 55, 57, 59].includes(pitch);
    const tom = [41, 43, 45, 47, 48, 50].includes(pitch);
    const decay = kick
      ? 0.4
      : snare
        ? 0.2
        : hat
          ? pitch === 46
            ? 0.35
            : 0.07
          : cymbal
            ? 0.8
            : tom
              ? 0.25
              : 0.09;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.linearRampToValueAtTime(
      velocity * (cymbal || hat ? 0.45 : 0.8),
      at + 0.002,
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    envelope.connect(this.output);
    let source: AudioBufferSourceNode | OscillatorNode;
    let filter: BiquadFilterNode | undefined;
    if (snare || hat || cymbal) {
      source = this.context.createBufferSource();
      source.buffer = this.noise;
      filter = this.context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = hat ? 6500 : cymbal ? 4000 : 1400;
      source.connect(filter).connect(envelope);
    } else {
      source = this.context.createOscillator();
      source.type = kick || tom ? "sine" : "triangle";
      const frequency = kick
        ? 140
        : tom
          ? 65 * 2 ** ((pitch - 41) / 12)
          : 440 * 2 ** ((pitch - 69) / 12);
      source.frequency.setValueAtTime(frequency, at);
      source.frequency.exponentialRampToValueAtTime(
        kick ? 45 : frequency * 0.7,
        at + decay,
      );
      source.connect(envelope);
    }
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      filter?.disconnect();
      envelope.disconnect();
    };
    source.start(at);
    source.stop(at + decay + 0.01);
  }
  allNotesOff() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.voices.clear();
  }
  destroy() {
    this.allNotesOff();
    this.output.disconnect();
  }
}
