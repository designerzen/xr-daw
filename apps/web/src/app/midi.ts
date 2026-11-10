import { parseMidi } from "midi-file";
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
