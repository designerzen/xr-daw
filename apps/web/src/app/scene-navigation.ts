import {
  Box3,
  GridHelper,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Spherical,
  Sprite,
  Vector2,
  Vector3,
  type Object3D,
} from "@iwsdk/core";

/**
 * Desktop camera styles. Parallel styles keep every bar and every pitch the same size on screen;
 * the oblique ones also show velocity depth as a fixed diagonal instead of a vanishing point.
 */
export const CAMERA_MODES = {
  perspective: { label: "3D", parallel: false, depthScale: 0 },
  front: { label: "Flat", parallel: true, depthScale: 0 },
  cabinet: { label: "Oblique", parallel: true, depthScale: 0.5 },
  cavalier: { label: "Cavalier", parallel: true, depthScale: 1 },
} as const;
export type CameraMode = keyof typeof CAMERA_MODES;
/** Receding depth runs up and to the right, so note tops and ends stay visible. */
const OBLIQUE_ANGLE = Math.PI / 4;
const PARALLEL_EYE = new Vector3(0, 0, 10);

export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

// A parallel or oblique camera has no single eye point, so pointer rays must be unprojected
// from the near plane to the far plane. Every ray user (IWSDK, pointer events, this file)
// shares this Raycaster class.
const setFromCamera = Raycaster.prototype.setFromCamera;
Raycaster.prototype.setFromCamera = function (coords, camera) {
  if (!camera.userData.parallelProjection)
    return setFromCamera.call(this, coords, camera);
  this.ray.origin.set(coords.x, coords.y, -1).unproject(camera);
  this.ray.direction
    .set(coords.x, coords.y, 1)
    .unproject(camera)
    .sub(this.ray.origin)
    .normalize();
  this.camera = camera;
};

/** Own camera gestures only; let IWSDK handle note/waveform gestures and all XR input. */
export class SceneNavigation {
  private target = new Vector3(0, 1.5, -1.8);
  private homePosition: Vector3;
  private homeQuaternion;
  private points = new Map<number, { x: number; y: number }>();
  private gesture = false;
  private panGesture = false;
  private center = new Vector2();
  private distance = 0;
  private immersive = false;
  private cancelling = false;
  private savedPosition: Vector3;
  private savedQuaternion;
  private fitPending = true;
  /** Parallel view: frustum centre in sheared camera space, and world units per CSS pixel. */
  private frame = { x: 0, y: 0, scale: 0.005 };
  private projection = new Matrix4();
  private shear = new Matrix4();
  mode: CameraMode = "cabinet";
  look = false;

