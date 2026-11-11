import { AudioEngine } from "./audio";
import { ClipPlayer, type AudioClip } from "./clip-player";
import { ProjectStore, projectEnd, snapTick, type Project } from "./project";

export const ALL_TRACKS = "*";
const MIN_PITCH_ROWS = 24;

export class Session {
  readonly store: ProjectStore;
  readonly audio = new AudioEngine();
  readonly clipPlayer = new ClipPlayer();
  pageTick = 0;
  followPlayback = true;
  viewSpan: 4 | 16 | "song" = 4;
  basePitch = 48;
  pitchRows = 36;
  /** The active track receives new notes and the track controls; others may still be shown. */
  trackId: string;
  allTracks = true;
  view: "notes" | "velocity" | "waveform" = "notes";
  private listeners = new Set<() => void>();
  private revision = 0;
  private unsubscribe: () => void;
  onError: (error: unknown) => void = console.error;

  constructor(project: Project) {
    this.store = new ProjectStore(project);
    this.trackId = project.tracks[0]?.id ?? "";
    this.fitPitch();
    this.unsubscribe = this.store.subscribe(() => {
      // Selecting a note while every track is shown makes its track the active one.
      const selected = this.store.selected;
      if (selected && selected.trackId !== this.trackId)
        this.trackId = selected.trackId;
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
  setView(view: "notes" | "velocity" | "waveform") {
    if (view === "waveform" && !this.clipPlayer.clip) return;
    if (this.view === view) return;
    if ((view === "waveform") !== (this.view === "waveform")) this.pause();
    this.view = view;
    this.emit();
  }
  get playing() {
    return this.view === "waveform"
      ? this.clipPlayer.playing
      : this.audio.playing;
  }
  pause() {
    this.audio.pause();
    this.clipPlayer.pause();
  }
  loadClip(clip: AudioClip) {
    this.pause();
    this.clipPlayer.load(clip);
    this.view = "waveform";
    this.store.select(null);
    this.emit();
  }
  get pageSize() {
    return this.viewSpan === "song"
      ? projectEnd(this.store.project)
      : this.store.project.ppq * this.viewSpan * 4;
  }
  setViewSpan(span: 4 | 16 | "song") {
    this.viewSpan = span;
    this.pageTick = Math.floor(this.pageTick / this.pageSize) * this.pageSize;
    this.fitPitch();
    this.emit();
  }
  get track() {
    return this.store.project.tracks.find((t) => t.id === this.trackId);
  }
  get trackIndex() {
    return new Map(this.store.project.tracks.map((t, i) => [t.id, i]));
  }
  private get shownNotes() {
    return this.allTracks
      ? this.store.project.notes
      : this.store.project.notes.filter((n) => n.trackId === this.trackId);
  }
  get visibleNotes() {
    return this.shownNotes.filter(
      (n) =>
        n.start < this.pageTick + this.pageSize &&
        n.start + n.duration > this.pageTick &&
        n.pitch >= this.basePitch &&
        n.pitch < this.basePitch + this.pitchRows,
    );
  }
  /** Size the pitch axis to every shown note in the song, so paging never hides a part. */
  fitPitch() {
    const pitches = this.shownNotes.map((n) => n.pitch);
    if (!pitches.length) {
      this.pitchRows = 36;
      this.basePitch = 48;
      return;
    }
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    this.pitchRows = Math.min(
      128,
      Math.max(MIN_PITCH_ROWS, Math.ceil((high - low + 5) / 12) * 12),
    );
    this.basePitch = Math.max(
      0,
      Math.min(
        128 - this.pitchRows,
        low - Math.floor((this.pitchRows - (high - low + 1)) / 2),
      ),
    );
  }
  load(project: Project) {
    this.audio.stop();
    this.clipPlayer.stop();
    this.view = "notes";
    this.pageTick = 0;
    this.followPlayback = true;
    this.trackId = project.tracks[0]?.id ?? "";
    this.allTracks = true;
    this.store.replace(project);
    this.fitPitch();
    this.emit();
  }
  selectTrack(id: string) {
    this.allTracks = id === ALL_TRACKS;
    if (!this.allTracks) this.trackId = id;
    this.store.select(null);
    this.fitPitch();
    this.emit();
  }
  page(direction: number) {
    this.goToPage(this.pageTick / this.pageSize + direction);
  }
  goToPage(index: number) {
    if (this.view === "waveform") return;
    if (!Number.isFinite(index)) return;
    const finalPage =
      Math.floor((projectEnd(this.store.project) - 1) / this.pageSize) *
      this.pageSize;
    this.pageTick = Math.max(
      0,
      Math.min(finalPage, Math.round(index) * this.pageSize),
    );
    this.followPlayback = false;
    this.fitPitch();
    this.emit();
  }
  toggleFollow() {
    this.followPlayback = !this.followPlayback;
    this.followPlayhead();
    this.emit();
  }
  followPlayhead() {
    if (!this.followPlayback || !this.audio.playing || this.view === "waveform")
      return;
    const tick = Math.min(
      projectEnd(this.store.project) - 1,
      this.audio.positionTick,
    );
    const page = Math.floor(tick / this.pageSize) * this.pageSize;
    if (page === this.pageTick) return;
    this.pageTick = page;
    this.fitPitch();
    this.emit();
  }
  scrollPitch(direction: number) {
    if (this.view === "waveform") return;
    this.basePitch = Math.max(
      0,
      Math.min(128 - this.pitchRows, this.basePitch + direction * 12),
    );
    this.emit();
  }
  async togglePlay() {
    if (this.view === "waveform") {
      if (this.clipPlayer.playing) this.clipPlayer.pause();
      else await this.clipPlayer.play();
    } else if (this.audio.playing) this.audio.pause();
    else {
      this.followPlayback = true;
      await this.audio.play(this.store.project);
      this.followPlayhead();
    }
    this.emit();
  }
  stop() {
    this.audio.stop();
    this.clipPlayer.stop();
    this.followPlayback = true;
    this.emit();
  }
  resize(direction: number) {
    if (this.view === "waveform") return;
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
    if (this.view === "waveform") return;
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
    if (this.view === "waveform") return;
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
    if (this.view === "waveform") return;
    if (!this.store.selectedId) return;
    this.store.edit((p) => {
      p.notes = p.notes.filter((n) => n.id !== this.store.selectedId);
    });
    this.store.select(null);
  }
  dispose() {
    this.unsubscribe();
    this.audio.dispose();
    this.clipPlayer.dispose();
    this.listeners.clear();
  }
}
