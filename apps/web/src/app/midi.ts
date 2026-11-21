import { parseMidi, writeMidi, type MidiEvent } from "midi-file";
import { validateProject, type Note, type Project } from "./project";

/** Per-track absolute ticks preserve simultaneous tracks and MIDI tempo changes. */
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
  };
  const tempos = new Map<number, number>([[0, 120]]);
  let id = 0;
  midi.tracks.forEach((events, index) => {
    const trackId = `track-${index}`;
    const track = {
      id: trackId,
      name: `Track ${index + 1}`,
      gain: 0.7,
      muted: false,
    };
    const pending = new Map<string, Note[]>();
    let tick = 0;
    for (const event of events) {
      tick += event.deltaTime;
      if (event.type === "trackName") track.name = event.text || track.name;
      if (event.type === "setTempo")
        tempos.set(tick, 60000000 / event.microsecondsPerBeat);
      if (event.type !== "noteOn" && event.type !== "noteOff") continue;
      const key = `${event.channel}:${event.noteNumber}`;
      if (event.type === "noteOn" && event.velocity > 0) {
        const note: Note = {
          id: `midi-${id++}`,
          trackId,
          pitch: event.noteNumber,
          velocity: event.velocity / 127,
          start: tick,
          duration: ppq / 4,
        };
        project.notes.push(note);
        pending.set(key, [...(pending.get(key) ?? []), note]);
      } else {
        const note = pending.get(key)?.shift();
        if (note) note.duration = Math.max(1, tick - note.start);
      }
    }
    if (project.notes.some((n) => n.trackId === trackId))
      project.tracks.push(track);
  });
  project.tempos = [...tempos]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, bpm]) => ({ tick, bpm }));
  if (!project.notes.length)
    throw new Error("This MIDI file contains no notes.");
  return validateProject(project);
}

/** Preserve the editable tick axis, tempo map, track names and velocities in SMF type 1. */
export function exportMidi(project: Project): Blob {
  if (!Number.isInteger(project.ppq))
    throw new Error(
      "MIDI export requires an integer ticks-per-beat resolution.",
    );
  if (project.tempos.some((tempo) => 60000000 / tempo.bpm > 0xffffff))
    throw new Error(
      "MIDI cannot represent tempos below 3.58 BPM. Save the XR DAW project instead.",
    );
  const ordered = (
    events: { tick: number; event: MidiEvent }[],
  ): MidiEvent[] => {
    let previous = 0;
    const result = events
      .sort(
        (a, b) =>
          a.tick - b.tick ||
          (a.event.type === "noteOff"
            ? -1
            : b.event.type === "noteOff"
              ? 1
              : 0),
      )
      .map(({ tick, event }) => {
        const next = { ...event, deltaTime: tick - previous };
        previous = tick;
        return next;
      });
    result.push({ type: "endOfTrack", deltaTime: 0, meta: true });
    return result;
  };
  const tracks = [
    ordered(
      project.tempos.map((tempo) => ({
        tick: Math.round(tempo.tick),
        event: {
          type: "setTempo",
          deltaTime: 0,
          microsecondsPerBeat: Math.round(60000000 / tempo.bpm),
          meta: true,
        },
      })),
    ),
  ];
  for (const [index, track] of project.tracks.entries()) {
    const lanes: Map<number, number>[] = [];
    const events: { tick: number; event: MidiEvent }[] = [
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
    for (const note of project.notes
      .filter((note) => note.trackId === track.id)
      .sort((a, b) => a.start - b.start)) {
      const start = Math.round(note.start),
        end = Math.max(start + 1, Math.round(note.start + note.duration));
      // Zero velocity means note-off in MIDI. Omit silent editor notes.
      if (note.velocity === 0) continue;
      let lane = lanes.findIndex(
        (held) => (held.get(note.pitch) ?? -1) <= start,
      );
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(new Map());
      }
      if (lane >= 16)
        throw new Error(
          "MIDI supports at most 16 overlapping notes at the same pitch per track. Save the XR DAW project instead.",
        );
      lanes[lane].set(note.pitch, end);
      const channel = (index + lane) % 16;
      events.push(
        {
          tick: start,
          event: {
            type: "noteOn",
            channel,
            noteNumber: note.pitch,
            velocity: Math.max(1, Math.round(note.velocity * 127)),
            deltaTime: 0,
          },
        },
        {
          tick: end,
          event: {
            type: "noteOff",
            channel,
            noteNumber: note.pitch,
            velocity: 0,
            deltaTime: 0,
          },
        },
      );
    }
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
