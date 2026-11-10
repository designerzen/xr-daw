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
  const end = project.notes.reduce(
    (end, n) => Math.max(end, n.start + n.duration),
    project.ppq * 4,
  );
  return Math.ceil(end / (project.ppq * 4)) * project.ppq * 4;
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

export function snapTick(tick: number, ppq: number): number {
  const step = ppq / 4;
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
      typeof t.muted !== "boolean"
    )
      throw new Error("Invalid track.");
    tracks.add(t.id);
  }
  const ids = new Set<string>();
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
  selectedId: string | null = null;
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
  select(id: string | null) {
    this.selectedId = id;
    this.emit();
  }
  get selected() {
    return this.project.notes.find((n) => n.id === this.selectedId);
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
    this.selectedId = null;
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
