import { scratchRate, type WaveAnalysis } from "./spectrum";
import { VinylPlayback, type VinylCondition } from "./vinyl-playback";

export interface AudioClip {
  name: string;
  file: File;
  buffer: AudioBuffer;
  reversed: AudioBuffer;
  analysis: WaveAnalysis;
}

/** Forward/reverse buffer playback on the audio clock, with short crossfades for scratching. */
export class ClipPlayer {
  private context?: AudioContext;
  private master?: GainNode;
  private source?: AudioBufferSourceNode;
  private envelope?: GainNode;
  private offset = 0;
  private origin = 0;
  private generation = 0;
  private decoding = 0;
  private vinylOperations = 0;
  private vinyl?: VinylPlayback;
  vinylEnabled = false;
  vinylCondition: VinylCondition = "worn";
  get vinylBusy() {
    return this.vinylOperations > 0;
  }
  private workers = new Map<Worker, (reason: Error) => void>();
  private scrub?: { time: number; stamp: number; moved: boolean };
  clip?: AudioClip;
  playing = false;
  private looping = false;
  private level = 0.7;
  private silent = false;
  playbackRate = 1;
  onError: (error: unknown) => void = console.error;

  get loop() {
    return this.looping;
  }
  set loop(value: boolean) {
    this.looping = value;
    this.vinyl?.setLoop(value);
    if (this.source && !this.scrub?.moved) this.source.loop = value;
  }
  get gain() {
    return this.level;
  }
  set gain(value: number) {
    this.level = value;
    this.updateGain();
  }
  get muted() {
    return this.silent;
  }
  set muted(value: boolean) {
    this.silent = value;
    this.updateGain();
  }
  private updateGain() {
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.silent ? 0 : this.level,
        this.context.currentTime,
        0.01,
      );
  }

  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.silent ? 0 : this.level;
      this.master.connect(this.context.destination);
      this.context.onstatechange = () => {
        if (this.context?.state === "suspended") this.pause();
      };
    }
    return this.context;
  }

  async decode(file: File): Promise<AudioClip> {
    this.cancelDecode();
    const decoding = this.decoding;
    const context = this.ensureContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (decoding !== this.decoding) throw new Error("Audio loading cancelled.");
    if (buffer.duration > 600 || buffer.numberOfChannels > 8)
      throw new Error(
        "Audio files support up to ten minutes and eight channels.",
      );
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i).slice(),
    );
    const worker = new Worker(
      new URL("./spectrum.worker.ts", import.meta.url),
      { type: "module" },
    );
    try {
      const result = await new Promise<{
        analysis: WaveAnalysis;
        reversed: Float32Array[];
      }>((resolve, reject) => {
        this.workers.set(worker, reject);
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = () =>
          reject(new Error("Audio spectrum analysis failed."));
        worker.postMessage(
          { channels, sampleRate: buffer.sampleRate },
          channels.map((c) => c.buffer),
        );
      });
      const reversed = context.createBuffer(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate,
      );
      result.reversed.forEach((channel, i) =>
        reversed.copyToChannel(new Float32Array(channel), i),
      );
      return {
        name: file.name,
        file,
        buffer,
        reversed,
        analysis: result.analysis,
      };
    } finally {
      this.workers.delete(worker);
      worker.terminate();
    }
  }
  cancelDecode() {
    this.decoding++;
    for (const [worker, reject] of this.workers) {
      reject(new Error("Audio loading cancelled."));
      worker.terminate();
    }
    this.workers.clear();
  }

  load(clip: AudioClip) {
    this.stop();
    this.clip = clip;
  }
  private async prepareVinyl() {
    if (!this.clip) return;
    const context = this.ensureContext();
    if (!this.vinyl) {
      this.vinyl = new VinylPlayback(context, this.master!);
      this.vinyl.onEnded = () => {
        this.offset = this.clip?.buffer.duration ?? 0;
        this.playing = false;
      };
      this.vinyl.onError = (error) => {
        this.pause();
        this.onError(error);
      };
    }
    await this.vinyl.prepare(this.clip.buffer, this.vinylCondition);
  }
  async configureVinyl(enabled: boolean, condition = this.vinylCondition) {
    const time = this.positionSeconds;
    const wasPlaying = this.playing;
    this.pause();
    const generation = this.generation;
    this.vinylEnabled = enabled;
    this.vinylCondition = condition;
    this.vinylOperations++;
    try {
      if (enabled) {
        await this.ensureContext().resume();
        await this.prepareVinyl();
      }
      if (generation === this.generation && wasPlaying) await this.play(time);
    } catch (error) {
      this.vinylEnabled = false;
      throw error;
    } finally {
      this.vinylOperations--;
    }
  }
  async exportBuffer() {
    if (!this.clip) throw new Error("Load audio before exporting.");
    if (!this.vinylEnabled) return this.clip.buffer;
    await this.prepareVinyl();
    return this.vinyl!.render(
      this.clip.buffer,
      this.vinylCondition,
      this.muted ? 0 : this.gain,
    );
  }
  get positionSeconds() {
    if (this.vinylEnabled && this.playing && this.vinyl)
      return this.vinyl.position;
    if (!this.clip || !this.context || !this.playing || this.scrub?.moved)
      return this.offset;
    const position = this.offset + this.context.currentTime - this.origin;
    return this.loop
      ? position % this.clip.buffer.duration
      : Math.min(this.clip.buffer.duration, position);
  }
  private bounded(time: number) {
    return Math.max(0, Math.min(this.clip?.buffer.duration ?? 0, time));
  }
  async play(time?: number) {
    if (!this.clip) return false;
    const position = time ?? this.positionSeconds;
    const generation = ++this.generation;
    const context = this.ensureContext();
    await context.resume();
    if (this.vinylEnabled) await this.prepareVinyl();
    if (generation !== this.generation) return false;
    this.scrub = undefined;
    this.offset =
      time === undefined && position >= this.clip.buffer.duration
        ? 0
        : this.bounded(position);
    this.origin = context.currentTime;
    this.playing = true;
    if (this.vinylEnabled) this.vinyl!.play(this.offset, this.loop);
    else this.startSource(this.offset, 1);
    return true;
  }
  private startSource(time: number, rate: number, grain = false) {
    this.releaseSource();
    if (!this.clip || !this.context || Math.abs(rate) < 0.01) return;
    const context = this.context;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const reverse = rate < 0;
    source.buffer = reverse ? this.clip.reversed : this.clip.buffer;
    source.playbackRate.value = Math.abs(rate);
    source.loop = this.loop && !grain;
    this.playbackRate = rate;
    const offset = Math.max(
      0,
      Math.min(
        this.clip.buffer.duration - 1 / this.clip.buffer.sampleRate,
        reverse ? this.clip.buffer.duration - time : time,
      ),
    );
    envelope.gain.setValueAtTime(0, context.currentTime);
    envelope.gain.linearRampToValueAtTime(1, context.currentTime + 0.006);
    source.connect(envelope).connect(this.master!);
    this.source = source;
    this.envelope = envelope;
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      if (this.source === source && !grain) {
        this.offset = this.clip?.buffer.duration ?? 0;
        this.playing = false;
        this.source = undefined;
      }
    };
    source.start(context.currentTime, offset);
    if (grain) {
      envelope.gain.setValueAtTime(1, context.currentTime + 0.07);
      envelope.gain.linearRampToValueAtTime(0, context.currentTime + 0.09);
      source.stop(context.currentTime + 0.095);
    }
  }
  private releaseSource() {
    const source = this.source;
    const envelope = this.envelope;
    this.source = undefined;
    this.envelope = undefined;
    if (!source || !envelope || !this.context) return;
    envelope.gain.cancelScheduledValues(this.context.currentTime);
    envelope.gain.setTargetAtTime(0, this.context.currentTime, 0.003);
    try {
      source.stop(this.context.currentTime + 0.015);
    } catch {
      /* Already ended. */
    }
  }
  async beginScrub(time: number) {
    const started = await this.play(time);
    if (started && this.playing)
      this.scrub = {
        time: this.bounded(time),
        stamp: performance.now(),
        moved: false,
      };
  }
  scrubTo(time: number) {
    if (!this.scrub || !this.context) return;
    time = this.bounded(time);
    const now = performance.now();
    const rate = scratchRate(
      this.scrub.time,
      time,
      (now - this.scrub.stamp) / 1000,
    );
    this.scrub = { time, stamp: now, moved: true };
    this.offset = time;
    if (this.vinylEnabled) this.vinyl!.scratch(time, rate);
    else this.startSource(time, rate, true);
  }
  async endScrub() {
    const moved = this.scrub?.moved;
    this.scrub = undefined;
    if (this.vinylEnabled) this.vinyl?.release();
    else if (moved) await this.play(this.offset);
  }
  pause() {
    this.offset = this.positionSeconds;
    this.playing = false;
    this.scrub = undefined;
    this.generation++;
    this.vinyl?.pause();
    this.releaseSource();
  }
  stop() {
    this.pause();
    this.offset = 0;
  }
  dispose() {
    this.stop();
    this.cancelDecode();
    this.vinyl?.dispose();
    void this.context?.close();
  }
}
