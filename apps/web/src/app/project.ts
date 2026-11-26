import { barAt, tickAtBar } from "./meter";
/** Musical data is independent of the renderer and the audio graph. All times are ticks. */
export interface Note {
  id: string;
  trackId: string;
  pitch: number;
  velocity: number;
  start: number;
  duration: number;
}
export interface Track {
  id: string;
  name: string;
  gain: number;
  muted: boolean;
  solo?: boolean;
  /** Zero-based General MIDI program; absent in older projects means piano. */
  program?: number;
  drums?: boolean;
  /** Original zero-based MIDI channel; export remaps when independent parts conflict. */
  channel?: number;
}
export interface Tempo {
  tick: number;
  bpm: number;
}
export interface Project {
  version: 1;
  name: string;
  ppq: number;
  tempos: Tempo[];
  tracks: Track[];
  notes: Note[];
  loopRegion?: { start: number; end: number };
  timeSignatures?: TimeSignature[];
  sustain?: ValueEvent[];
  /** Signed MIDI wheel values: -8192 through 8191, with a two-semitone range. */
  pitchBends?: ValueEvent[];
  programChanges?: ProgramChange[];
}
export interface TimeSignature {
  tick: number;
  numerator: number;
  denominator: number;
  metronome?: number;
  thirtyseconds?: number;
}
export interface ValueEvent {
  trackId: string;
  tick: number;
  value: number;
}
export interface ProgramChange {
  trackId: string;
  tick: number;
  program: number;
}

export function trackAudible(project: Project, track: Track): boolean {
  return !track.muted && (!project.tracks.some((t) => t.solo) || !!track.solo);
}

export function trackHue(index: number): number {
  return (index * 0.618 + 0.55) % 1;
}

export function demoProject(): Project {
  const pitches = [
    60, 64, 67, 72, 67, 64, 62, 67, 71, 74, 71, 67, 60, 64, 67, 72,
  ];
  return {
    version: 1,
    name: "First session",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 110 }],
    tracks: [{ id: "track-1", name: "Keys", gain: 0.7, muted: false }],
    notes: pitches.map((pitch, i) => ({
      id: `note-${i}`,
      trackId: "track-1",
      pitch,
      velocity: 0.65,
      start: i * 240,
      duration: 210,
    })),
  };
}

export function projectEnd(project: Project): number {
  const expressionEnd = Math.max(
    0,
    ...[project.sustain, project.pitchBends, project.programChanges].map(
      (events) => events?.at(-1)?.tick ?? 0,
    ),
    project.timeSignatures?.at(-1)?.tick ?? 0,
  );
  const end = project.notes.reduce(
    (end, n) => Math.max(end, n.start + n.duration),
    Math.max(
      tickAtBar(project, 1),
      project.loopRegion?.end ?? 0,
      expressionEnd,
    ),
  );
  const bar = barAt(project, end);
  return Math.abs(bar.start - end) < 1e-7 ? end : bar.end;
}

export function tickToSeconds(project: Project, tick: number): number {
  let seconds = 0;
  for (let i = 0; i < project.tempos.length; i++) {
    const tempo = project.tempos[i];
    const end = Math.min(tick, project.tempos[i + 1]?.tick ?? tick);
    if (end > tempo.tick)
      seconds += (((end - tempo.tick) / project.ppq) * 60) / tempo.bpm;
    if (end >= tick) break;
  }
  return seconds;
}

export function secondsToTick(project: Project, seconds: number): number {
  let remaining = Math.max(0, seconds);
  for (let i = 0; i < project.tempos.length; i++) {
    const tempo = project.tempos[i];
    const secondsPerTick = 60 / tempo.bpm / project.ppq;
    const next = project.tempos[i + 1]?.tick ?? Infinity;
    const duration = (next - tempo.tick) * secondsPerTick;
    if (remaining <= duration) return tempo.tick + remaining / secondsPerTick;
    remaining -= duration;
  }
  return 0;
}

/** Round to the grid. The default grid is a sixteenth note: four steps per beat. */
export function snapTick(tick: number, ppq: number, division = 4): number {
  const step = division > 0 ? ppq / division : 1;
  return Math.max(0, Math.round(tick / step) * step);
}

