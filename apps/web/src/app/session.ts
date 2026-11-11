import { AudioEngine } from "./audio";
import { ClipPlayer, type AudioClip } from "./clip-player";
import {
  ProjectStore,
  projectEnd,
  snapTick,
  type Note,
  type Project,
} from "./project";

export const ALL_TRACKS = "*";
const MIN_PITCH_ROWS = 24;
/** Pages flip a whole view at a time; scroll keeps the playhead centred and moves the music. */
export type TimelineMode = "pages" | "scroll";
/** Select picks and drags notes, Draw adds one wherever the board is clicked, Erase removes them. */
export type EditTool = "select" | "draw" | "erase";
/** Grid steps per beat: 1 is quarter notes, 4 sixteenths, 0 turns snapping off. */
export const GRID_DIVISIONS = [1, 2, 4, 8, 0] as const;
export type GridDivision = (typeof GRID_DIVISIONS)[number];

export class Session {
  readonly store: ProjectStore;
  readonly audio = new AudioEngine();
  readonly clipPlayer = new ClipPlayer();
  pageTick = 0;
  followPlayback = true;
  viewSpan: 4 | 16 | "song" = 4;
  timeline: TimelineMode = "pages";
  basePitch = 48;
  pitchRows = 36;
  /** The active track receives new notes and the track controls; others may still be shown. */
  trackId: string;
  allTracks = true;
  view: "notes" | "velocity" | "waveform" = "notes";
  tool: EditTool = "select";
  grid: GridDivision = 4;
  /** New notes take the length and velocity of the note last drawn, resized or picked. */
  drawLength: number;
  drawVelocity = 0.7;
  /** Copied notes, with starts relative to the earliest one. */
  clipboard: Note[] = [];
  private listeners = new Set<() => void>();
  private revision = 0;
  private unsubscribe: () => void;
  onError: (error: unknown) => void = console.error;