  constructor(
    private camera: PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private scene: Object3D,
    /** Screen space covered by overlaid controls, kept clear when fitting the music. */
    private insets: () => Insets,
    /** World z of the rear note plane, which oblique modes keep undistorted. */
    private rearPlane: number,
  ) {
    this.homePosition = camera.position.clone();
    this.homeQuaternion = camera.quaternion.clone();
    this.savedPosition = camera.position.clone();
    this.savedQuaternion = camera.quaternion.clone();
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "3D music workspace");
    for (const [name, handler] of [
      ["pointerdown", this.down],
      ["pointermove", this.move],
      ["pointerup", this.up],
      ["pointercancel", this.up],
    ] as const)
      canvas.addEventListener(name, handler, true);
    canvas.addEventListener("wheel", this.wheel, {
      capture: true,
      passive: false,
    });
    canvas.addEventListener("contextmenu", this.contextMenu);
    const beforeRender = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      beforeRender.apply(scene, args);
      if (!args[0].xr.isPresenting) this.applyCamera();
    };
  }
  get parallel() {
    return CAMERA_MODES[this.mode].parallel;
  }
  setMode(mode: CameraMode) {
    this.mode = mode;
    this.camera.userData.parallelProjection = this.parallel && !this.immersive;
    if (!this.parallel) {
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.homePosition);
      this.camera.quaternion.copy(this.homeQuaternion);
    }
    this.fit();
  }
  /** Refit on the next frame, once the scene reflects the latest view. */
  fit() {
    this.fitPending = true;
  }
  private applyCamera() {
    if (this.immersive) return;
    if (this.fitPending) {
      this.fitPending = false;
      this.fitNow();
    }
    if (!this.parallel) return;
    this.camera.position.copy(PARALLEL_EYE);
    this.camera.quaternion.identity();
    this.camera.updateMatrixWorld();
    const scale = this.frame.scale;
    const halfWidth = (this.canvas.clientWidth * scale) / 2;
    const halfHeight = (this.canvas.clientHeight * scale) / 2;
    this.projection
      .makeOrthographic(
        this.frame.x - halfWidth,
        this.frame.x + halfWidth,
        this.frame.y + halfHeight,
        this.frame.y - halfHeight,
        this.camera.near,
        this.camera.far,
      )
      .multiply(this.shearMatrix());
    this.camera.projectionMatrix.copy(this.projection);
    this.camera.projectionMatrixInverse.copy(this.projection).invert();
  }
  private shearMatrix() {
    const depth = CAMERA_MODES[this.mode].depthScale;
    // Moving toward the viewer (+z) slides a point down-left, around the rear note plane.
    const sx = -depth * Math.cos(OBLIQUE_ANGLE);
    const sy = -depth * Math.sin(OBLIQUE_ANGLE);
    const rear = this.rearPlane - PARALLEL_EYE.z;
    // prettier-ignore
    return this.shear.set(
      1, 0, sx, -sx * rear,
      0, 1, sy, -sy * rear,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
  }
  /** Screen-plane bounds of everything visible except the floor, as seen by this camera. */
  private contentBounds(view: Matrix4) {
    const box = new Box3(),
      bounds = new Box3(),
      corner = new Vector3();
    this.scene.updateMatrixWorld();
    this.scene.traverseVisible((object) => {
      if (object instanceof GridHelper) return;
      if (!(object instanceof Mesh || object instanceof Sprite)) return;
      if (object.geometry.boundingBox === null)
        object.geometry.computeBoundingBox();
      box.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld);
      for (let i = 0; i < 8; i++)
        bounds.expandByPoint(
          corner
            .set(
              i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z,
            )
            .applyMatrix4(view),
        );
    });
    return bounds;
  }
  /** Make the music as large as the space between the overlaid controls allows. */
  private fitNow() {
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height) return;
    const insets = this.insets();
    const available = {
      width: Math.max(80, width - insets.left - insets.right),
      height: Math.max(80, height - insets.top - insets.bottom),
    };
    if (this.parallel) {
      const view = new Matrix4()
        .makeTranslation(PARALLEL_EYE.clone().negate())
        .premultiply(this.shearMatrix());
      const bounds = this.contentBounds(view);
      if (bounds.isEmpty()) return;
      const size = bounds.getSize(new Vector3()),
        middle = bounds.getCenter(new Vector3());
      const scale = Math.max(
        size.x / available.width,
        size.y / available.height,
      );
      // Centre the content in the clear area, not the canvas.
      this.frame = {
        scale,
        x: middle.x - (insets.left + available.width / 2 - width / 2) * scale,
        y: middle.y + (insets.top + available.height / 2 - height / 2) * scale,
      };
      return;
    }
    // Perspective keeps its viewing direction and moves back until the content fits.
    this.camera.position.copy(this.homePosition);
    this.camera.quaternion.copy(this.homeQuaternion);
    this.camera.updateMatrixWorld();
    const bounds = this.contentBounds(this.camera.matrixWorldInverse);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new Vector3()),
      middle = bounds.getCenter(new Vector3());
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    // The nearest face of the content box must fit the clear area.
    const distance =
      size.z / 2 +
      Math.max(
        size.y / 2 / (tan * (available.height / height)),
        size.x / 2 / (tan * this.camera.aspect * (available.width / width)),
      );
    const target = middle.applyMatrix4(this.camera.matrixWorld);
    const forward = this.camera.getWorldDirection(new Vector3());
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    // Offset the target so it lands in the middle of the clear area.
    const pixel = (2 * distance * tan) / height;
    target
      .addScaledVector(
        right,
        -(insets.left + available.width / 2 - width / 2) * pixel,
      )
      .addScaledVector(
        up,
        (insets.top + available.height / 2 - height / 2) * pixel,
      );
    this.target.copy(target);
    this.camera.position.copy(target).addScaledVector(forward, -distance);
    this.camera.updateMatrixWorld();
  }
  private stop(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  private overMusic(event: PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect(),
      ray = new Raycaster();
    ray.setFromCamera(
      new Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      ),
      this.camera,
    );
    const objects: Object3D[] = [];
    this.scene.traverseVisible((object) => {
      if (
        object.userData.noteId ||
        object.name === "Waveform seek surface" ||
        object.name.startsWith("Waveform circles channel")
      )
        objects.push(object);
    });
    return ray.intersectObjects(objects, false).length > 0;
  }
  private baseline() {
    const points = [...this.points.values()];
    this.center.set(
      points.reduce((sum, point) => sum + point.x, 0) / points.length,
      points.reduce((sum, point) => sum + point.y, 0) / points.length,
    );
    this.distance =
      points.length > 1
        ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        : 0;
  }
  private down = (event: PointerEvent) => {
    if (this.immersive || this.cancelling) return;
    this.canvas.focus({ preventScroll: true });
    const wasEditing = this.points.size > 0 && !this.gesture;
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType === "touch" && this.points.size > 1) {
      if (wasEditing) {
        this.cancelling = true;
        for (const id of this.points.keys())
          if (id !== event.pointerId)
            this.canvas.dispatchEvent(
              new PointerEvent("pointercancel", {
                pointerId: id,
                pointerType: "touch",
                bubbles: true,
              }),
            );
        this.cancelling = false;
      }
      this.gesture = true;
    } else
      this.gesture =
        this.look ||
        event.button === 1 ||
        event.button === 2 ||
        event.shiftKey ||
        !this.overMusic(event);
    // Parallel views have a fixed direction, so every drag pans.
    this.panGesture =
      this.parallel ||
      event.button === 1 ||
      event.button === 2 ||
      event.shiftKey;
    this.baseline();
    if (!this.gesture) return;
    this.stop(event);
    for (const id of this.points.keys()) this.canvas.setPointerCapture(id);
  };
  private move = (event: PointerEvent) => {
    if (this.immersive || !this.points.has(event.pointerId) || this.cancelling)
      return;
    const previous = this.center.clone(),
      previousDistance = this.distance;
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.baseline();
    if (!this.gesture) return;
    this.stop(event);
    const dx = this.center.x - previous.x,
      dy = this.center.y - previous.y;
    if (this.points.size > 1 || this.panGesture) this.pan(dx, dy);
    else this.orbit(dx, dy);
    if (this.distance && previousDistance)
      this.zoom(previousDistance / this.distance);
  };
  private up = (event: PointerEvent) => {
    if (this.cancelling || this.immersive || !this.points.has(event.pointerId))
      return;
    this.points.delete(event.pointerId);
    if (this.gesture) {
      this.stop(event);
      if (this.canvas.hasPointerCapture(event.pointerId))
        this.canvas.releasePointerCapture(event.pointerId);
    }
    if (!this.points.size) this.gesture = false;
    else this.baseline();
  };
  private wheel = (event: WheelEvent) => {
    if (this.immersive) return;
    this.stop(event);
    this.zoom(
      Math.exp(
        Math.max(
          -400,
          Math.min(400, event.deltaY * (event.deltaMode === 1 ? 16 : 1)),
        ) * 0.0015,
      ),
    );
  };
  private contextMenu = (event: Event) => {
    if (!this.immersive) event.preventDefault();
  };
  private orbit(dx: number, dy: number) {
    const spherical = new Spherical().setFromVector3(
      this.camera.position.clone().sub(this.target),
    );
    spherical.theta -= dx * 0.006;
    spherical.phi = Math.max(
      0.08,
      Math.min(Math.PI - 0.08, spherical.phi - dy * 0.006),
    );
    this.camera.position
      .copy(this.target)
      .add(new Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
  private pan(dx: number, dy: number) {
    if (this.parallel) {
      this.frame.x -= dx * this.frame.scale;
      this.frame.y += dy * this.frame.scale;
      return;
    }
    const scale =
      (2 *
        this.camera.position.distanceTo(this.target) *
        Math.tan((this.camera.fov * Math.PI) / 360)) /
      Math.max(1, this.canvas.clientHeight);
    const offset = new Vector3(-dx * scale, dy * scale, 0).applyQuaternion(
      this.camera.quaternion,
    );
    this.target.add(offset);
    this.camera.position.add(offset);
    this.camera.updateMatrixWorld();
  }
  zoom(factor: number) {
    if (this.immersive) return;
    if (this.parallel) {
      this.frame.scale = Math.max(
        0.0003,
        Math.min(0.05, this.frame.scale * factor),
      );
      return;
    }
    const offset = this.camera.position.clone().sub(this.target);
    const distance = Math.max(0.6, Math.min(20, offset.length() * factor));
    this.camera.position.copy(this.target).add(offset.setLength(distance));
    this.camera.updateMatrixWorld();
  }
  reset() {
    if (this.immersive) return;
    // The scene is already current, so fit now rather than on the next frame.
    this.fitPending = false;
    this.fitNow();
  }
  setImmersive(value: boolean) {
    if (value === this.immersive) return;
    if (value) {
      this.savedPosition.copy(this.camera.position);
      this.savedQuaternion.copy(this.camera.quaternion);
      // XR supplies its own head-tracked projection.
      this.camera.userData.parallelProjection = false;
      this.camera.position.copy(this.homePosition);
      this.camera.quaternion.copy(this.homeQuaternion);
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.position.copy(this.savedPosition);
      this.camera.quaternion.copy(this.savedQuaternion);
      this.camera.updateMatrixWorld();
      this.camera.userData.parallelProjection = this.parallel;
    }
    for (const id of this.points.keys())
      if (this.canvas.hasPointerCapture(id))
        this.canvas.releasePointerCapture(id);
    this.points.clear();
    this.gesture = false;
    this.immersive = value;
  }
  dispose() {
    for (const [name, handler] of [
      ["pointerdown", this.down],
      ["pointermove", this.move],
      ["pointerup", this.up],
      ["pointercancel", this.up],
    ] as const)
      this.canvas.removeEventListener(name, handler, true);
    this.canvas.removeEventListener("wheel", this.wheel, true);
    this.canvas.removeEventListener("contextmenu", this.contextMenu);
  }
}
