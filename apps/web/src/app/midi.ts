import { parseMidi, writeMidi, type MidiEvent } from "midi-file";
import {
  validateProject,
  type Note,
  type Project,
  type Track,
} from "./project";

/** Split mixed-channel source tracks; channel-wide expression can live in any SMF track. */
export function importMidi(bytes: Uint8Array, name: string): Project {
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error("MIDI files must be smaller than 10 MB.");
  const midi = parseMidi(bytes);
  if (midi.header.format === 2)
    throw new Error("Independent MIDI type-2 sequences are not supported.");
  const ppq = midi.header.ticksPerBeat;
  if (!ppq)
    throw new Error(
      "SMPTE MIDI timing is not supported. Export a beat-based MIDI file.",
    );
  const project: Project = {
    version: 1,
    name,
    ppq,
    tempos: [],
    tracks: [],
    notes: [],
    timeSignatures: [],
    sustain: [],
    pitchBends: [],
    programChanges: [],
  };
  const sources = midi.tracks.map((events, source) => {
    let tick = 0;
    return events.map((event, order) => {
      tick += event.deltaTime;
      return { event, tick, source, order };
    });
  });
  const all = sources
    .flat()
    .sort(
      (a, b) => a.tick - b.tick || a.source - b.source || a.order - b.order,
    );
  const tempos = new Map<number, number>([[0, 120]]);
  const signatures = new Map<
    number,
    NonNullable<Project["timeSignatures"]>[number]
  >([[0, { tick: 0, numerator: 4, denominator: 4 }]]);
  const channelHasNotes = new Set(
    all.flatMap(({ event }) =>
      event.type === "noteOn" && event.velocity > 0 ? [event.channel] : [],
    ),
  );
  let id = 0;
  sources.forEach((events, source) => {
    const channels = [
      ...new Set(
        events.flatMap(({ event }) =>
          (event.type === "noteOn" && event.velocity > 0) ||
          ((event.type === "programChange" ||
            event.type === "pitchBend" ||
            (event.type === "controller" && event.controllerType === 64)) &&
            !channelHasNotes.has(event.channel))
            ? [event.channel]
            : [],
        ),
      ),
    ];
    const title = events.find(({ event }) => event.type === "trackName")?.event;
    const baseName =
      title?.type === "trackName" ? title.text : `Track ${source + 1}`;
    const parts = new Map<number, Track>();
    for (const channel of channels) {
      const track: Track = {
        id:
          channels.length === 1
            ? `track-${source}`
            : `track-${source}-ch-${channel + 1}`,
        name:
          channels.length === 1 ? baseName : `${baseName} · Ch ${channel + 1}`,
        gain: 0.7,
        muted: false,
        channel,
        program: 0,
      };
      if (channel === 9) track.drums = true;
      parts.set(channel, track);
      project.tracks.push(track);
    }
    const pending = new Map<string, Note[]>();
    for (const { event, tick } of events) {
      if (event.type !== "noteOn" && event.type !== "noteOff") continue;
      const track = parts.get(event.channel);
      if (!track) continue;
      const key = `${event.channel}:${event.noteNumber}`;
      if (event.type === "noteOn" && event.velocity > 0) {
        const note: Note = {
          id: `midi-${id++}`,
          trackId: track.id,
          pitch: event.noteNumber,
          velocity: event.velocity / 127,
          start: tick,
          duration: ppq / 4,
        };
        project.notes.push(note);
        const held = pending.get(key) ?? [];
        held.push(note);
        pending.set(key, held);
      } else {
        const note = pending.get(key)?.shift();
        if (note) note.duration = Math.max(1, tick - note.start);
      }
    }
  });
  const partsByChannel = new Map<number, Track[]>();
  for (const track of project.tracks) {
    const parts = partsByChannel.get(track.channel!) ?? [];
    parts.push(track);
    partsByChannel.set(track.channel!, parts);
  }
  const channelStateKey = (event: MidiEvent, tick: number) =>
    event.type === "programChange" ||
    event.type === "pitchBend" ||
    (event.type === "controller" && event.controllerType === 64)
      ? `${event.channel}:${event.type}:${tick}`
      : undefined;
  const lastState = new Map<string, (typeof all)[number]>();
  for (const entry of all) {
    const key = channelStateKey(entry.event, entry.tick);
    if (key) lastState.set(key, entry);
  }
  for (const entry of all) {
    const { event, tick } = entry;
    if (event.type === "setTempo")
      tempos.set(tick, 60000000 / event.microsecondsPerBeat);
    if (event.type === "timeSignature")
      signatures.set(tick, {
        tick,
        numerator: event.numerator,
        denominator: event.denominator,
        metronome: event.metronome,
        thirtyseconds: event.thirtyseconds,
      });
    if (
      event.type === "programChange" ||
      event.type === "pitchBend" ||
      (event.type === "controller" && event.controllerType === 64)
    ) {
      if (lastState.get(channelStateKey(event, tick)!) !== entry) continue;
      for (const track of partsByChannel.get(event.channel) ?? []) {
        if (event.type === "programChange") {
          if (tick === 0) track.program = event.programNumber;
          project.programChanges!.push({
            trackId: track.id,
            tick,
            program: event.programNumber,
          });
        } else if (event.type === "pitchBend")
          project.pitchBends!.push({
            trackId: track.id,
            tick,
            value: event.value,
          });
        else
          project.sustain!.push({
            trackId: track.id,
            tick,
            value: event.value,
          });
      }
    }
  }
  project.tempos = [...tempos].map(([tick, bpm]) => ({ tick, bpm }));
  project.timeSignatures = [...signatures.values()];
  if (!project.notes.length)
    throw new Error("This MIDI file contains no notes.");
  return validateProject(project);
}

