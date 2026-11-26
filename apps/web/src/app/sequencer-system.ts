import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  DistanceGrabbable,
  DirectionalLight,
  DoubleSide,
  Entity,
  Grabbed,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MovementMode,
  Plane,
  PlaneGeometry,
  RayInteractable,
  Sprite,
  SpriteMaterial,
  UIKitMLAsset,
  Vector3,
} from "@iwsdk/core";
import { NoteView } from "./components";
import { projectEnd, snapTick, trackHue, type Note } from "./project";
import { GENERAL_MIDI_INSTRUMENT_NAMES as INSTRUMENT_NAMES } from "audiobus/midi/general-midi-instrument-constants.ts";
import { ALL_TRACKS, GRID_DIVISIONS, Session } from "./session";
import { MAX_NOTE_DEPTH, noteDepth } from "./note-depth";
import { OUTPUT_MODES } from "./output-history";
import { barAt, tickAtBar } from "./meter";
import {
  actionCue,
  interactionFeedback as feedback,
  type FeedbackCue,
} from "./interaction-feedback";

const LEFT = -1.6;
const WIDTH = 3.2;
const BOTTOM = 0.95;
const HEIGHT = 1.26;
const Z = -2.1;
/** World-space placement of the note board, shared with the desktop camera fit. */
export const BOARD = {
  left: LEFT,
  width: WIDTH,
  bottom: BOTTOM,
  height: HEIGHT,
  z: Z,
};
const SELECTED = new Color(0x31405c);
const glowGeometry = new BoxGeometry(1, 1, 1);
type Modifiers = { ctrlKey?: boolean; metaKey?: boolean; buttons?: number };

function label(text: string, x: number, y: number, width = 0.4) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#b9c7df";
  ctx.font = "36px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 62);
  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(
    new SpriteMaterial({ map: texture, depthTest: false }),
  );
  sprite.position.set(x, y, Z + 0.02);
  sprite.scale.set(width, (width * 96) / 512, 1);
  return sprite;
}