  constructor(project: Project) {
    this.store = new ProjectStore(project);
    this.drawLength = this.store.project.ppq;
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
  /** First tick on screen. In scroll mode it trails the playhead by half a view, within the song. */
  get viewStart() {
    if (this.timeline === "pages") return this.pageTick;
    const end = projectEnd(this.store.project);
    return Math.max(
      0,
      Math.min(
        end - this.pageSize,
        this.audio.positionTick - this.pageSize / 2,
      ),
    );
  }
  setTimeline(mode: TimelineMode) {
    if (this.timeline === mode) return;
    this.timeline = mode;
    if (mode === "pages") {
      // Land on the page holding the playhead, as Follow would.
      const tick = Math.min(
        projectEnd(this.store.project) - 1,
        this.audio.positionTick,
      );
      this.pageTick = Math.floor(tick / this.pageSize) * this.pageSize;
    }
    this.emit();
  }
  /** Move the song position; in scroll mode this is how the view moves. */
  async seekTo(tick: number) {
    if (this.view === "waveform" || !Number.isFinite(tick)) return;
    const end = projectEnd(this.store.project);
    await this.audio.seek(
      this.store.project,
      Math.max(0, Math.min(end - 1, tick)),
    );
    this.emit();
  }
  async playFromView() {
    if (this.view === "waveform") await this.clipPlayer.play(0);
    else if (this.timeline === "scroll")
      await this.audio.play(this.store.project, this.audio.positionTick);
    else await this.audio.play(this.store.project, this.pageTick);
    this.emit();
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
    return this.notesBetween(this.viewStart, this.viewStart + this.pageSize);
  }
  notesBetween(from: number, to: number) {
    return this.shownNotes.filter(
      (n) =>
        n.start < to &&
        n.start + n.duration > from &&
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
    this.drawLength = this.store.project.ppq;
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
    // Scrolling steps a quarter of the view, so the music stays in sight.
    if (this.timeline === "scroll")
      void this.seekTo(
        this.audio.positionTick + (direction * this.pageSize) / 4,
      ).catch(this.onError);
    else this.goToPage(this.pageTick / this.pageSize + direction);
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
    if (
      this.timeline === "scroll" ||
      !this.followPlayback ||
      !this.audio.playing ||
      this.view === "waveform"
    )
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
  setTool(tool: EditTool) {
    this.tool = tool;
    this.emit();
  }
  setGrid(grid: GridDivision) {
    this.grid = grid;
    this.emit();
  }
  /** One grid step in ticks; with snapping off, nudges and resizes still step a sixteenth. */
  get gridStep() {
    const ppq = this.store.project.ppq;
    return this.grid > 0 ? ppq / this.grid : ppq / 4;
  }
  snap(tick: number) {
    return snapTick(tick, this.store.project.ppq, this.grid);
  }
  /** Remember a note's shape for the next one drawn. */
  private remember(note: Note) {
    this.drawLength = note.duration;
    this.drawVelocity = note.velocity;
  }
  /** Pick a note. Additive picks toggle it; picking part of a group keeps the group for dragging. */
  pick(id: string, additive = false) {
    if (additive) this.store.toggleSelected(id);
    else if (this.store.isSelected(id))
      this.store.selectMany([
        ...this.store.selectedIds.filter((other) => other !== id),
        id,
      ]);
    else this.store.select(id);
    const note = this.store.selected;
    if (note) this.remember(note);
  }
  selectAll() {
    if (this.view === "waveform") return;
    this.store.selectMany(this.shownNotes.map((n) => n.id));
  }
  private get editable() {
    return this.view !== "waveform" && this.store.selectedNotes.length > 0;
  }
  resize(direction: number) {
    if (!this.editable) return;
    const step = this.gridStep;
    this.store.updateNotes(this.store.selectedIds, (note) => {
      note.duration = Math.max(
        step,
        Math.round((note.duration + direction * step) / step) * step,
      );
    });
    if (this.store.selected) this.remember(this.store.selected);
  }
  nudge(time: number, pitch: number) {
    if (!this.editable) return;
    this.move(time * this.gridStep, pitch);
  }
  /** Move the selection together, kept after the song's start and inside the MIDI pitch range. */
  move(ticks: number, pitch: number) {
    const notes = this.store.selectedNotes;
    if (!notes.length) return;
    const first = Math.min(...notes.map((n) => n.start));
    const low = Math.min(...notes.map((n) => n.pitch));
    const high = Math.max(...notes.map((n) => n.pitch));
    const offset = Math.max(-first, ticks);
    const shift = Math.max(-low, Math.min(127 - high, pitch));
    this.store.updateNotes(this.store.selectedIds, (note) => {
      note.start = this.snap(note.start + offset);
      note.pitch += shift;
    });
  }
  setVelocity(velocity: number) {
    if (!this.editable) return;
    this.store.updateNotes(this.store.selectedIds, (note) => {
      note.velocity = velocity;
    });
    this.drawVelocity = velocity;
  }
  /** Snap the selected notes' starts and ends to the grid. */
  quantize() {
    if (!this.editable) return;
    const ppq = this.store.project.ppq;
    const division = this.grid || 4;
    const step = ppq / division;
    this.store.updateNotes(this.store.selectedIds, (note) => {
      const start = snapTick(note.start, ppq, division);
      const end = snapTick(note.start + note.duration, ppq, division);
      note.start = start;
      note.duration = Math.max(step, end - start);
    });
  }
  /** Where pasted and added notes go: the playhead when it is in view, otherwise the view's start. */
  get insertTick() {
    const tick = this.audio.positionTick;
    const start = this.viewStart;
    return tick >= start && tick < start + this.pageSize
      ? this.snap(tick)
      : start;
  }
  private insert(notes: Omit<Note, "id">[]) {
    const ids = notes.map(() => crypto.randomUUID());
    this.store.edit((p) =>
      notes.forEach((note, i) => p.notes.push({ ...note, id: ids[i] })),
    );
    this.store.selectMany(ids);
    return ids;
  }
  /** Add a note on the active track, in the grid cell holding the tick. */
  drawNote(tick: number, pitch: number) {
    if (this.view === "waveform" || !this.trackId) return;
    const ppq = this.store.project.ppq;
    const step = this.grid > 0 ? ppq / this.grid : 1;
    return this.insert([
      {
        trackId: this.trackId,
        pitch: Math.max(0, Math.min(127, Math.round(pitch))),
        start: Math.max(0, Math.floor(tick / step) * step),
        duration: this.drawLength,
        velocity: this.drawVelocity,
      },
    ])[0];
  }
  addNote() {
    if (this.view === "waveform") return;
    this.drawNote(this.insertTick, Math.min(127, this.basePitch + 12));
  }
  erase(id: string) {
    if (this.view === "waveform") return;
    this.store.edit((p) => {
      p.notes = p.notes.filter((n) => n.id !== id);
    });
    this.store.selectMany(this.store.selectedIds.filter((s) => s !== id));
  }
  deleteNote() {
    if (!this.editable) return;
    const ids = new Set(this.store.selectedIds);
    this.store.edit((p) => {
      p.notes = p.notes.filter((n) => !ids.has(n.id));
    });
    this.store.select(null);
  }
  copy() {
    const notes = this.store.selectedNotes;
    if (this.view === "waveform" || !notes.length) return;
    const first = Math.min(...notes.map((n) => n.start));
    this.clipboard = notes.map((n) => ({ ...n, start: n.start - first }));
    this.emit();
  }
  cut() {
    if (!this.editable) return;
    this.copy();
    this.deleteNote();
  }
  paste() {
    if (this.view === "waveform" || !this.clipboard.length) return;
    const tracks = new Set(this.store.project.tracks.map((t) => t.id));
    const at = this.insertTick;
    this.insert(
      this.clipboard.map(({ id: _id, ...note }) => ({
        ...note,
        // Notes copied from a track that has since gone land on the active one.
        trackId: tracks.has(note.trackId) ? note.trackId : this.trackId,
        start: note.start + at,
      })),
    );
  }
  /** Repeat the selection straight after itself, rounded up to whole grid steps. */
  duplicate() {
    const notes = this.store.selectedNotes;
    if (this.view === "waveform" || !notes.length) return;
    const first = Math.min(...notes.map((n) => n.start));
    const last = Math.max(...notes.map((n) => n.start + n.duration));
    const step = this.grid > 0 ? this.store.project.ppq / this.grid : 1;
    const span = Math.ceil((last - first) / step) * step;
    this.insert(
      notes.map(({ id: _id, ...n }) => ({ ...n, start: n.start + span })),
    );
  }
  dispose() {
    this.unsubscribe();
    this.audio.dispose();
    this.clipPlayer.dispose();
    this.listeners.clear();
  }
}
