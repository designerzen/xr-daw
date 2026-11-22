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
  private messages: Record<string, unknown>[] = [];
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
      `const registerFM = registerProcessor;
      ((registerProcessor) => { (${registerFMProcessor.toString()})(${JSON.stringify({ name })}); })
      ((name, Processor) => registerFM(name, class extends Processor {
        constructor(options) {
          super(options);
          for (const data of options.processorOptions.events) this.port.onmessage({ data });
        }
      }));`,
    );
  }

  /** Deliver the complete queue synchronously inside the processor constructor. Offline
   * rendering can otherwise finish before MessagePort note/patch messages arrive.
   */
  flush() {
    if (this.node) return;
    this.node = new AudioWorkletNode(this.context, "harmoneasy-fm", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { polyphony: 64, events: this.messages },
    });
    this.node.connect(this.output);
    this.messages = [];
  }

  async sendCommand(command: IAudioCommand) {
    this.messages.push({
      type: command.type === NOTE_ON && command.velocity > 0 ? "on" : "off",
      part: command.channel - 1,
      note: command.number,
      velocity: command.velocity / 127,
      time: command.audioTime,
      patch: command.type === NOTE_ON ? FM_GENERAL_MIDI_PRESETS[0] : undefined,
    });
  }

  allNotesOff() {
    this.messages = [];
    this.node?.port.postMessage({ type: "panic" });
  }

  destroy() {
    this.allNotesOff();
    this.node?.disconnect();
    this.node?.port.close();
    this.output.disconnect();
  }
}
