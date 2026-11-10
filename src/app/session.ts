import { AudioEngine } from "./audio";
import { ProjectStore, projectEnd, snapTick, type Project } from "./project";

export class Session {
  readonly store: ProjectStore;
  readonly audio = new AudioEngine();
  pageTick = 0;
  basePitch = 48;
  trackId: string;
  private listeners = new Set<() => void>();
  private revision = 0;
  private unsubscribe: () => void;
  onError: (error: unknown) => void = console.error;

  constructor(project: Project) {
    this.store = new ProjectStore(project);
    this.trackId = project.tracks[0]?.id ?? "";
    this.fitPitch();
    this.unsubscribe = this.store.subscribe(() => {
      if (this.revision !== this.store.revision) {
        this.revision = this.store.revision;
        if (this.audio.playing)
          void this.audio
            .play(this.store.project, this.audio.positionTick)
            .catch(this.onError);
      }
      this.emit();
    });
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((fn) => fn());
  }
  get pageSize() {
    return this.store.project.ppq * 16;
  }
  get track() {
    return this.store.project.tracks.find((t) => t.id === this.trackId);
  }
  get visibleNotes() {
    return this.store.project.notes.filter(
      (n) =>
        n.trackId === this.trackId &&
        n.start < this.pageTick + this.pageSize &&
        n.start + n.duration > this.pageTick &&
        n.pitch >= this.basePitch &&
        n.pitch <= this.basePitch + 35,
    );
  }
  fitPitch() {
    const pitches = this.store.project.notes
      .filter((n) => n.trackId === this.trackId)
      .map((n) => n.pitch)
      .sort((a, b) => a - b);
    this.basePitch = Math.max(
      0,
      Math.min(92, (pitches[Math.floor(pitches.length / 2)] ?? 60) - 18),
    );
  }
  load(project: Project) {
    this.audio.stop();
    this.pageTick = 0;
    this.trackId = project.tracks[0]?.id ?? "";
    this.store.replace(project);
    this.fitPitch();
    this.emit();
  }
  selectTrack(id: string) {
    this.trackId = id;
    this.store.select(null);
    this.fitPitch();
    this.emit();
  }
  page(direction: number) {
    const finalPage =
      Math.floor((projectEnd(this.store.project) - 1) / this.pageSize) *
      this.pageSize;
    this.pageTick = Math.max(
      0,
      Math.min(finalPage, this.pageTick + direction * this.pageSize),
    );
    this.emit();
  }
  scrollPitch(direction: number) {
    this.basePitch = Math.max(0, Math.min(92, this.basePitch + direction * 12));
    this.emit();
  }
  async togglePlay() {
    if (this.audio.playing) this.audio.pause();
    else await this.audio.play(this.store.project);
    this.emit();
  }
  stop() {
    this.audio.stop();
    this.emit();
  }
  resize(direction: number) {
    const note = this.store.selected;
    const step = this.store.project.ppq / 4;
    if (note)
      this.store.updateNote(note.id, {
        duration: Math.max(
          step,
          snapTick(note.duration + direction * step, this.store.project.ppq),
        ),
      });
  }
  nudge(time: number, pitch: number) {
    const note = this.store.selected;
    if (note)
      this.store.updateNote(note.id, {
        start: snapTick(
          note.start + (time * this.store.project.ppq) / 4,
          this.store.project.ppq,
        ),
        pitch: Math.max(0, Math.min(127, note.pitch + pitch)),
      });
  }
  addNote() {
    if (!this.trackId) return;
    const id = crypto.randomUUID();
    this.store.edit((p) =>
      p.notes.push({
        id,
        trackId: this.trackId,
        pitch: Math.min(127, this.basePitch + 12),
        start: this.pageTick,
        duration: p.ppq,
        velocity: 0.7,
      }),
    );
    this.store.select(id);
  }
  deleteNote() {
    if (!this.store.selectedId) return;
    this.store.edit((p) => {
      p.notes = p.notes.filter((n) => n.id !== this.store.selectedId);
    });
    this.store.select(null);
  }
  dispose() {
    this.unsubscribe();
    this.audio.dispose();
    this.listeners.clear();
  }
}
