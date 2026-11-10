import {
  projectEnd,
  secondsToTick,
  tickToSeconds,
  type Note,
  type Project,
} from "./project";

interface TimedNote {
  note: Note;
  start: number;
  end: number;
}
export function compileNotes(project: Project): TimedNote[] {
  return project.notes
    .map((note) => ({
      note,
      start: tickToSeconds(project, note.start),
      end: tickToSeconds(project, note.start + note.duration),
    }))
    .sort((a, b) => a.start - b.start);
}

/** Native audio nodes run on the audio thread. UI/render frames never trigger sequencer notes. */
function voice(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  velocity: number,
  gain: number,
  at: number,
  duration: number,
): OscillatorNode {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
  const end = at + Math.max(0.01, duration);
  const level = Math.max(0.0001, velocity * gain * 0.12);
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(level, Math.min(at + 0.005, end));
  envelope.gain.setValueAtTime(level, end);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end + 0.04);
  oscillator.connect(envelope).connect(destination);
  oscillator.start(at);
  oscillator.stop(end + 0.05);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
  return oscillator;
}

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private voices = new Set<OscillatorNode>();
  private worker?: Worker;
  private workerUrl?: string;
  private generation = 0;
  private origin = 0;
  private offset = 0;
  private cursor = 0;
  private scheduledCycle = 0;
  private notes: TimedNote[] = [];
  private project?: Project;
  private duration = 0;
  playing = false;
  loop = false;

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.75;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.ratio.value = 12;
      this.master.connect(limiter).connect(this.context.destination);
      this.context.onstatechange = () => {
        if (this.context?.state === "suspended" && this.playing) this.pause();
      };
    }
    await this.context.resume();
  }

  get positionSeconds() {
    if (!this.playing || !this.context) return this.offset;
    const elapsed = Math.max(0, this.context.currentTime - this.origin);
    return this.loop && this.duration > 0
      ? elapsed % this.duration
      : Math.min(this.duration, elapsed);
  }
  get positionTick() {
    return this.project ? secondsToTick(this.project, this.positionSeconds) : 0;
  }

  async play(project: Project, tick?: number) {
    const request = ++this.generation;
    await this.unlock();
    if (request !== this.generation) return;
    this.stopVoices();
    this.project = project;
    this.notes = compileNotes(project);
    this.duration = tickToSeconds(project, projectEnd(project));
    this.offset =
      tick === undefined ? this.offset : tickToSeconds(project, tick);
    if (this.offset >= this.duration) this.offset = 0;
    this.origin = this.context!.currentTime + 0.04 - this.offset;
    this.cursor = 0;
    this.scheduledCycle = 0;
    this.playing = true;
    if (!this.worker) {
      // A worker wakes the lookahead scheduler even when the visual frame rate falls.
      this.workerUrl = URL.createObjectURL(
        new Blob(["setInterval(() => postMessage(0), 25)"], {
          type: "text/javascript",
        }),
      );
      this.worker = new Worker(this.workerUrl);
      this.worker.onmessage = () => this.schedule();
    }
    this.schedule();
  }

  private schedule() {
    if (!this.playing || !this.context || !this.project || !this.master) return;
    const now = this.context.currentTime;
    const elapsed = now - this.origin;
    if (elapsed >= this.duration && !this.loop) {
      this.stop();
      return;
    }
    const currentCycle = this.loop
      ? Math.max(0, Math.floor(elapsed / this.duration))
      : 0;
    if (this.scheduledCycle < currentCycle) {
      // Recover from a stalled browser without replaying all missed cycles.
      this.scheduledCycle = currentCycle;
      this.cursor = 0;
    }
    const horizon = now + 0.15 - this.origin;
    if (!this.notes.length) return;
    while (true) {
      if (this.cursor === this.notes.length) {
        if (!this.loop) break;
        this.scheduledCycle++;
        this.cursor = 0;
      }
      const cycleOffset = this.scheduledCycle * this.duration;
      if (cycleOffset + this.notes[this.cursor].start >= horizon) break;
      const event = this.notes[this.cursor++];
      const eventStart = event.start + cycleOffset;
      const eventEnd = event.end + cycleOffset;
      if (
        (this.scheduledCycle === 0 && event.end <= this.offset) ||
        eventEnd <= now - this.origin
      )
        continue;
      const track = this.project.tracks.find(
        (t) => t.id === event.note.trackId,
      );
      if (!track || track.muted) continue;
      const start = Math.max(
        now,
        this.origin +
          Math.max(eventStart, this.scheduledCycle === 0 ? this.offset : 0),
      );
      const duration = this.origin + eventEnd - start;
      if (duration <= 0) continue;
      const node = voice(
        this.context,
        this.master,
        event.note.pitch,
        event.note.velocity,
        track.gain,
        start,
        duration,
      );
      this.voices.add(node);
      node.addEventListener("ended", () => this.voices.delete(node));
    }
  }

  pause() {
    this.offset = this.positionSeconds;
    this.playing = false;
    this.generation++;
    this.stopVoices();
  }
  stop() {
    this.pause();
    this.offset = 0;
  }
  async seek(project: Project, tick: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.project = project;
    this.offset = tickToSeconds(project, tick);
    if (wasPlaying) await this.play(project, tick);
  }
  async audition(note: Note, gain = 0.7) {
    await this.unlock();
    const node = voice(
      this.context!,
      this.master!,
      note.pitch,
      note.velocity,
      gain,
      this.context!.currentTime,
      0.22,
    );
    this.voices.add(node);
    node.addEventListener("ended", () => this.voices.delete(node));
  }
  private stopVoices() {
    for (const node of this.voices) {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.voices.clear();
  }
  dispose() {
    this.stop();
    this.worker?.terminate();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    void this.context?.close();
  }
}

export async function exportWav(project: Project): Promise<Blob> {
  const sampleRate = 44100;
  const seconds = tickToSeconds(project, projectEnd(project)) + 0.1;
  if (seconds > 600)
    throw new Error(
      "WAV export currently supports projects up to ten minutes.",
    );
  const context = new OfflineAudioContext(
    2,
    Math.ceil(seconds * sampleRate),
    sampleRate,
  );
  const master = context.createGain();
  master.gain.value = 0.75;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 12;
  master.connect(limiter).connect(context.destination);
  for (const { note, start, end } of compileNotes(project)) {
    const track = project.tracks.find((t) => t.id === note.trackId);
    if (track && !track.muted)
      voice(
        context,
        master,
        note.pitch,
        note.velocity,
        track.gain,
        start,
        end - start,
      );
  }
  return encodeWav(await context.startRendering());
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const data = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(data);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, data.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data.byteLength - 44, true);
  const samples = Array.from({ length: channels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let i = 0; i < buffer.length; i++)
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, samples[c][i]));
      view.setInt16(
        44 + (i * channels + c) * 2,
        sample * (sample < 0 ? 32768 : 32767),
        true,
      );
    }
  return new Blob([data], { type: "audio/wav" });
}
