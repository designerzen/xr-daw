import { projectEnd, type Note, type Project } from "./project";

function after<T extends { tick: number }>(events: T[], tick: number) {
  let low = 0,
    high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].tick <= tick) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Indexed once per immutable project revision, independent of frame rate. */
export class PerformanceMap {
  private sustain = new Map<string, NonNullable<Project["sustain"]>>();
  private bends = new Map<string, NonNullable<Project["pitchBends"]>>();
  private programs = new Map<string, NonNullable<Project["programChanges"]>>();
  private releases = new Map<string, NonNullable<Project["sustain"]>>();
  private projectEnd: number;
  private tracks: Map<string, Project["tracks"][number]>;
  constructor(readonly project: Project) {
    this.tracks = new Map(project.tracks.map((t) => [t.id, t]));
    this.projectEnd = projectEnd(project);
    for (const event of project.sustain ?? []) {
      const list = this.sustain.get(event.trackId) ?? [];
      list.push(event);
      this.sustain.set(event.trackId, list);
    }
    for (const event of project.pitchBends ?? []) {
      const list = this.bends.get(event.trackId) ?? [];
      list.push(event);
      this.bends.set(event.trackId, list);
    }
    for (const event of project.programChanges ?? []) {
      const list = this.programs.get(event.trackId) ?? [];
      list.push(event);
      this.programs.set(event.trackId, list);
    }
    for (const [id, events] of this.sustain)
      this.releases.set(
        id,
        events.filter((e) => e.value < 64),
      );
  }
  end(note: Note) {
    const release = note.start + note.duration;
    if (this.tracks.get(note.trackId)?.drums) return release;
    const pedal = this.sustain.get(note.trackId) ?? [];
    const state = pedal[after(pedal, release) - 1];
    if (!state || state.value < 64) return release;
    const releases = this.releases.get(note.trackId) ?? [];
    return Math.max(
      release,
      releases[after(releases, release)]?.tick ?? this.projectEnd,
    );
  }
  program(trackId: string, tick: number) {
    const events = this.programs.get(trackId) ?? [];
    return (
      events[after(events, tick) - 1]?.program ??
      this.tracks.get(trackId)?.program ??
      0
    );
  }
  pitch(trackId: string, from: number, to: number) {
    const events = this.bends.get(trackId) ?? [];
    const index = after(events, from);
    const end = after(events, to - 1e-7);
    return [
      { tick: from, value: events[index - 1]?.value ?? 0 },
      ...events.slice(index, Math.max(index, end)),
    ];
  }
}
