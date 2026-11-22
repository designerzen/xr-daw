import { Timer, TIMER_TYPE_AUDIO_WORKLET } from "netronome";
import { ProjectInstrument } from "./instrument";
import { OutputAnalysis } from "./output-analysis";
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

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private output?: AudioNode;
  private analysis?: OutputAnalysis;
  private instrument?: ProjectInstrument;
  private clock?: Timer;
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
      this.output = limiter;
      this.instrument = new ProjectInstrument(this.context, this.master);
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
  readOutput() {
    if (!this.context || !this.output) return;
    this.analysis ??= new OutputAnalysis(this.context, this.output);
    return this.analysis.read();
  }
  get positionTick() {
    return this.project ? secondsToTick(this.project, this.positionSeconds) : 0;
  }

  async play(project: Project, tick?: number) {
    const request = ++this.generation;
    await this.unlock();
    if (request !== this.generation) return;
    this.playing = false;
    this.stopVoices();
    try {
      await this.instrument!.prepare(project);
    } catch (error) {
      if (request !== this.generation) return;
      throw error;
    }
    if (request !== this.generation) return;
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
    this.schedule();
    await this.startClock(project, tick ?? 0);
  }

  /**
   * Netronome's AudioWorklet clock wakes the lookahead scheduler from the audio thread, so
   * notes keep flowing when the visual frame rate falls. It pulses at 24 per beat (MIDI clock)
   * at the tempo where playback starts.
   */
  private async startClock(project: Project, tick: number) {
    const tempo =
      [...project.tempos].reverse().find((t) => t.tick <= tick) ??
      project.tempos[0];
    // Never pulse slower than the scheduler's 150 ms lookahead can cover.
    const bpm = Math.max(60, tempo?.bpm ?? 120);
    try {
      this.clock ??= new Timer({
        audioContext: this.context,
        type: TIMER_TYPE_AUDIO_WORKLET,
        divisions: 24,
        bpm,
        synch: false,
      });
      await this.clock.loaded;
      if (!this.playing) return;
      this.clock.bpm = bpm;
      await this.clock.startTimer(() => this.schedule());
    } catch (error) {
      console.warn("Netronome clock unavailable, using a worker timer", error);
      this.clock = undefined;
      this.startFallbackClock();
    }
  }

  private startFallbackClock() {
    if (this.worker) return;
    this.workerUrl = URL.createObjectURL(
      new Blob(["setInterval(() => postMessage(0), 25)"], {
        type: "text/javascript",
      }),
    );
    this.worker = new Worker(this.workerUrl);
    this.worker.onmessage = () => this.schedule();
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
      this.instrument!.schedule(event.note, start, duration);
    }
  }

  pause() {
    this.offset = this.positionSeconds;
    this.playing = false;
    this.generation++;
    this.stopVoices();
    this.clock?.stopTimer().catch(() => {});
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
    const request = this.generation;
    await this.unlock();
    if (request !== this.generation) return;
    await this.instrument!.audition(note, gain);
  }
  private stopVoices() {
    this.instrument?.silence();
  }
  dispose() {
    this.stop();
    this.clock?.unsetTimingWorker().catch(() => {});
    this.worker?.terminate();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.instrument?.dispose();
    this.analysis?.dispose();
    void this.context?.close();
  }
}

export async function exportWav(project: Project): Promise<Blob> {
  const sampleRate = 44100;
  const duration = tickToSeconds(project, projectEnd(project));
  if (duration > 600)
    throw new Error(
      "WAV export currently supports projects up to ten minutes.",
    );
  const context = new OfflineAudioContext(
    2,
    Math.ceil((duration + 2) * sampleRate),
    sampleRate,
  );
  const master = context.createGain();
  master.gain.value = 0.75;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 12;
  master.connect(limiter).connect(context.destination);
  const instrument = new ProjectInstrument(context, master);
  try {
    await instrument.prepare(project);
    instrument.scheduleProject(project);
    return encodeWav(await context.startRendering());
  } finally {
    instrument.dispose();
  }
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
