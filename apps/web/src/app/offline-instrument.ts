import registerFMProcessor from "audiobus/instruments/fm/processor.js";
import { FM_GENERAL_MIDI_PRESETS } from "audiobus/instruments/fm/presets.ts";
import { loadCaptureWorklet } from "audiobus/io/inputs/load-capture-worklet.ts";
import type { IAudioCommand } from "audiobus/commands/audio-command-interface.ts";
import { NOTE_ON } from "audiobus/commands/commands.ts";

/** OutputFM resumes live contexts. Offline rendering must start without calling resume().
 * Use its same processor, patch and message protocol, with the host owning rendering.
 */
export class OfflineInstrument {
  private node?: AudioWorkletNode;
  readonly output: GainNode;

  constructor(
    private context: BaseAudioContext,
    mixer: AudioNode,
    volume: number,
  ) {
    this.output = context.createGain();
    this.output.gain.value = volume;
    this.output.connect(mixer);
  }

  configure({ volume }: { volume: number }) {
    this.output.gain.value = volume;
  }

  async connect() {
    if (this.node) return;
    const name = "harmoneasy-fm";
    await loadCaptureWorklet(
      this.context,
      name,
      `(${registerFMProcessor.toString()})(${JSON.stringify({ name })})`,
    );
    this.node = new AudioWorkletNode(this.context, name, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { polyphony: 64 },
    });
    this.node.connect(this.output);
    for (let part = 0; part < 16; part++) {
      this.node.port.postMessage({
        type: "patch",
        part,
        patch: FM_GENERAL_MIDI_PRESETS[0],
      });
    }
  }

  async sendCommand(command: IAudioCommand) {
    this.node!.port.postMessage({
      type: command.type === NOTE_ON && command.velocity > 0 ? "on" : "off",
      part: command.channel - 1,
      note: command.number,
      velocity: command.velocity / 127,
      time: command.audioTime,
    });
  }

  allNotesOff() {
    this.node?.port.postMessage({ type: "panic" });
  }

  destroy() {
    this.allNotesOff();
    this.node?.disconnect();
    this.node?.port.close();
    this.output.disconnect();
  }
}
