import OutputFM from "audiobus/io/outputs/output-fm.ts";
import { musicalCommand } from "audiobus/io/event-clip.ts";
import { NOTE_ON, NOTE_OFF } from "audiobus/commands/commands.ts";
import type { Note, Project } from "./project";
import { tickToSeconds } from "./project";
import { OfflineInstrument } from "./offline-instrument";

type InstrumentOutput = Pick<
  OutputFM,
  "connect" | "configure" | "sendCommand" | "allNotesOff" | "destroy"
>;

interface Part {
  output: InstrumentOutput;
  channel: number;
}

/** Owns audiobus instruments; transport and musical time remain with the host. */
export class ProjectInstrument {
  private outputs = new Map<string, InstrumentOutput>();
  private parts = new Map<string, Part>();
  private generation = 0;

  constructor(
    private context: BaseAudioContext,
    private destination: AudioNode,
  ) {}

  private output(key: string, gain: number) {
    let output = this.outputs.get(key);
    if (!output) {
      output =
        "startRendering" in this.context
          ? new OfflineInstrument(this.context, this.destination, gain * 0.4)
          : new OutputFM({
              audioContext: this.context as AudioContext,
              mixer: this.destination,
              volume: gain * 0.4,
              polyphony: 64,
            });
      this.outputs.set(key, output);
    }
    output.configure({ volume: gain * 0.4 });
    return output;
  }

  async prepare(project: Project) {
    this.silence();
    this.parts.clear();
    const tracks = new Map(project.tracks.map((track) => [track.id, track]));
    const lanes = new Map<string, Map<number, number>[]>();
    const needed = new Set<InstrumentOutput>();
    for (const note of [...project.notes].sort((a, b) => a.start - b.start)) {
      const track = tracks.get(note.trackId);
      if (!track || track.muted) continue;
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
      channels[lane].set(note.pitch, note.start + note.duration);
      const output = this.output(
        `${track.id}:${Math.floor(lane / 16)}`,
        track.gain,
      );
      this.parts.set(note.id, { output, channel: (lane % 16) + 1 });
      needed.add(output);
    }
    for (const [key, output] of this.outputs) {
      if (key !== "audition" && !needed.has(output)) {
        output.destroy();
        this.outputs.delete(key);
      }
    }
    await Promise.all([...needed].map((output) => output.connect()));
  }

  schedule(note: Note, at: number, duration: number) {
    const part = this.parts.get(note.id);
    if (part) this.send(part, note, at, duration);
  }

  private send(
    { output, channel }: Part,
    note: Note,
    at: number,
    duration: number,
  ) {
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

  async audition(note: Note, gain: number) {
    const request = this.generation;
    const output = this.output("audition", gain);
    await output.connect();
    if (request !== this.generation) return;
    this.send({ output, channel: 1 }, note, this.context.currentTime, 0.22);
  }

  scheduleProject(project: Project) {
    for (const note of project.notes) {
      const start = tickToSeconds(project, note.start);
      this.schedule(
        note,
        start,
        tickToSeconds(project, note.start + note.duration) - start,
      );
    }
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
