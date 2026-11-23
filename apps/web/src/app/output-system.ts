import {
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  DoubleSide,
  type BufferGeometry,
  Sprite,
  SpriteMaterial,
} from "@iwsdk/core";
import {
  OutputHistory,
  OUTPUT_MODES,
  HISTORY_ROWS,
  POINTS_PER_ROW,
  type OutputMode,
} from "./output-history";
import type { Session } from "./session";

/** One display; all displays share one audio analysis and history. */
class OutputPanel {
  readonly root = new Group();
  private pointGeometry = new IcosahedronGeometry(1, 0);
  private floorGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private particles = new InstancedMesh<BufferGeometry, MeshBasicMaterial>(
    this.pointGeometry,
    new MeshBasicMaterial(),
    HISTORY_ROWS * POINTS_PER_ROW,
  );
  private floor = new Mesh(
    new PlaneGeometry(3.3, 1.5),
    new MeshBasicMaterial({
      color: 0x587e99,
      transparent: true,
      opacity: 0.18,
      side: DoubleSide,
    }),
  );
  private bounds = new Mesh(
    new BoxGeometry(3.3, 1.5, 2.2),
    new MeshBasicMaterial({
      color: 0x587e99,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
    }),
  );
  private texture = new CanvasTexture(document.createElement("canvas"));
  private label = new Sprite(
    new SpriteMaterial({ map: this.texture, depthTest: false }),
  );
  private matrix = new Matrix4();
  private color = new Color();
  private point = new Float32Array(6);

  constructor(readonly mode: Exclude<OutputMode, "off">) {
    this.root.name = `Output view ${mode}`;
    this.root.userData.mode = mode;
    this.particles.name = "Live output particles";
    this.particles.frustumCulled = false;
    this.particles.userData.fitIgnore = true;
    this.particles.raycast = () => {};
    this.bounds.position.set(0, 1.6, -2.1);
    this.bounds.raycast = () => {};
    this.floor.name = "Output scope floor";
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0.015, -2.1);
    this.floor.raycast = () => {};
    this.floor.userData.fitIgnore = true;
    this.floor.visible = false;
    this.label.position.set(0, 2.48, -2.1);
    this.label.scale.set(3.25, 0.35, 1);
    this.label.raycast = () => {};
    this.root.add(this.particles, this.bounds, this.label, this.floor);
    this.configure(mode);
  }
  dispose() {
    this.particles.dispose();
    this.pointGeometry.dispose();
    this.floorGeometry.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.particles.material.dispose();
    this.bounds.geometry.dispose();
    this.bounds.material.dispose();
    this.texture.dispose();
    this.label.material.dispose();
    this.root.removeFromParent();
  }

  private configure(mode: Exclude<OutputMode, "off">) {
    const columns = isColumns(mode);
    this.particles.count = HISTORY_ROWS * pointsPerRow(mode);
    this.particles.geometry = columns ? this.floorGeometry : this.pointGeometry;
    this.floor.visible = columns;
    this.floor.position.y = mode === "floor" ? 0.015 : 0.855;
    this.bounds.position.y = mode === "floor" ? 0.72 : 1.6;
    this.label.position.y = mode === "floor" ? 1.6 : 2.48;
    const canvas = this.texture.image as HTMLCanvasElement;
    canvas.width = 2048;
    canvas.height = 220;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#c5d8ea";
    context.font = "52px sans-serif";
    context.textAlign = "center";
    context.fillText(OUTPUT_MODES[mode].label, 1024, 55, 2000);
    const lines: string[] = [];
    for (const axis of OUTPUT_MODES[mode].axes.split(" · ")) {
      const last = lines.length - 1;
      const joined = last >= 0 ? `${lines[last]} · ${axis}` : axis;
      if (last < 0 || context.measureText(joined).width > 1960)
        lines.push(axis);
      else lines[last] = joined;
    }
    lines.forEach((line, i) =>
      context.fillText(
        line,
        1024,
        lines.length === 1 ? 145 : 115 + i * 62,
        2000,
      ),
    );
    this.texture.needsUpdate = true;
  }
  render(history: OutputHistory, source: string, primary: boolean) {
    const mode = this.mode,
      columns = isColumns(mode);
    this.particles.name = primary
      ? "Live output particles"
      : `Live output particles ${mode}`;
    let peak = 0;
    const points = pointsPerRow(mode);
    for (let age = 0; age < HISTORY_ROWS; age++) {
      for (let index = 0; index < points; index++) {
        history.point(mode, age, index, this.point);
        const [x, y, z, size, hue, level] = this.point;
        if (columns) {
          // Geometry is anchored at y=0, so every column has an exactly flat underside.
          this.matrix
            .makeScale(
              size ? 0.019 : 0,
              size ? level * 1.3 : 0,
              size ? 0.024 : 0,
            )
            .setPosition(x, y, z);
        } else this.matrix.makeScale(size, size, size).setPosition(x, y, z);
        const instance = age * points + index;
        this.particles.setMatrixAt(instance, this.matrix);
        this.color.setHSL(hue, 0.8, 0.3 + level * 0.4);
        this.particles.setColorAt(instance, this.color);
        peak = Math.max(peak, level);
      }
    }
    this.particles.instanceMatrix.needsUpdate = true;
    this.particles.instanceColor!.needsUpdate = true;
    Object.assign(this.particles.userData, {
      mode,
      source,
      frames: history.frames,
      peak,
    });
  }
}

