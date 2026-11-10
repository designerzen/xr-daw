import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  DistanceGrabbable,
  DirectionalLight,
  Entity,
  Grabbed,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MovementMode,
  RayInteractable,
  Sprite,
  SpriteMaterial,
  UIKitMLAsset,
} from "@iwsdk/core";
import { NoteView } from "./components";
import { snapTick, type Note } from "./project";
import { Session } from "./session";
import { MAX_NOTE_DEPTH, noteDepth } from "./note-depth";

const LEFT = -1.6;
const WIDTH = 3.2;
const BOTTOM = 0.95;
const ROW = 0.035;
const Z = -2.1;

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
    private dragging = new Map<Entity, { note: Note; x: number; y: number }>();
    private dirty = true;
    private revision = -1;
    private viewKey = "";
    private viewPivot = new Group();
    private content = new Group();
    private contentEntity!: Entity;
    private playhead = new Mesh(
      new BoxGeometry(0.008, ROW * 36, 0.008),
      new MeshBasicMaterial({ color: 0xffffff }),
    );

    init() {
      // Rotate the data, never the headset. Local musical coordinates stay unchanged.
      this.viewPivot.name = "Sequencer view";
      this.viewPivot.position.set(0, BOTTOM + ROW * 18, Z + MAX_NOTE_DEPTH / 2);
      this.content.position.copy(this.viewPivot.position).negate();
      const pivotEntity = this.world.createTransformEntity(this.viewPivot);
      this.contentEntity = this.world.createTransformEntity(
        this.content,
        pivotEntity,
      );
      this.scene.background = new Color("#10151f");
      const ambient = new AmbientLight(0xffffff, 0.9);
      const light = new DirectionalLight(0xffffff, 2.2);
      light.position.set(-3, 5, 2);
      this.scene.add(ambient, light);
      const floor = new GridHelper(20, 40, 0x27374f, 0x1b2638);
      floor.position.y = -0.02;
      this.scene.add(floor);
      this.playhead.position.set(LEFT, BOTTOM + ROW * 18, Z + 0.07);
      this.content.add(this.playhead);
      this.cleanupFuncs.push(
        session.subscribe(() => {
          this.dirty = true;
        }),
      );
      const panel = this.world.requireSceneObject<UIKitMLAsset>("transport");
      panel.document.setTargetDimensions(1.15, 0.6);
      const advanced = panel.requireElementById("advanced");
      const more = panel.requireElementById("more");
      let expanded = false;
      const toggleOptions = () => {
        expanded = !expanded;
        advanced.setProperties({ display: expanded ? "flex" : "none" });
      };
      more.addEventListener("click", toggleOptions);
      this.cleanupFuncs.push(() =>
        more.removeEventListener("click", toggleOptions),
      );
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe((value) => {
          panel.visible = value !== "non-immersive";
        }),
      );
      const actions: Record<string, () => void> = {
        play: () => {
          void session.togglePlay().catch(session.onError);
        },
        stop: () => session.stop(),
        "view-notes": () => session.setView("notes"),
        "view-velocity": () => session.setView("velocity"),
        previous: () => session.page(-1),
        next: () => session.page(1),
        shorter: () => session.resize(-1),
        longer: () => session.resize(1),
        undo: () => session.store.undo(),
        redo: () => session.store.redo(),
        exit: () => this.world.exitXR(),
        lower: () => session.scrollPitch(-1),
        higher: () => session.scrollPitch(1),
        add: () => session.addNote(),
        delete: () => session.deleteNote(),
        seek: () => {
          void session.audio
            .play(session.store.project, session.pageTick)
            .catch(session.onError);
        },
        track: () => {
          const tracks = session.store.project.tracks;
          if (tracks.length)
            session.selectTrack(
              tracks[
                (tracks.findIndex((t) => t.id === session.trackId) + 1) %
                  tracks.length
              ].id,
            );
        },
      };
      for (const [id, action] of Object.entries(actions)) {
        const button = panel.requireElementById(id);
        button.addEventListener("click", action);
        this.cleanupFuncs.push(() =>
          button.removeEventListener("click", action),
        );
      }
      this.cleanupFuncs.push(() => {
        this.scene.remove(ambient, light);
        floor.geometry.dispose();
        floor.material.dispose();
        this.playhead.geometry.dispose();
        this.playhead.material.dispose();
      });
    }

    private decorate() {
      this.decorations.forEach((entity) => entity.dispose());
      this.decorations = [];
      const add = (object: Mesh | Sprite) =>
        this.decorations.push(
          this.world.createTransformEntity(object, this.contentEntity),
        );
      const board = new Mesh(
        new BoxGeometry(WIDTH + 0.03, ROW * 36 + 0.03, 0.025),
        new MeshBasicMaterial({ color: 0x182232 }),
      );
      board.position.set(0, BOTTOM + ROW * 18, Z - 0.035);
      add(board);
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
      for (let beat = 0; beat <= 16; beat++) {
        const line = new Mesh(
          new BoxGeometry(0.002, ROW * 36, 0.002),
          new MeshBasicMaterial({ color: beat % 4 ? 0x28364b : 0x546581 }),
        );
        line.position.set(
          LEFT + (beat * WIDTH) / 16,
          BOTTOM + ROW * 18,
          Z - 0.015,
        );
        add(line);
        if (beat % 4 === 0)
          add(
            label(
              `Bar ${Math.floor(session.pageTick / session.store.project.ppq / 4) + beat / 4 + 1}`,
              line.position.x,
              2.29,
            ),
          );
      }
      for (let pitch = 0; pitch <= 36; pitch++) {
        const line = new Mesh(
          new BoxGeometry(WIDTH, 0.001, 0.002),
          new MeshBasicMaterial({
            color: (session.basePitch + pitch) % 12 === 0 ? 0x546581 : 0x273449,
          }),
        );
        line.position.set(0, BOTTOM + pitch * ROW, Z - 0.015);
        add(line);
        if ((session.basePitch + pitch) % 12 === 0)
          add(
            label(
              `C${Math.floor((session.basePitch + pitch) / 12) - 1}`,
              LEFT - 0.12,
              line.position.y + ROW / 2,
              0.15,
            ),
          );
      }
      add(
        label(
          `${session.track?.name ?? "No track"} · ${session.basePitch}–${session.basePitch + 35}`,
          0,
          2.4,
          1.5,
        ),
      );
    }

    private rebuild() {
      this.noteEntities.forEach((entity) => entity.dispose());
      this.noteEntities = [];
      this.decorate();
      const ppq = session.store.project.ppq;
      for (const note of session.visibleNotes) {
        const start = Math.max(session.pageTick, note.start);
        const end = Math.min(
          session.pageTick + session.pageSize,
          note.start + note.duration,
        );
        const width = Math.max(
          0.012,
          ((end - start) / session.pageSize) * WIDTH - 0.003,
        );
        const material = new MeshStandardMaterial({
          color: new Color().setHSL((note.pitch / 24) % 1, 0.65, 0.58),
          roughness: 0.65,
          emissive: 0x000000,
        });
        const depth = noteDepth(note.velocity);
        const centerZ = Z + depth / 2;
        const mesh = new Mesh(
          new BoxGeometry(width, ROW * 0.85, depth),
          material,
        );
        mesh.position.set(
          LEFT +
            ((start - session.pageTick) / session.pageSize) * WIDTH +
            width / 2,
          BOTTOM + (note.pitch - session.basePitch + 0.5) * ROW,
          centerZ,
        );
        mesh.name = `Note ${note.id} pitch ${note.pitch}`;
        mesh.userData.noteId = note.id;
        mesh.userData.anchorX = mesh.position.x;
        mesh.userData.anchorY = mesh.position.y;
        const entity = this.world.createTransformEntity(
          mesh,
          this.contentEntity,
        );
        entity
          .addComponent(NoteView)
          .addComponent(RayInteractable)
          .addComponent(DistanceGrabbable, {
            rotate: false,
            scale: false,
            movementMode: MovementMode.MoveFromTarget,
            translateMin: [LEFT, BOTTOM, centerZ],
            translateMax: [LEFT + WIDTH, BOTTOM + ROW * 36, centerZ],
          });
        const select = () => {
          session.store.select(note.id);
          const current = session.store.selected;
          if (current)
            void session.audio
              .audition(current, session.track?.gain)
              .catch(session.onError);
        };
        entity.object3D!.addEventListener("pointerdown", select);
        this.noteEntities.push(entity);
      }
      this.revision = session.store.revision;
      this.viewKey = `${session.pageTick}:${session.basePitch}:${session.trackId}:${ppq}`;
    }

    update() {
      for (const entity of this.noteEntities) {
        const object = entity.object3D!;
        const previous = this.dragging.get(entity);
        if (entity.hasComponent(Grabbed)) {
          if (!previous) {
            const note = session.store.project.notes.find(
              (n) => n.id === object.userData.noteId,
            );
            if (note)
              this.dragging.set(entity, {
                note: { ...note },
                x: object.userData.anchorX,
                y: object.userData.anchorY,
              });
          }
        } else if (previous) {
          this.dragging.delete(entity);
          session.store.updateNote(previous.note.id, {
            start: snapTick(
              previous.note.start +
                ((object.position.x - previous.x) / WIDTH) * session.pageSize,
              session.store.project.ppq,
            ),
            pitch: Math.max(
              0,
              Math.min(
                127,
                previous.note.pitch +
                  Math.round((object.position.y - previous.y) / ROW),
              ),
            ),
          });
          // Always restore the exact snapped transform, even when no history entry was needed.
          this.revision = -1;
          this.dirty = true;
        }
      }
      if (this.dirty && this.dragging.size === 0) {
        this.viewPivot.rotation.x =
          session.view === "velocity" ? -Math.PI / 2 : 0;
        const panel = this.world.requireSceneObject<UIKitMLAsset>("transport");
        for (const view of ["notes", "velocity"] as const)
          panel.requireElementById(`view-${view}`).setProperties({
            backgroundOpacity: session.view === view ? 0.25 : 0.04,
          });
        const key = `${session.pageTick}:${session.basePitch}:${session.trackId}:${session.store.project.ppq}`;
        if (this.revision !== session.store.revision || key !== this.viewKey)
          this.rebuild();
        for (const entity of this.noteEntities) {
          const mesh = entity.object3D as Mesh<
            BoxGeometry,
            MeshStandardMaterial
          >;
          mesh.material.emissive.setHex(
            mesh.userData.noteId === session.store.selectedId ? 0x31405c : 0,
          );
        }
        this.dirty = false;
      }
      const tick = session.audio.positionTick;
      this.playhead.visible =
        tick >= session.pageTick && tick <= session.pageTick + session.pageSize;
      this.playhead.position.x =
        LEFT + ((tick - session.pageTick) / session.pageSize) * WIDTH;
    }
  };
}
