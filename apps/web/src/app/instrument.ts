import OutputFM from "audiobus/io/outputs/output-fm.ts";
import { musicalCommand } from "audiobus/io/event-clip.ts";
import { NOTE_ON, NOTE_OFF, PITCH_BEND } from "audiobus/commands/commands.ts";
import type { Note, Project, Track } from "./project";
import { tickToSeconds, trackAudible } from "./project";
import { OfflineInstrument } from "./offline-instrument";
import { DrumInstrument } from "./drum-instrument";
import { PerformanceMap } from "./performance";

type InstrumentOutput = Pick<
  OutputFM,
  "connect" | "configure" | "sendCommand" | "allNotesOff" | "destroy"
> & { flush?(): void };

interface Part {
  output: InstrumentOutput;
  channel: number;
  program: number;
}

/** Owns audiobus instruments; transport and musical time remain with the host. */
export class ProjectInstrument {
  private outputs = new Map<string, InstrumentOutput>();
  private parts = new Map<string, Part>();
  private generation = 0;
  private performance?: PerformanceMap;

  constructor(
    private context: BaseAudioContext,
    private destination: AudioNode,
  ) {}

  private output(key: string, gain: number, program = 0, drums = false) {
    key += drums ? ":drums" : ":fm";
    let output = this.outputs.get(key);
    if (!output) {
      output = drums
        ? new DrumInstrument(this.context, this.destination, gain * 0.4)
        : "startRendering" in this.context
          ? new OfflineInstrument(this.context, this.destination, gain * 0.4)
          : new OutputFM({
              audioContext: this.context as AudioContext,
              mixer: this.destination,
              volume: gain * 0.4,
              polyphony: 64,
            });
      this.outputs.set(key, output);
    }
    output.configure({ volume: gain * 0.4, preset: program });
    return output;
  }

  async prepare(project: Project) {
    this.silence();
    this.parts.clear();
    this.performance = new PerformanceMap(project);
    const tracks = new Map(project.tracks.map((track) => [track.id, track]));
    const lanes = new Map<string, Map<number, number>[]>();
    const needed = new Set<InstrumentOutput>();
    for (const note of [...project.notes].sort((a, b) => a.start - b.start)) {
      const track = tracks.get(note.trackId);
      if (!track || !trackAudible(project, track)) continue;
      let channels = lanes.get(track.id);
      if (!channels) lanes.set(track.id, (channels = []));
      // FM identifies held notes by channel + pitch. Give overlapping unisons separate
      // channels, and another instance beyond sixteen, so their note-offs stay independent.
      let lane = channels.findIndex(
        (held) => (held.get(note.pitch) ?? -1) <= note.start,
      );
      if (lane < 0) {
        lane = channels.length;
        channels.push(new Map());
      }
      channels[lane].set(note.pitch, this.performance.end(note));
      const output = this.output(
        `track:${track.id}:${Math.floor(lane / 16)}`,
        track.gain,
        track.program ?? 0,
        track.drums ?? false,
      );
      this.parts.set(note.id, {
        output,
        channel: (lane % 16) + 1,
        program: this.performance.program(track.id, note.start),
      });
      needed.add(output);
    }
    for (const [key, output] of this.outputs) {
      if (!key.startsWith("audition:") && !needed.has(output)) {
        output.destroy();
        this.outputs.delete(key);
      }
    }
    await Promise.all([...needed].map((output) => output.connect()));
  }

  schedule(
    note: Note,
    at: number,
    duration: number,
    fromTick = note.start,
    toTick = this.performance?.end(note) ?? note.start + note.duration,
  ) {
    const part = this.parts.get(note.id);
    if (part) {
      const performance = this.performance!;
      for (const bend of performance.pitch(note.trackId, fromTick, toTick))
        void part.output.sendCommand(
          musicalCommand({
            type: PITCH_BEND,
            number: 0,
            value: bend.value + 8192,
            channel: part.channel,
            audioTime:
              at +
              tickToSeconds(performance.project, bend.tick) -
              tickToSeconds(performance.project, fromTick),
          }),
        );
      this.send(part, note, at, duration);
    }
  }

  private send(
    { output, channel, program }: Part,
    note: Note,
    at: number,
    duration: number,
  ) {
    output.configure({ preset: program });
    void output.sendCommand(
      musicalCommand({
        type: NOTE_ON,
        number: note.pitch,
        channel,
        velocity: Math.round(note.velocity * 127),
        audioTime: at,
      }),
    );
    void output.sendCommand(
      musicalCommand({
        type: NOTE_OFF,
        number: note.pitch,
        channel,
        velocity: 0,
        audioTime: at + duration,
      }),
    );
  }

  async audition(note: Note, gain: number, track?: Track, project?: Project) {
    const request = this.generation;
    // Keep audition outputs separate by program so rapid track switches cannot recolour queued notes.
    const performance = project ? new PerformanceMap(project) : undefined;
    const program =
      performance?.program(note.trackId, note.start) ?? track?.program ?? 0;
    const output = this.output(
      `audition:${program}`,
      gain,
      program,
      track?.drums ?? false,
    );
    await output.connect();
    if (request !== this.generation) return;
    const bend =
      performance?.pitch(note.trackId, note.start, note.start)[0].value ?? 0;
    void output.sendCommand(
      musicalCommand({
        type: PITCH_BEND,
        number: 0,
        value: bend + 8192,
        channel: 1,
        audioTime: this.context.currentTime,
      }),
    );
    this.send(
      { output, channel: 1, program },
      note,
      this.context.currentTime,
      0.22,
    );
  }

  scheduleProject(project: Project) {
    for (const note of project.notes) {
      const start = tickToSeconds(project, note.start);
      this.schedule(
        note,
        start,
        tickToSeconds(project, this.performance!.end(note)) - start,
      );
    }
    for (const output of this.outputs.values()) output.flush?.();
  }

  silence() {
    this.generation++;
    for (const output of this.outputs.values()) output.allNotesOff();
  }

  dispose() {
    this.generation++;
    for (const output of this.outputs.values()) output.destroy();
    this.outputs.clear();
    this.parts.clear();
  }
}