function isColumns(mode: OutputMode) {
  return (
    mode === "floor" ||
    mode === "waterfall" ||
    mode === "flux" ||
    mode === "envelope"
  );
}
function pointsPerRow(mode: OutputMode) {
  if (mode === "centroid" || mode === "dynamics") return 1;
  if (mode === "chroma") return 12;
  if (mode === "balance" || mode === "flux") return 64;
  return POINTS_PER_ROW;
}

/** Instanced spatial displays for desktop, touch and XR. */
export function outputSystem(session: Session) {
  return class OutputSystem extends createSystem({}) {
    private root = new Group();
    private history = new OutputHistory();
    private panels = new Map<Exclude<OutputMode, "off">, OutputPanel>();
    private key = "";
    private source = "";
    private clip: unknown;
    init() {
      this.root.name = "Live output";
      this.root.visible = false;
      this.world.createTransformEntity(this.root);
      this.cleanupFuncs.push(() => {
        this.panels.forEach((panel) => panel.dispose());
        this.panels.clear();
        this.root.removeFromParent();
      });
    }
    update() {
      const modes = session.outputModes;
      const source = session.view === "waveform" ? "audio" : "midi";
      const key = `${source}:${modes.join(",")}`;
      const changed = key !== this.key;
      this.root.visible = modes.length > 0;
      if (
        source !== this.source ||
        (!this.panels.size && modes.length > 0) ||
        this.clip !== session.clipPlayer.clip
      )
        this.history.clear();
      this.clip = session.clipPlayer.clip;
      this.source = source;
      if (changed) {
        this.key = key;
        this.panels.forEach((panel, mode) => {
          if (!modes.includes(mode)) {
            panel.dispose();
            this.panels.delete(mode);
          }
        });
        modes.forEach((mode, index) => {
          let panel = this.panels.get(mode);
          if (!panel) {
            panel = new OutputPanel(mode);
            this.panels.set(mode, panel);
            this.root.add(panel.root);
          }
          // Audio retains its full-size interactive waveform in front of the scope wall.
          const tiled = source === "audio" || modes.length > 1;
          const columns = Math.min(4, modes.length);
          const scale = tiled ? 0.48 : 1;
          panel.root.scale.setScalar(scale);
          panel.root.position.set(
            tiled ? ((index % columns) - (columns - 1) / 2) * 1.8 : 0,
            tiled ? 2.15 + Math.floor(index / columns) * 1.05 : 0,
            tiled ? -1.2 : 0,
          );
        });
      }
      if (!modes.length) return;
      const frame =
        source === "audio"
          ? session.clipPlayer.readOutput()
          : session.audio.readOutput();
      const captured = frame ? this.history.capture(frame) : false;
      if (!changed && !captured) return;
      modes.forEach((mode, index) =>
        this.panels.get(mode)!.render(this.history, source, index === 0),
      );
    }
  };
}