export function validateProject(value: unknown): Project {
  const p = value as Project;
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    !finite(p.ppq) ||
    p.ppq < 1 ||
    p.ppq > 32767 ||
    !Array.isArray(p.tracks) ||
    !Array.isArray(p.notes) ||
    !Array.isArray(p.tempos) ||
    p.tracks.length > 256 ||
    p.notes.length > 100000 ||
    p.tempos.length === 0 ||
    p.tempos.length > 10000
  ) {
    throw new Error("Unsupported or invalid XR DAW project.");
  }
  const tracks = new Set<string>();
  for (const t of p.tracks) {
    if (
      !t ||
      typeof t.id !== "string" ||
      tracks.has(t.id) ||
      typeof t.name !== "string" ||
      !finite(t.gain) ||
      t.gain < 0 ||
      t.gain > 1 ||
      typeof t.muted !== "boolean" ||
      (t.solo !== undefined && typeof t.solo !== "boolean") ||
      (t.drums !== undefined && typeof t.drums !== "boolean") ||
      (t.channel !== undefined &&
        (!Number.isInteger(t.channel) || t.channel < 0 || t.channel > 15)) ||
      (t.program !== undefined &&
        (!Number.isInteger(t.program) || t.program < 0 || t.program > 127))
    )
      throw new Error("Invalid track.");
    tracks.add(t.id);
  }
  const ids = new Set<string>();
  if (p.timeSignatures !== undefined) {
    if (
      !Array.isArray(p.timeSignatures) ||
      !p.timeSignatures.length ||
      p.timeSignatures.length > 10000
    )
      throw new Error("Invalid time signature map.");
    p.timeSignatures.forEach((s, i) => {
      if (
        !s ||
        !finite(s.tick) ||
        (i ? s.tick <= p.timeSignatures![i - 1].tick : s.tick !== 0) ||
        !Number.isInteger(s.numerator) ||
        s.numerator < 1 ||
        s.numerator > 255 ||
        !Number.isInteger(s.denominator) ||
        s.denominator < 1 ||
        s.denominator > 128 ||
        (s.denominator & (s.denominator - 1)) !== 0 ||
        s.thirtyseconds === 0 ||
        [s.metronome, s.thirtyseconds].some(
          (v) => v !== undefined && (!Number.isInteger(v) || v < 0 || v > 255),
        )
      )
        throw new Error("Invalid time signature.");
    });
  }
  for (const [key, min, max] of [
    ["sustain", 0, 127],
    ["pitchBends", -8192, 8191],
    ["programChanges", 0, 127],
  ] as const) {
    const events = p[key];
    if (events === undefined) continue;
    if (!Array.isArray(events) || events.length > 100000)
      throw new Error("Invalid expression events.");
    events.forEach((event, i) => {
      if (!event) throw new Error(`Invalid ${key} event.`);
      const value =
        key === "programChanges"
          ? (event as ProgramChange).program
          : (event as ValueEvent).value;
      if (
        !event ||
        !tracks.has(event.trackId) ||
        !finite(event.tick) ||
        event.tick < 0 ||
        (i > 0 && event.tick < events[i - 1].tick) ||
        !Number.isInteger(value) ||
        value < min ||
        value > max
      )
        throw new Error(`Invalid ${key} event.`);
    });
  }
  if (
    p.loopRegion !== undefined &&
    (!p.loopRegion ||
      !finite(p.loopRegion.start) ||
      !finite(p.loopRegion.end) ||
      p.loopRegion.start < 0 ||
      p.loopRegion.end <= p.loopRegion.start)
  )
    throw new Error("Invalid loop region.");
  for (const n of p.notes) {
    if (
      !n ||
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      !tracks.has(n.trackId) ||
      !Number.isInteger(n.pitch) ||
      n.pitch < 0 ||
      n.pitch > 127 ||
      !finite(n.velocity) ||
      n.velocity < 0 ||
      n.velocity > 1 ||
      !finite(n.start) ||
      n.start < 0 ||
      !finite(n.duration) ||
      n.duration <= 0
    )
      throw new Error("Invalid note.");
    ids.add(n.id);
  }
  for (let i = 0; i < p.tempos.length; i++) {
    const t = p.tempos[i];
    if (
      !t ||
      !finite(t.tick) ||
      t.tick < 0 ||
      (i === 0 ? t.tick !== 0 : t.tick <= p.tempos[i - 1].tick) ||
      !finite(t.bpm) ||
      t.bpm < 1 ||
      t.bpm > 1000
    )
      throw new Error("Invalid tempo map.");
  }
  return structuredClone(p);
}

export class ProjectStore {
  project: Project;
  /** Selected note ids; the last one is the primary note the inspector shows. */
  selectedIds: string[] = [];
  revision = 0;
  private past: Project[] = [];
  private future: Project[] = [];
  private listeners = new Set<() => void>();

  constructor(project = demoProject()) {
    this.project = validateProject(project);
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  get selectedId() {
    return this.selectedIds.at(-1) ?? null;
  }
  select(id: string | null) {
    this.selectedIds = id ? [id] : [];
    this.emit();
  }
  selectMany(ids: string[]) {
    this.selectedIds = [...new Set(ids)];
    this.emit();
  }
  /** Add a note to the selection, or take it out if it is already there. */
  toggleSelected(id: string) {
    this.selectedIds = this.selectedIds.includes(id)
      ? this.selectedIds.filter((other) => other !== id)
      : [...this.selectedIds, id];
    this.emit();
  }
  isSelected(id: string) {
    return this.selectedIds.includes(id);
  }
  get selected() {
    return this.project.notes.find((n) => n.id === this.selectedId);
  }
  /** Selected notes that still exist; undo can remove notes out from under the selection. */
  get selectedNotes() {
    const ids = new Set(this.selectedIds);
    return this.project.notes.filter((n) => ids.has(n.id));
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  replace(project: Project) {
    this.project = validateProject(project);
    this.past = [];
    this.future = [];
    this.selectedIds = [];
    this.revision++;
    this.emit();
  }
  edit(change: (project: Project) => void) {
    const next = structuredClone(this.project);
    change(next);
    if (JSON.stringify(next) === JSON.stringify(this.project)) return;
    validateProject(next);
    this.past.push(this.project);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.project = next;
    this.revision++;
    this.emit();
  }
  updateNote(
    id: string,
    change: Partial<Pick<Note, "pitch" | "start" | "duration" | "velocity">>,
  ) {
    this.edit((p) => {
      const note = p.notes.find((n) => n.id === id);
      if (note) Object.assign(note, change);
    });
  }
  /** Change several notes as one undoable step. */
  updateNotes(ids: string[], change: (note: Note) => void) {
    const selected = new Set(ids);
    this.edit((p) => p.notes.filter((n) => selected.has(n.id)).forEach(change));
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.project);
    this.project = previous;
    this.revision++;
    this.emit();
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.project);
    this.project = next;
    this.revision++;
    this.emit();
  }
}
