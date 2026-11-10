import {
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  DoubleSide,
  Entity,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Ray,
  RayInteractable,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "@iwsdk/core";
import type { PointerEvent as SpatialPointerEvent } from "@pmndrs/pointer-events";
import type { AudioClip } from "./clip-player";
import { Session } from "./session";
import { waveformTime } from "./spectrum";

function textLabel(text: string, x: number, y: number, width: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#b9c7df";
  context.font = `${Math.min(130, Math.round((0.05 / width) * 1024))}px sans-serif`;
  context.textAlign = "center";
  context.fillText(text, 512, 105, 1000);
  const sprite = new Sprite(
    new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }),
  );
  sprite.position.set(x, y, -2.1);
  sprite.scale.set(width, (width * 160) / 1024, 1);
  return sprite;
}

export function waveformSystem(session: Session) {
  return class WaveformSystem extends createSystem({}) {
    private root = new Group();
    private rootEntity!: Entity;
    private ringEntities: Entity[] = [];
    private clip?: AudioClip;
    private hit?: ReturnType<typeof this.world.createTransformEntity>;
    private pointer: number | null = null;
    private capturedTarget?: Mesh;
    private latestTime = 0;
    private marker = new Mesh(
      new BoxGeometry(0.006, 1.15, 0.006),
      new MeshBasicMaterial({ color: 0xf4f8ff }),
    );

    init() {
      this.root.name = "Audio waveform";
      this.rootEntity = this.world.createTransformEntity(this.root);
      this.marker.position.set(-1.6, 1.58, -1.8);
      this.cleanupFuncs.push(() => {
        session.clipPlayer.pause();
        this.clear();
        this.marker.geometry.dispose();
        this.marker.material.dispose();
        this.scene.remove(this.root);
      });
    }
    private clear() {
      this.cancelPointer();
      this.hit?.dispose();
      this.hit = undefined;
      this.ringEntities.forEach((entity) => {
        (entity.object3D as InstancedMesh).dispose();
        entity.dispose();
      });
      this.ringEntities = [];
      this.root.remove(this.marker);
      this.root.traverse((object) => {
        if (object instanceof Mesh || object instanceof Sprite) {
          if (object instanceof InstancedMesh) object.dispose();
          if (object instanceof Mesh) object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            if ("map" in material)
              (material.map as CanvasTexture | null)?.dispose();
            material.dispose();
          });
        }
      });
      this.root.clear();
    }
    private cancelPointer() {
      if (this.pointer === null) return;
      this.capturedTarget?.releasePointerCapture(this.pointer);
      this.pointer = null;
      this.capturedTarget = undefined;
      session.clipPlayer.pause();
    }
    private build(clip: AudioClip) {
      this.clear();
      this.pointer = null;
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 2,
      );
      const matrix = new Matrix4();
      const channels = clip.analysis.channels;
      channels.forEach((channel, c) => {
        const rings = new InstancedMesh(
          new RingGeometry(0.86, 1, 32),
          new MeshBasicMaterial({ side: DoubleSide, vertexColors: false }),
          channel.amplitudes.length,
        );
        rings.name = `Waveform circles channel ${c + 1}`;
        const laneHeight = Math.min(0.6, 1.15 / channels.length);
        const y = 1.58 + ((channels.length - 1) / 2 - c) * laneHeight;
        for (let i = 0; i < channel.amplitudes.length; i++) {
          const radius = 0.003 + channel.amplitudes[i] * laneHeight * 0.47;
          const x = -1.6 + ((i + 0.5) / channel.amplitudes.length) * 3.2;
          matrix.compose(
            new Vector3(x, y, -2.1),
            rotation,
            new Vector3(radius, radius, radius),
          );
          rings.setMatrixAt(i, matrix);
          const frequency = channel.frequencies[i];
          const hue = Math.max(
            0,
            Math.min(
              1,
              Math.log2(Math.max(40, frequency) / 40) / Math.log2(16000 / 40),
            ),
          );
          rings.setColorAt(
            i,
            new Color().setHSL(0.7 * (1 - hue), frequency > 0 ? 0.75 : 0, 0.62),
          );
        }
        rings.instanceMatrix.needsUpdate = true;
        rings.instanceColor!.needsUpdate = true;
        this.ringEntities.push(
          this.world
            .createTransformEntity(rings, this.rootEntity)
            .addComponent(RayInteractable),
        );
      });
      this.root.add(textLabel(clip.name, 0, 2.37, 2.4));
      this.root.add(
        textLabel(
          "Low frequency ··· High frequency   |   Drag to scratch",
          0,
          0.84,
          2.6,
        ),
      );
      for (let i = 0; i <= 4; i++)
        this.root.add(
          textLabel(
            `${((clip.buffer.duration * i) / 4).toFixed(1)}s`,
            -1.6 + i * 0.8,
            0.95,
            0.4,
          ),
        );
      this.root.add(this.marker);
      const plane = new Mesh(
        new BoxGeometry(3.2, 1.15, 0.01),
        new MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      plane.position.set(0, 1.58, -2.1);
      plane.name = "Waveform seek surface";
      this.hit = this.world
        .createTransformEntity(plane)
        .addComponent(RayInteractable);
      const scrubPlane = new Plane(new Vector3(0, 0, 1), 2.1);
      let dragOffset = 0;
      const rayX = (event: SpatialPointerEvent) => {
        const ray =
          event.details.type === "screen-ray"
            ? new Ray(event.pointerPosition, event.details.direction)
            : event.ray;
        return (
          ray.intersectPlane(scrubPlane, new Vector3())?.x ?? event.point.x
        );
      };
      const bindTarget = (target: Mesh) => {
        target.addEventListener("pointerdown", (event) => {
          if (this.pointer !== null) return;
          event.stopPropagation();
          this.pointer = event.pointerId;
          this.capturedTarget = target;
          dragOffset = event.point.x - rayX(event);
          this.latestTime = waveformTime(event.point.x, clip.buffer.duration);
          target.setPointerCapture(event.pointerId);
          const start = this.latestTime;
          void session.clipPlayer
            .beginScrub(start)
            .then(() => {
              if (this.pointer !== event.pointerId)
                return session.clipPlayer.endScrub();
              if (this.latestTime !== start)
                session.clipPlayer.scrubTo(this.latestTime);
            })
            .catch(session.onError);
        });
        target.addEventListener("pointermove", (event) => {
          if (event.pointerId !== this.pointer) return;
          event.stopPropagation();
          this.latestTime = waveformTime(
            rayX(event) + dragOffset,
            clip.buffer.duration,
          );
          session.clipPlayer.scrubTo(this.latestTime);
        });
        target.addEventListener("pointerup", (event) => {
          if (event.pointerId !== this.pointer) return;
          this.pointer = null;
          this.capturedTarget = undefined;
          target.releasePointerCapture(event.pointerId);
          void session.clipPlayer.endScrub().catch(session.onError);
        });
        target.addEventListener("pointercancel", (event) => {
          if (event.pointerId !== this.pointer) return;
          this.cancelPointer();
        });
      };
      bindTarget(plane);
      this.ringEntities.forEach((entity) =>
        bindTarget(entity.object3D as Mesh),
      );
    }
    update() {
      const visible = session.view === "waveform";
      if (this.clip !== session.clipPlayer.clip) {
        this.clip = session.clipPlayer.clip;
        if (this.clip) this.build(this.clip);
      }
      this.root.visible = visible;
      if (this.hit?.object3D) this.hit.object3D.visible = visible;
      if (!visible && this.pointer !== null) {
        this.cancelPointer();
      }
      if (this.clip)
        this.marker.position.x =
          -1.6 +
          (session.clipPlayer.positionSeconds / this.clip.buffer.duration) *
            3.2;
    }
  };
}
