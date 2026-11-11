export type VinylCondition = "clean" | "worn" | "damaged";
interface VinylMessage {
  type: string;
  id?: number;
  message?: string;
  record?: { grooves: { data: Float32Array } };
  left?: Float32Array;
  right?: Float32Array;
  time?: number;
  rate?: number;
  contextTime?: number;
  revision?: number;
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
  private reportedPosition = 0;
  private positionClock = 0;
  private running = false;
  private scratching = false;
  private looping = false;
  private duration = 0;
  private revision = 0;
  get position() {
    const elapsed =
      this.running && !this.scratching
        ? Math.max(
            0,
            Math.min(0.05, this.context.currentTime - this.positionClock),
          )
        : 0;
    const time = this.reportedPosition + elapsed * this.rate;
    if (this.looping && this.duration > 0)
      return ((time % this.duration) + this.duration) % this.duration;
    return Math.max(0, Math.min(this.duration, time));
  }
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
      if (!this.running || message.revision !== this.revision) return;
      if (!this.scratching) {
        this.reportedPosition = message.time!;
        this.positionClock = message.contextTime!;
      }
      this.rate = message.rate!;
    } else if (message.type === "ended" && message.revision === this.revision) {
      this.reportedPosition = this.duration;
      this.running = false;
      this.onEnded();
    }
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
    let channels: Float32Array[] | undefined;
    if (buffer !== this.prepared) {
      // AudioBuffer storage cannot be transferred. Copy once, then mix in the worker.
      channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
        buffer.getChannelData(c).slice(),
      );
    }
    const result = await this.request(
      this.worker!,
      {
        type: "prepare",
        channels,
        sampleRate: buffer.sampleRate,
        condition,
      },
      channels ? channels.map((channel) => channel.buffer) : [],
    );
    const record = result.record!;
    await this.request(
      this.node!.port,
      { type: "record", record, condition, duration: buffer.duration },
      [record.grooves.data.buffer],
    );
    this.prepared = buffer;
    this.condition = condition;
    this.duration = buffer.duration;
  }
  play(time: number, loop: boolean) {
    this.reportedPosition = time;
    this.positionClock = this.context.currentTime;
    this.running = true;
    this.scratching = false;
    this.looping = loop;
    this.rate = 1;
    this.node!.port.postMessage({ type: "loop", on: loop });
    this.node!.port.postMessage({
      type: "play",
      time,
      revision: ++this.revision,
    });
  }
  pause() {
    this.reportedPosition = this.position;
    this.running = false;
    this.scratching = false;
    this.node?.port.postMessage({ type: "pause", revision: ++this.revision });
  }
  setLoop(on: boolean) {
    this.looping = on;
    this.node?.port.postMessage({ type: "loop", on });
  }
  scratch(time: number, rate: number) {
    this.reportedPosition = time;
    this.positionClock = this.context.currentTime;
    this.scratching = true;
    this.rate = rate;
    this.node?.port.postMessage({
      type: "scratch",
      time,
      rate,
      revision: ++this.revision,
    });
  }
  release() {
    this.scratching = false;
    this.positionClock = this.context.currentTime;
    this.node?.port.postMessage({ type: "release", revision: ++this.revision });
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
    output.copyToChannel(result.left! as Float32Array<ArrayBuffer>, 0);
    output.copyToChannel(result.right! as Float32Array<ArrayBuffer>, 1);
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