type Event = { tick: number; event: MidiEvent };

export function importRiffMidi(bytes: Uint8Array, name: string): Project {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    new TextDecoder().decode(bytes.subarray(offset, offset + 4));
  if (
    bytes.length < 12 ||
    tag(0) !== "RIFF" ||
    tag(8) !== "RMID" ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    throw new Error("Invalid RIFF MIDI container.");
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length)
      throw new Error("Truncated RIFF MIDI chunk.");
    const length = view.getUint32(offset + 4, true);
    const next = offset + 8 + length + (length % 2);
    if (next > bytes.length) throw new Error("Truncated RIFF MIDI data.");
    if (tag(offset) === "data")
      return importMidi(bytes.subarray(offset + 8, offset + 8 + length), name);
    offset = next;
  }
  throw new Error("RIFF MIDI container has no data chunk.");
}

export async function exportRiffMidi(project: Project): Promise<Blob> {
  const midi = new Uint8Array(await exportMidi(project).arrayBuffer());
  const bytes = new Uint8Array(20 + midi.length + (midi.length % 2));
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("RMIDdata"), 8);
  view.setUint32(16, midi.length, true);
  bytes.set(midi, 20);
  return new Blob([bytes], { type: "audio/rmid" });
}

/** Independent melodic parts use independent channels, never wrap into percussion channel 10. */
export function exportMidi(input: Project): Blob {
  const project = validateProject(input);
  if (!Number.isInteger(project.ppq))
    throw new Error(
      "MIDI export requires an integer ticks-per-beat resolution.",
    );
  if (project.tempos.some((tempo) => 60000000 / tempo.bpm > 0xffffff))
    throw new Error(
      "MIDI cannot represent tempos below 3.58 BPM. Save the XR DAW project instead.",
    );
  const ordered = (events: Event[]): MidiEvent[] => {
    let previous = 0;
    const priority = (event: MidiEvent) =>
      event.type === "noteOn" ? 2 : event.type === "noteOff" ? 1 : 0;
    const result = events
      .sort((a, b) => a.tick - b.tick || priority(a.event) - priority(b.event))
      .map(({ tick, event }) => {
        tick = Math.round(tick);
        const next = { ...event, deltaTime: tick - previous };
        previous = tick;
        return next;
      });
    result.push({ type: "endOfTrack", deltaTime: 0, meta: true });
    return result;
  };
  const conductor: Event[] = project.tempos.map((tempo) => ({
    tick: tempo.tick,
    event: {
      type: "setTempo",
      deltaTime: 0,
      microsecondsPerBeat: Math.round(60000000 / tempo.bpm),
      meta: true,
    },
  }));
  for (const s of project.timeSignatures ?? [
    { tick: 0, numerator: 4, denominator: 4 },
  ])
    conductor.push({
      tick: s.tick,
      event: {
        type: "timeSignature",
        deltaTime: 0,
        meta: true,
        numerator: s.numerator,
        denominator: s.denominator,
        metronome: s.metronome ?? 24,
        thirtyseconds: s.thirtyseconds ?? 8,
      },
    });
  const tracks: MidiEvent[][] = [ordered(conductor)];
  const used = new Set<number>([9]);
  const allocate = (preferred?: number) => {
    const channel =
      preferred !== undefined && !used.has(preferred)
        ? preferred
        : Array.from({ length: 16 }, (_, i) => i).find((i) => !used.has(i));
    if (channel === undefined)
      throw new Error(
        "MIDI export needs more than 15 independent melodic channels, including overlapping unisons. Save the XR DAW project instead.",
      );
    used.add(channel);
    return channel;
  };
  let drumControllers: string | undefined;
  for (const track of project.tracks) {
    const programs = (project.programChanges ?? []).filter(
      (e) => e.trackId === track.id,
    );
    const sustain = (project.sustain ?? []).filter(
      (e) => e.trackId === track.id,
    );
    const bends = (project.pitchBends ?? []).filter(
      (e) => e.trackId === track.id,
    );
    if (track.drums) {
      const key = JSON.stringify([
        programs.map(({ tick, program }) => ({ tick, program })),
        sustain.map(({ tick, value }) => ({ tick, value })),
        bends.map(({ tick, value }) => ({ tick, value })),
      ]);
      if (drumControllers !== undefined && drumControllers !== key)
        throw new Error(
          "Percussion parts share MIDI channel 10. Their controller maps must match, or save an XR DAW project instead.",
        );
      drumControllers = key;
    }
    const events: Event[] = [
      {
        tick: 0,
        event: {
          type: "trackName",
          text: track.name,
          deltaTime: 0,
          meta: true,
        },
      },
    ];
    const lanes: { channel: number; held: Map<number, number> }[] = [];
    const addLane = () => {
      const channel = track.drums
        ? 9
        : allocate(lanes.length === 0 ? track.channel : undefined);
      const lane = { channel, held: new Map<number, number>() };
      lanes.push(lane);
      if (!programs.some((p) => p.tick === 0))
        events.push({
          tick: 0,
          event: {
            type: "programChange",
            channel,
            programNumber: track.program ?? 0,
            deltaTime: 0,
          },
        });
      for (const p of programs)
        events.push({
          tick: p.tick,
          event: {
            type: "programChange",
            channel,
            programNumber: p.program,
            deltaTime: 0,
          },
        });
      for (const p of sustain)
        events.push({
          tick: p.tick,
          event: {
            type: "controller",
            channel,
            controllerType: 64,
            value: p.value,
            deltaTime: 0,
          },
        });
      for (const p of bends)
        events.push({
          tick: p.tick,
          event: { type: "pitchBend", channel, value: p.value, deltaTime: 0 },
        });
      return lane;
    };
    for (const note of project.notes
      .filter((n) => n.trackId === track.id && n.velocity > 0)
      .sort((a, b) => a.start - b.start)) {
      const start = Math.round(note.start),
        end = Math.max(start + 1, Math.round(note.start + note.duration));
      let lane = lanes.find((l) => (l.held.get(note.pitch) ?? -1) <= start);
      if (!lane) {
        if (track.drums && lanes.length)
          throw new Error(
            "Overlapping percussion unisons share MIDI channel 10. Save the XR DAW project instead.",
          );
        lane = addLane();
      }
      lane.held.set(note.pitch, end);
      events.push(
        {
          tick: start,
          event: {
            type: "noteOn",
            channel: lane.channel,
            noteNumber: note.pitch,
            velocity: Math.max(1, Math.round(note.velocity * 127)),
            deltaTime: 0,
          },
        },
        {
          tick: end,
          event: {
            type: "noteOff",
            channel: lane.channel,
            noteNumber: note.pitch,
            velocity: 0,
            deltaTime: 0,
          },
        },
      );
    }
    if (!lanes.length) addLane();
    tracks.push(ordered(events));
  }
  return new Blob(
    [
      Uint8Array.from(
        writeMidi({
          header: {
            format: 1,
            numTracks: tracks.length,
            ticksPerBeat: project.ppq,
          },
          tracks,
        }),
      ).buffer,
    ],
    { type: "audio/midi" },
  );
}