/** IWSDK owns pointer/grab tracking; only committed musical edits enter history. */
export function sequencerSystem(session: Session) {
  return class SequencerSystem extends createSystem({
    notes: { required: [NoteView] },
  }) {
    private noteEntities: Entity[] = [];
    private decorations: Entity[] = [];
    private dragging = new Map<
      Entity,
      { note: Note; x: number; y: number; cell?: string }
    >();
    // The board under the notes takes Draw and Erase strokes.
    private board?: Mesh;
    private hover: { tick: number; pitch: number } | null = null;
    private ghost = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({
        color: 0xd8e8e2,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    private dirty = true;
    private revision = -1;
    private viewKey = "";
    private viewPivot = new Group();
    private content = new Group();
    private contentEntity!: Entity;
    // Everything placed in time lives on this strip, which slides past the playhead.
    private strip = new Group();
    private stripEntity!: Entity;
    private stripStart = 0;
    private stripLength = 0;
    private timelineLabel = "";
    // World planes at the board's time edges. Labels get a little room to overhang.
    private clip = [
      new Plane(new Vector3(1, 0, 0), -LEFT),
      new Plane(new Vector3(-1, 0, 0), LEFT + WIDTH),
    ];
    private labelClip = [
      new Plane(new Vector3(1, 0, 0), -(LEFT - 0.2)),
      new Plane(new Vector3(-1, 0, 0), LEFT + WIDTH + 0.2),
    ];
    // A sheet through the whole velocity depth, so it reads from any camera angle.
    private playhead = new Mesh(
      new PlaneGeometry(MAX_NOTE_DEPTH + 0.1, HEIGHT),
      new MeshBasicMaterial({
        color: 0x9fd0ff,
        transparent: true,
        opacity: 0.22,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    private floor = new GridHelper(20, 40, 0x27374f, 0x1b2638);
    private backdrop = new Color("#10151f");
    private passthrough = false;
    private playheadEdge = new Mesh(
      new BoxGeometry(0.006, HEIGHT, 0.006),
      new MeshBasicMaterial({ color: 0xffffff }),
    );

    init() {
      // Rotate the data, never the headset. Local musical coordinates stay unchanged.
      this.viewPivot.name = "Sequencer view";
      this.viewPivot.position.set(
        0,
        BOTTOM + HEIGHT / 2,
        Z + MAX_NOTE_DEPTH / 2,
      );
      this.content.position.copy(this.viewPivot.position).negate();
      const pivotEntity = this.world.createTransformEntity(this.viewPivot);
      this.contentEntity = this.world.createTransformEntity(
        this.content,
        pivotEntity,
      );
      this.strip.name = "Timeline strip";
      this.strip.userData.fitIgnore = true;
      this.stripEntity = this.world.createTransformEntity(
        this.strip,
        this.contentEntity,
      );
      this.world.renderer.localClippingEnabled = true;
      this.scene.background = this.backdrop;
      const ambient = new AmbientLight(0xffffff, 0.9);
      const light = new DirectionalLight(0xffffff, 2.2);
      light.position.set(-3, 5, 2);
      this.scene.add(ambient, light);
      this.floor.position.y = -0.02;
      this.scene.add(this.floor);
      this.playhead.position.set(
        LEFT,
        BOTTOM + HEIGHT / 2,
        Z + (MAX_NOTE_DEPTH + 0.1) / 2,
      );
      this.playhead.rotation.y = Math.PI / 2;
      // The plane is turned side-on, so its local x axis runs along scene depth.
      this.playheadEdge.position.x = -(MAX_NOTE_DEPTH + 0.1) / 2;
      this.playhead.add(this.playheadEdge);
      this.content.add(this.playhead);
      this.ghost.name = "Draw preview";
      this.ghost.visible = false;
      this.ghost.raycast = () => {};
      this.content.add(this.ghost);
      this.cleanupFuncs.push(
        session.subscribe(() => {
          this.dirty = true;
        }),
      );
      const panel = this.world.requireSceneObject<UIKitMLAsset>("transport");
      panel.document.setTargetDimensions(1.15, 0.6);
      const advanced = panel.requireElementById("advanced");
      let expanded = false;
      const toggleOptions = () => {
        expanded = !expanded;
        advanced.setProperties({ display: expanded ? "flex" : "none" });
      };
      const bindButton = (id: string, action: () => void) => {
        const button = panel.requireElementById(id);
        let pointerActivation = false;
        let held = false;
        let cue: FeedbackCue = "press";
        const chooseCue = () => {
          if (id === "more") return expanded ? "close" : "open";
          const active: Record<string, boolean | undefined> = {
            play: session.playing,
            loop: session.audio.loop,
            follow: session.followPlayback,
            scroll: session.timeline === "scroll",
            "track-mute": session.track?.muted,
            "track-solo": session.track?.solo,
            "track-drums": session.track?.drums,
            metronome: session.audio.metronome,
            "count-in": session.audio.countIn,
            vinyl: session.clipPlayer.vinylEnabled,
            "feedback-enabled": !feedback.muted,
          };
          return actionCue(id, active[id]);
        };
        const down = () => {
          pointerActivation = held = true;
          cue = chooseCue();
          feedback.play(cue);
        };
        const up = () => {
          if (held) feedback.play(cue, "up");
          held = false;
        };
        const cancel = () => {
          if (held) feedback.play("back");
          pointerActivation = held = false;
        };
        const enter = () => feedback.play("hover", "up");
        const click = () => {
          if (!pointerActivation) feedback.play(chooseCue());
          pointerActivation = false;
          action();
        };
        for (const [type, listener] of [
          ["pointerdown", down],
          ["pointerup", up],
          ["pointercancel", cancel],
          ["pointerenter", enter],
          ["click", click],
        ] as const) {
          button.addEventListener(type, listener);
          this.cleanupFuncs.push(() =>
            button.removeEventListener(type, listener),
          );
        }
      };
      bindButton("more", toggleOptions);
      this.cleanupFuncs.push(
        feedback.subscribe(() => {
          this.dirty = true;
        }),
      );
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe((value) => {
          panel.visible = value !== "non-immersive";
        }),
      );
      const actions: Record<string, () => void> = {
        meter: () => {
          const meter = barAt(
            session.store.project,
            session.audio.positionTick,
          );
          const choices = [
            [4, 4],
            [3, 4],
            [6, 8],
            [5, 4],
            [7, 8],
          ];
          const index = choices.findIndex(
            ([n, d]) => n === meter.numerator && d === meter.denominator,
          );
          const [n, d] = choices[(index + 1) % choices.length];
          session.setTimeSignature(n, d);
        },
        "feedback-enabled": () => {
          feedback.configure({ muted: !feedback.muted });
          if (!feedback.muted) feedback.play("on");
        },
        "feedback-quieter": () =>
          feedback.configure({ volume: feedback.volume - 0.1 }),
        "feedback-louder": () => {
          feedback.configure({ volume: feedback.volume + 0.1 });
          feedback.play("adjust");
        },
        play: () => {
          void session.togglePlay().catch(session.onError);
        },
        stop: () => session.stop(),
        "view-notes": () => session.setView("notes"),
        "view-velocity": () => session.setView("velocity"),
        "view-waveform": () => session.setView("waveform"),
        "output-mode": () => session.cycleOutputMode(),
        "output-choice": () => session.cycleOutputChoice(),
        "output-toggle": () => session.toggleOutputMode(session.outputChoice),
        "output-clear": () => session.setOutputMode("off"),
        vinyl: () => {
          if (session.view !== "waveform" || session.clipPlayer.vinylBusy)
            return;
          const operation = session.clipPlayer.configureVinyl(
            !session.clipPlayer.vinylEnabled,
          );
          session.emit();
          void operation.catch(session.onError).finally(() => session.emit());
        },
        condition: () => {
          if (session.view !== "waveform" || session.clipPlayer.vinylBusy)
            return;
          const conditions = ["clean", "worn", "damaged"] as const;
          const next =
            conditions[
              (conditions.indexOf(session.clipPlayer.vinylCondition) + 1) %
                conditions.length
            ];
          const operation = session.clipPlayer.configureVinyl(true, next);
          session.emit();
          void operation.catch(session.onError).finally(() => session.emit());
        },
        previous: () => session.page(-1),
        next: () => session.page(1),
        follow: () => session.toggleFollow(),
        scroll: () =>
          session.setTimeline(
            session.timeline === "scroll" ? "pages" : "scroll",
          ),
        span: () =>
          session.setViewSpan(
            session.viewSpan === 4 ? 16 : session.viewSpan === 16 ? "song" : 4,
          ),
        shorter: () => session.resize(-1),
        longer: () => session.resize(1),
        undo: () => {
          if (session.view !== "waveform") session.store.undo();
        },
        redo: () => {
          if (session.view !== "waveform") session.store.redo();
        },
        exit: () => this.world.exitXR(),
        lower: () => session.scrollPitch(-1),
        higher: () => session.scrollPitch(1),
        add: () => session.addNote(),
        delete: () => session.deleteNote(),
        tool: () => {
          const tools = ["select", "draw", "erase"] as const;
          session.setTool(tools[(tools.indexOf(session.tool) + 1) % 3]);
        },
        grid: () => {
          const index = GRID_DIVISIONS.indexOf(session.grid);
          session.setGrid(GRID_DIVISIONS[(index + 1) % GRID_DIVISIONS.length]);
        },
        copy: () => session.copy(),
        paste: () => session.paste(),
        duplicate: () => session.duplicate(),
        quantize: () => session.quantize(),
        "select-all": () => session.selectAll(),
        seek: () => {
          void session.playFromView().catch(session.onError);
        },
        track: () => {
          // Cycle All tracks -> each track -> All tracks.
          const ids = [
            ALL_TRACKS,
            ...session.store.project.tracks.map((t) => t.id),
          ];
          const current = session.allTracks ? ALL_TRACKS : session.trackId;
          session.selectTrack(ids[(ids.indexOf(current) + 1) % ids.length]);
        },
        loop: () => session.setLoop(!session.audio.loop),
        "loop-view": () => {
          if (session.view !== "waveform") session.loopView();
        },
        "loop-selection": () => {
          if (session.view !== "waveform") session.loopSelection();
        },
        metronome: () => {
          session.audio.metronome = !session.audio.metronome;
          session.emit();
        },
        "count-in": () => {
          session.audio.countIn = !session.audio.countIn;
          session.emit();
        },
        "track-mute": () =>
          session.updateTrack(session.trackId, {
            muted: !session.track?.muted,
          }),
        "track-solo": () =>
          session.updateTrack(session.trackId, { solo: !session.track?.solo }),
        "track-drums": () =>
          session.updateTrack(session.trackId, {
            drums: !session.track?.drums,
          }),
        "track-sound": () => {
          const programs = [0, 4, 16, 24, 32, 48, 56, 73, 80, 88];
          const current = programs.indexOf(session.track?.program ?? 0);
          session.updateTrack(session.trackId, {
            program: programs[(current + 1) % programs.length],
          });
        },
        "track-quieter": () =>
          session.updateTrack(session.trackId, {
            gain: Math.max(0, (session.track?.gain ?? 0.7) - 0.1),
          }),
        "track-louder": () =>
          session.updateTrack(session.trackId, {
            gain: Math.min(1, (session.track?.gain ?? 0.7) + 0.1),
          }),
      };
      for (const [id, action] of Object.entries(actions)) {
        bindButton(id, action);
      }
      this.cleanupFuncs.push(() => {
        this.scene.remove(ambient, light);
        this.scene.remove(this.floor);
        this.floor.geometry.dispose();
        this.floor.material.dispose();
        this.playhead.geometry.dispose();
        this.playhead.material.dispose();
        this.playheadEdge.geometry.dispose();
        this.playheadEdge.material.dispose();
        this.ghost.geometry.dispose();
        this.ghost.material.dispose();
      });
    }

    private decorate() {
      this.decorations.forEach((entity) => entity.dispose());
      this.decorations = [];
      const add = (object: Mesh | Sprite, parent = this.contentEntity) => {
        const entity = this.world.createTransformEntity(object, parent);
        this.decorations.push(entity);
        return entity;
      };
      const board = new Mesh(
        new BoxGeometry(WIDTH + 0.03, HEIGHT + 0.03, 0.025),
        new MeshBasicMaterial({ color: 0x182232 }),
      );
      board.name = "Note board";
      board.position.set(0, BOTTOM + HEIGHT / 2, Z - 0.035);
      add(board).addComponent(RayInteractable);
      this.board = board;
      board.addEventListener("pointerdown", (event) => {
        if (session.view !== "notes" || session.tool !== "draw") return;
        const cell = this.cellAt(event.point);
        if (!cell) return;
        event.stopPropagation();
        feedback.play("create");
        session.drawNote(cell.tick, cell.pitch);
        this.audition();
      });
      board.addEventListener("pointermove", (event) => {
        this.hover = this.cellAt(event.point);
      });
      board.addEventListener("pointerleave", () => {
        this.hover = null;
      });
      const velocityAxis = new Mesh(
        new BoxGeometry(0.003, 0.003, MAX_NOTE_DEPTH),
        new MeshBasicMaterial({ color: 0x546581 }),
      );
      velocityAxis.position.set(
        LEFT - 0.06,
        BOTTOM - 0.06,
        Z + MAX_NOTE_DEPTH / 2,
      );
      add(velocityAxis);
      for (const value of [0, 0.5, 1]) {
        const tick = new Mesh(
          new BoxGeometry(0.025, 0.003, 0.003),
          new MeshBasicMaterial({ color: 0x546581 }),
        );
        tick.position.set(
          LEFT - 0.06,
          BOTTOM - 0.06,
          Z + value * MAX_NOTE_DEPTH,
        );
        add(tick);
      }
      const velocityLabel = label("Velocity", LEFT - 0.06, BOTTOM - 0.13, 0.25);
      velocityLabel.position.z = Z + MAX_NOTE_DEPTH / 2;
      add(velocityLabel);
      // Grid density follows the visible span; the strip may hold several spans.
      const project = session.store.project;
      const firstBar = barAt(project, this.stripStart).index;
      const lastBar = barAt(project, this.stripStart + this.stripLength).index;
      const majorStep = Math.max(1, Math.ceil((lastBar - firstBar) / 16));
      const gridLine = (tick: number, major: boolean) => {
        const line = new Mesh(
          new BoxGeometry(0.002, HEIGHT, 0.002),
          new MeshBasicMaterial({
            color: major ? 0x546581 : 0x28364b,
            clippingPlanes: this.clip,
          }),
        );
        line.position.set(this.stripX(tick), BOTTOM + HEIGHT / 2, Z - 0.015);
        line.userData.tick = tick;
        add(line, this.stripEntity);
        return line;
      };
      for (let index = firstBar; index <= lastBar; index += majorStep) {
        const tick = tickAtBar(project, index);
        const meter = barAt(project, tick);
        const line = gridLine(tick, true);
        const bar = label(
          `Bar ${index + 1}${meter.tick === tick ? ` · ${meter.numerator}/${meter.denominator}` : ""}`,
          line.position.x,
          2.29,
        );
        bar.material.clippingPlanes = this.labelClip;
        bar.userData.tick = tick;
        add(bar, this.stripEntity);
        if (majorStep === 1 && lastBar - firstBar <= 16) {
          const step = Math.max(1, Math.ceil(meter.numerator / 16));
          for (
            let beat = step;
            beat < meter.numerator && tick + beat * meter.beatTicks < meter.end;
            beat += step
          )
            gridLine(tick + beat * meter.beatTicks, false);
        }
      }
      const row = HEIGHT / session.pitchRows;
      for (let pitch = 0; pitch <= session.pitchRows; pitch++) {
        const octave = (session.basePitch + pitch) % 12 === 0;
        // Dense keyboards keep only the octave lines so notes stay readable.
        if (!octave && session.pitchRows > 60) continue;
        const line = new Mesh(
          new BoxGeometry(WIDTH, 0.001, 0.002),
          new MeshBasicMaterial({ color: octave ? 0x546581 : 0x273449 }),
        );
        line.position.set(0, BOTTOM + pitch * row, Z - 0.015);
        add(line);
        if (octave)
          add(
            label(
              `C${Math.floor((session.basePitch + pitch) / 12) - 1}`,
              LEFT - 0.12,
              line.position.y + Math.max(row, 0.02) / 2,
              0.15,
            ),
          );
      }
      add(
        label(
          `${session.allTracks ? "All tracks" : (session.track?.name ?? "No track")} · ${session.basePitch}–${session.basePitch + session.pitchRows - 1}`,
          0,
          2.4,
          1.5,
        ),
      );
    }

    /** The time and pitch on screen at a world point, or null outside the keyboard. */
    private cellAt(point: Vector3) {
      const local = this.content.worldToLocal(point.clone());
      const pitch =
        session.basePitch +
        Math.floor(((local.y - BOTTOM) / HEIGHT) * session.pitchRows);
      if (
        pitch < session.basePitch ||
        pitch >= session.basePitch + session.pitchRows
      )
        return null;
      const tick =
        session.viewStart + ((local.x - LEFT) / WIDTH) * session.pageSize;
      return { tick: Math.max(0, tick), pitch };
    }

    private audition() {
      const note = session.store.selected;
      if (note)
        void session.audio
          .audition(
            note,
            session.store.project.tracks.find((t) => t.id === note.trackId)
              ?.gain,
            session.store.project.tracks.find((t) => t.id === note.trackId),
            session.store.project,
          )
          .catch(session.onError);
    }

    /** Strip-local x of a tick; the strip itself is offset by the view position. */
    private stripX(tick: number) {
      return LEFT + ((tick - this.stripStart) / session.pageSize) * WIDTH;
    }

    /** Pages show exactly one view. Scroll preloads a view either side so it rebuilds rarely. */
    private stripRange() {
      if (session.timeline === "pages")
        return { start: session.pageTick, length: session.pageSize };
      const songEnd = projectEnd(session.store.project);
      const start = Math.max(
        0,
        Math.floor(session.viewStart / session.pageSize - 1) * session.pageSize,
      );
      return {
        start,
        length: Math.max(
          session.pageSize,
          Math.min(3 * session.pageSize, songEnd - start),
        ),
      };
    }

    private rebuild() {
      this.noteEntities.forEach((entity) => entity.dispose());
      this.noteEntities = [];
      const range = this.stripRange();
      this.stripStart = range.start;
      this.stripLength = range.length;
      this.decorate();
      const row = HEIGHT / session.pitchRows;
      const tracks = session.trackIndex;
      const stripEnd = this.stripStart + this.stripLength;
      for (const note of session.notesBetween(this.stripStart, stripEnd)) {
        const start = Math.max(this.stripStart, note.start);
        const end = Math.min(stripEnd, note.start + note.duration);
        const width = Math.max(
          0.012,
          ((end - start) / session.pageSize) * WIDTH - 0.003,
        );
        const material = new MeshStandardMaterial({
          // One hue per part when every track is shown, otherwise one per pitch.
          color: new Color().setHSL(
            session.allTracks
              ? trackHue(tracks.get(note.trackId) ?? 0)
              : (note.pitch / 24) % 1,
            0.65,
            0.58,
          ),
          roughness: 0.65,
          emissive: 0x000000,
          clippingPlanes: this.clip,
        });
        const depth = noteDepth(note.velocity);
        const centerZ = Z + depth / 2;
        const mesh = new Mesh(
          new BoxGeometry(width, row * 0.85, depth),
          material,
        );
        mesh.position.set(
          this.stripX(start) + width / 2,
          BOTTOM + (note.pitch - session.basePitch + 0.5) * row,
          centerZ,
        );
        mesh.name = `Note ${note.id} pitch ${note.pitch}`;
        mesh.userData.noteId = note.id;
        mesh.userData.anchorX = mesh.position.x;
        mesh.userData.anchorY = mesh.position.y;
        mesh.userData.start = note.start;
        mesh.userData.end = note.start + note.duration;
        mesh.userData.glow = 0;
        mesh.userData.flash = 0;
        const halo = new Mesh(
          glowGeometry,
          new MeshBasicMaterial({
            color: material.color,
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            clippingPlanes: this.clip,
          }),
        );
        halo.scale.set(width + 0.02, row * 1.5, depth + 0.02);
        halo.visible = false;
        halo.raycast = () => {};
        mesh.add(halo);
        const entity = this.world.createTransformEntity(mesh, this.stripEntity);
        entity.addComponent(NoteView).addComponent(RayInteractable);
        // Erasing never grabs, so a note can be removed without starting a drag.
        if (session.tool !== "erase")
          entity.addComponent(DistanceGrabbable, {
            rotate: false,
            scale: false,
            movementMode: MovementMode.MoveFromTarget,
            translateMin: [LEFT, BOTTOM, centerZ],
            translateMax: [this.stripX(stripEnd), BOTTOM + HEIGHT, centerZ],
          });
        const select = (event: Modifiers) => {
          if (session.tool === "erase") {
            feedback.play("erase");
            // Defer, so the entity is not rebuilt away while its event is still dispatching.
            queueMicrotask(() => session.erase(note.id));
            return;
          }
          feedback.play("select");
          session.pick(note.id, !!(event.ctrlKey || event.metaKey));
          if (session.store.isSelected(note.id)) this.audition();
        };
        entity.object3D!.addEventListener("pointerdown", select);
        // Erase strokes: dragging across notes with the button held removes each one.
        entity.object3D!.addEventListener(
          "pointerenter",
          (event: Modifiers) => {
            if (session.tool === "erase" && (event.buttons ?? 0) & 1) {
              feedback.play("erase");
              queueMicrotask(() => session.erase(note.id));
            } else feedback.play("hover", "up");
          },
        );
        this.noteEntities.push(entity);
      }
      this.revision = session.store.revision;
      this.viewKey = this.layoutKey();
    }

    private layoutKey() {
      const range = this.stripRange();
      return `${range.start}:${range.length}:${session.basePitch}:${session.pitchRows}:${session.allTracks || session.trackId}:${session.store.project.ppq}:${session.pageSize}:${session.tool === "erase"}`;
    }

    private updateTimelineLabel(viewStart: number, viewEnd: number) {
      const project = session.store.project;
      const total = session.totalBars;
      const meter = barAt(project, session.audio.positionTick);
      const text =
        session.timeline === "scroll"
          ? `Bar ${meter.index + 1} / ${total} ${meter.numerator}/${meter.denominator}`
          : `Bars ${barAt(project, viewStart).index + 1}-${Math.min(barAt(project, viewEnd - 1e-6).index + 1, total)} / ${total} ${meter.numerator}/${meter.denominator}`;
      if (text === this.timelineLabel) return;
      this.timelineLabel = text;
      this.world
        .requireSceneObject<UIKitMLAsset>("transport")
        .requireElementById("meter-label")
        .setProperties({
          text: `Meter ${meter.numerator}/${meter.denominator}`,
        });
      this.world
        .requireSceneObject<UIKitMLAsset>("transport")
        .requireElementById("timeline-label")
        .setProperties({ text });
    }

    update(delta: number) {
      // In AR the real room replaces the studio backdrop and floor grid.
      const blend = this.world.session?.environmentBlendMode;
      const passthrough = !!blend && blend !== "opaque";
      if (passthrough !== this.passthrough) {
        this.passthrough = passthrough;
        this.scene.background = passthrough ? null : this.backdrop;
      }
      // A floor only reads as depth in perspective; flat and oblique views would show stray diagonals.
      this.floor.visible =
        !passthrough && !this.world.camera.userData.parallelProjection;
      for (const entity of this.noteEntities) {
        const object = entity.object3D!;
        const previous = this.dragging.get(entity);
        if (entity.hasComponent(Grabbed)) {
          if (!previous) {
            const note = session.store.project.notes.find(
              (n) => n.id === object.userData.noteId,
            );
            if (note) {
              feedback.play("grab");
              this.dragging.set(entity, {
                note: { ...note },
                x: object.userData.anchorX,
                y: object.userData.anchorY,
              });
            }
          }
          const drag = this.dragging.get(entity);
          if (drag) {
            const cell = `${Math.round((((object.position.x - drag.x) / WIDTH) * session.pageSize) / session.gridStep)}:${Math.round(((object.position.y - drag.y) * session.pitchRows) / HEIGHT)}`;
            if (drag.cell !== undefined && cell !== drag.cell)
              feedback.play("adjust");
            drag.cell = cell;
          }
        } else if (previous) {
          feedback.play("drop");
          this.dragging.delete(entity);
          const start = snapTick(
            previous.note.start +
              ((object.position.x - previous.x) / WIDTH) * session.pageSize,
            session.store.project.ppq,
            session.grid,
          );
          const pitch = Math.round(
            ((object.position.y - previous.y) * session.pitchRows) / HEIGHT,
          );
          if (session.store.isSelected(previous.note.id))
            session.move(start - previous.note.start, pitch);
          else
            session.store.updateNote(previous.note.id, {
              start,
              pitch: Math.max(0, Math.min(127, previous.note.pitch + pitch)),
            });
          // Always restore the exact snapped transform, even when no history entry was needed.
          this.revision = -1;
          this.dirty = true;
        }
      }
      const selected = new Set(session.store.selectedIds);
      const [leader] = this.dragging.keys();
      if (leader && selected.has(leader.object3D!.userData.noteId)) {
        const moved = leader.object3D!;
        const dx = moved.position.x - moved.userData.anchorX;
        const dy = moved.position.y - moved.userData.anchorY;
        for (const entity of this.noteEntities) {
          const object = entity.object3D!;
          if (entity !== leader && selected.has(object.userData.noteId))
            object.position.set(
              object.userData.anchorX + dx,
              object.userData.anchorY + dy,
              object.position.z,
            );
        }
      }
      const editing = session.view === "notes" && session.tool !== "select";
      if (this.board) this.board.userData.editSurface = editing;
      this.ghost.visible =
        session.view === "notes" && session.tool === "draw" && !!this.hover;
      if (this.ghost.visible && this.hover) {
        const ppq = session.store.project.ppq;
        const step = session.grid > 0 ? ppq / session.grid : 1;
        const start = Math.floor(this.hover.tick / step) * step;
        const row = HEIGHT / session.pitchRows;
        const width = (session.drawLength / session.pageSize) * WIDTH;
        this.ghost.scale.set(
          width,
          row * 0.85,
          noteDepth(session.drawVelocity),
        );
        this.ghost.position.set(
          LEFT +
            ((start - session.viewStart) / session.pageSize) * WIDTH +
            width / 2,
          BOTTOM + (this.hover.pitch - session.basePitch + 0.5) * row,
          Z + noteDepth(session.drawVelocity) / 2,
        );
      }
      if (this.dirty && this.dragging.size === 0) {
        this.viewPivot.visible =
          session.view !== "waveform" && session.outputMode === "off";
        this.world
          .requireSceneObject<UIKitMLAsset>("transport")
          .requireElementById("output-label")
          .setProperties({
            text:
              session.outputModes.length > 1
                ? `${session.outputModes.length} visualisers`
                : OUTPUT_MODES[session.outputMode].label,
          });
        const outputPanel =
          this.world.requireSceneObject<UIKitMLAsset>("transport");
        outputPanel
          .requireElementById("output-choice-label")
          .setProperties({ text: OUTPUT_MODES[session.outputChoice].label });
        outputPanel.requireElementById("output-toggle-label").setProperties({
          text: session.outputModes.includes(session.outputChoice)
            ? "Remove"
            : "Add",
        });
        this.viewPivot.rotation.x =
          session.view === "velocity" ? -Math.PI / 2 : 0;
        const panel = this.world.requireSceneObject<UIKitMLAsset>("transport");
        panel.requireElementById("feedback-label").setProperties({
          text: feedback.muted
            ? "UI sounds off"
            : `UI sounds ${Math.round(feedback.volume * 100)}%`,
        });
        for (const [id, enabled] of Object.entries({
          loop: session.audio.loop,
          metronome: session.audio.metronome,
          "count-in": session.audio.countIn,
          "track-mute": session.track?.muted,
          "track-solo": session.track?.solo,
          "track-drums": session.track?.drums,
        }))
          panel
            .requireElementById(id)
            .setProperties({ backgroundOpacity: enabled ? 0.25 : 0.04 });
        panel.requireElementById("track-name-label").setProperties({
          text: `${session.track?.name ?? "No track"} · ${Math.round((session.track?.gain ?? 0) * 100)}%`,
        });
        panel.requireElementById("track-sound-label").setProperties({
          text: session.track?.drums
            ? "Synthesized kit"
            : INSTRUMENT_NAMES[session.track?.program ?? 0],
        });
        panel.requireElementById("composition-options").setProperties({
          display: session.view === "waveform" ? "none" : "flex",
        });
        const scrolling = session.timeline === "scroll";
        panel.requireElementById("follow").setProperties({
          backgroundOpacity: session.followPlayback ? 0.25 : 0.04,
          display: scrolling ? "none" : "flex",
        });
        panel.requireElementById("scroll").setProperties({
          backgroundOpacity: scrolling ? 0.25 : 0.04,
        });
        panel.requireElementById("tool-label").setProperties({
          text: { select: "Select", draw: "Draw", erase: "Erase" }[
            session.tool
          ],
        });
        panel.requireElementById("grid-label").setProperties({
          text: session.grid ? `Grid 1/${session.grid * 4}` : "Grid off",
        });
        panel.requireElementById("span-label").setProperties({
          text:
            session.viewSpan === "song" ? "Song" : `${session.viewSpan} bars`,
        });
        panel.requireElementById("vinyl-options").setProperties({
          display: session.view === "waveform" ? "flex" : "none",
        });
        panel.requireElementById("vinyl").setProperties({
          backgroundOpacity: session.clipPlayer.vinylEnabled ? 0.25 : 0.04,
        });
        panel
          .requireElementById("condition-label")
          .setProperties({ text: session.clipPlayer.vinylCondition });
        panel.requireElementById("view-waveform").setProperties({
          display: session.clipPlayer.clip ? "flex" : "none",
        });
        for (const view of ["notes", "velocity", "waveform"] as const)
          panel.requireElementById(`view-${view}`).setProperties({
            backgroundOpacity: session.view === view ? 0.25 : 0.04,
          });
        if (this.revision !== session.store.revision) this.rebuild();
        this.dirty = false;
      }
      // Scrolling moves the strip every frame and swaps it for a fresh one near its end.
      if (!this.dragging.size && this.layoutKey() !== this.viewKey)
        this.rebuild();
      const tick = session.audio.positionTick;
      if (!this.dragging.size) session.followPlayhead();
      const viewStart = session.viewStart;
      const viewEnd = viewStart + session.pageSize;
      this.strip.position.x =
        -((viewStart - this.stripStart) / session.pageSize) * WIDTH;
      this.playhead.visible = tick >= viewStart && tick <= viewEnd;
      this.playhead.position.x =
        LEFT + ((tick - viewStart) / session.pageSize) * WIDTH;
      this.updateTimelineLabel(viewStart, viewEnd);
      // Off-screen parts of the strip are hidden, not just clipped, so they cannot be picked.
      for (const entity of this.decorations) {
        const object = entity.object3D!;
        if (object.userData.tick !== undefined)
          object.visible =
            object.userData.tick >= viewStart - 1 &&
            object.userData.tick <= viewEnd + 1;
      }
      for (const entity of this.noteEntities) {
        const data = entity.object3D!.userData;
        if (!this.dragging.has(entity))
          entity.object3D!.visible =
            data.start < viewEnd && data.end > viewStart;
      }
      // Sounding notes flash on their attack, glow while held, then fade out.
      for (const entity of this.noteEntities) {
        const mesh = entity.object3D as Mesh<BoxGeometry, MeshStandardMaterial>;
        const data = mesh.userData;
        const sounding =
          session.audio.playing && tick >= data.start && tick < data.end;
        if (sounding && !data.sounding) data.flash = 1;
        data.sounding = sounding;
        data.glow +=
          ((sounding ? 1 : 0) - data.glow) *
          Math.min(1, delta * (sounding ? 30 : 6));
        data.flash *= Math.exp(-delta * 7);
        const level = data.glow * 0.6 + data.flash * 0.8;
        mesh.material.emissive.copy(mesh.material.color).multiplyScalar(level);
        if (selected.has(data.noteId)) mesh.material.emissive.add(SELECTED);
        const halo = mesh.children[0] as Mesh<BoxGeometry, MeshBasicMaterial>;
        halo.visible = level > 0.01;
        halo.material.opacity = data.glow * 0.2 + data.flash * 0.5;
        if (!this.dragging.has(entity)) {
          const pulse = 1 + data.glow * 0.08 + data.flash * 0.3;
          mesh.scale.set(1, pulse, pulse);
        }
      }
    }
  };
}
