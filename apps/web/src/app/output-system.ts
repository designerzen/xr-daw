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

/** Instanced spatial data, shared by desktop, touch and XR rendering. */
export function outputSystem(session: Session) {
  return class OutputSystem extends createSystem({}) {
    private root = new Group();
    private history = new OutputHistory();
    private particles = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial(),
      HISTORY_ROWS * POINTS_PER_ROW,
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
    private mode: OutputMode = "off";
    private source = "";
    private matrix = new Matrix4();
    private color = new Color();
    private point = new Float32Array(6);

    init() {
      this.root.name = "Live output";
      this.root.visible = false;
      this.particles.name = "Live output particles";
      this.particles.frustumCulled = false;
      this.particles.userData.fitIgnore = true;
      this.particles.raycast = () => {};
      this.bounds.position.set(0, 1.6, -2.1);
      this.bounds.raycast = () => {};
      this.label.position.set(0, 2.48, -2.1);
      this.label.scale.set(3.25, 0.17, 1);
      this.label.raycast = () => {};
      this.root.add(this.particles, this.bounds, this.label);
      this.world.createTransformEntity(this.root);
      this.cleanupFuncs.push(() => {
        this.particles.dispose();
        this.particles.geometry.dispose();
        this.particles.material.dispose();
        this.bounds.geometry.dispose();
        this.bounds.material.dispose();
        this.texture.dispose();
        this.label.material.dispose();
        this.root.removeFromParent();
      });
    }

    update() {
      const mode = session.outputMode;
      this.root.visible = mode !== "off";
      if (mode === "off") {
        this.mode = mode;
        return;
      }
      const source = session.view === "waveform" ? "audio" : "midi";
      const changed = mode !== this.mode || source !== this.source;
      if (changed) {
        if (source !== this.source || this.mode === "off") this.history.clear();
        this.mode = mode;
        this.source = source;
        const canvas = this.texture.image as HTMLCanvasElement;
        canvas.width = 2048;
        canvas.height = 100;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#c5d8ea";
        context.font = "36px sans-serif";
        context.textAlign = "center";
        context.fillText(OUTPUT_MODES[mode].axes, 1024, 62, 2000);
        this.texture.needsUpdate = true;
      }
      const frame =
        source === "audio"
          ? session.clipPlayer.readOutput()
          : session.audio.readOutput();
      const captured = frame ? this.history.capture(frame) : false;
      if (!changed && !captured) return;
      let peak = 0;
      for (let age = 0; age < HISTORY_ROWS; age++) {
        for (let index = 0; index < POINTS_PER_ROW; index++) {
          this.history.point(mode, age, index, this.point);
          const [x, y, z, size, hue, level] = this.point;
          this.matrix.makeScale(size, size, size).setPosition(x, y, z);
          const instance = age * POINTS_PER_ROW + index;
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
        frames: this.history.frames,
        peak,
      });
    }
  };
}
