export type VinylCondition = "clean" | "worn" | "damaged";
interface VinylMessage {
  type: string;
  id?: number;
  message?: string;
  record?: { wallIn: Float32Array; wallOut: Float32Array };
  left?: Float32Array;
  right?: Float32Array;
  time?: number;
  rate?: number;
}

/** Adapts the pinned rauchg/vinyl engine to a linear waveform transport. */
export class VinylPlayback {
  private node?: AudioWorkletNode;
  private worker?: Worker;
  private initializing?: Promise<void>;
  private prepared?: AudioBuffer;
  private condition?: VinylCondition;
  private sequence = 0;
  private preparing: Promise<void> = Promise.resolve();
  private pending = new Map<
    number,
    {
      resolve: (message: VinylMessage) => void;
      reject: (reason: Error) => void;
    }
  >();
  position = 0;
  rate = 1;
  onEnded: () => void = () => {};
  onError: (error: Error) => void = console.error;

  constructor(
    private context: AudioContext,
    private destination: AudioNode,
  ) {}

  private receive = (message: VinylMessage) => {
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (request) {
        this.pending.delete(message.id);
        if (message.type === "error")
          request.reject(new Error(message.message));
        else request.resolve(message);
      }
    }
    if (message.type === "position") {
      this.position = message.time!;
      this.rate = message.rate!;
    } else if (message.type === "ended") this.onEnded();
  };
  private fail = (error: Error) => {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.onError(error);
  };
  private initialize() {
    return (this.initializing ??= (async () => {
      const base = new URL(import.meta.env.BASE_URL, location.href);
      await this.context.audioWorklet.addModule(
        new URL("audio/vinyl-waveform.worklet.js", base),
      );
      this.node = new AudioWorkletNode(this.context, "xr-daw-vinyl", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.port.onmessage = ({ data }) => this.receive(data);
      this.node.onprocessorerror = () =>
        this.fail(new Error("The vinyl playback processor stopped."));
      this.node.connect(this.destination);
      this.worker = new Worker(new URL("audio/vinyl-master.worker.js", base), {
        type: "module",
      });
      this.worker.onmessage = ({ data }) => this.receive(data);
      this.worker.onerror = () =>
        this.fail(new Error("Vinyl mastering failed."));
    })());
  }
  private request(
    target: Worker | MessagePort,
    message: object,
    transfer: Transferable[] = [],
  ) {
    const id = ++this.sequence;
    return new Promise<VinylMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      target.postMessage({ ...message, id }, transfer);
    });
  }
  prepare(buffer: AudioBuffer, condition: VinylCondition): Promise<void> {
    const result = this.preparing.then(() =>
      this.prepareNext(buffer, condition),
    );
    this.preparing = result.catch(() => {});
    return result;
  }
  private async prepareNext(buffer: AudioBuffer, condition: VinylCondition) {
    await this.initialize();
    if (buffer === this.prepared && condition === this.condition) return;
    let channels: { left: Float32Array; right: Float32Array } | undefined;
    if (buffer !== this.prepared) {
      // Fold multichannel input to the library's stereo groove without discarding channels.
      const left = new Float32Array(buffer.length),
        right = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const source = buffer.getChannelData(c);
        const target = c % 2 ? right : left;
        const divisor =
          c % 2
            ? Math.floor(buffer.numberOfChannels / 2)
            : Math.ceil(buffer.numberOfChannels / 2);
        for (let i = 0; i < source.length; i++)
          target[i] += source[i] / divisor;
      }
      if (buffer.numberOfChannels === 1) right.set(left);
      channels = { left, right };
    }
    const result = await this.request(
      this.worker!,
      {
        type: "prepare",
        ...channels,
        sampleRate: buffer.sampleRate,
        condition,
      },
      channels ? [channels.left.buffer, channels.right.buffer] : [],
    );
    const record = result.record!;
    await this.request(
      this.node!.port,
      { type: "record", record, condition, duration: buffer.duration },
      [record.wallIn.buffer, record.wallOut.buffer],
    );
    this.prepared = buffer;
    this.condition = condition;
  }
  play(time: number, loop: boolean) {
    this.position = time;
    this.rate = 1;
    this.node!.port.postMessage({ type: "loop", on: loop });
    this.node!.port.postMessage({ type: "play", time });
  }
  pause() {
    this.node?.port.postMessage({ type: "pause" });
  }
  setLoop(on: boolean) {
    this.node?.port.postMessage({ type: "loop", on });
  }
  scratch(time: number, rate: number) {
    this.position = time;
    this.node?.port.postMessage({ type: "scratch", time, rate });
  }
  release() {
    this.node?.port.postMessage({ type: "release" });
  }
  async render(buffer: AudioBuffer, condition: VinylCondition, gain: number) {
    await this.prepare(buffer, condition);
    const result = await this.request(this.worker!, {
      type: "render",
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      condition,
      gain,
    });
    const output = this.context.createBuffer(
      2,
      buffer.length,
      buffer.sampleRate,
    );
    output.copyToChannel(new Float32Array(result.left!), 0);
    output.copyToChannel(new Float32Array(result.right!), 1);
    return output;
  }
  dispose() {
    this.pause();
    this.worker?.terminate();
    this.node?.disconnect();
    this.node?.port.close();
    for (const request of this.pending.values())
      request.reject(new Error("Vinyl operation cancelled."));
    this.pending.clear();
  }
}
