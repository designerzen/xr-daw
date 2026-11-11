import {
  PerspectiveCamera,
  Raycaster,
  Spherical,
  Vector2,
  Vector3,
  type Object3D,
} from "@iwsdk/core";

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
  look = false;

  constructor(
    private camera: PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    private scene: Object3D,
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
    this.panGesture =
      event.button === 1 || event.button === 2 || event.shiftKey;
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
    const offset = this.camera.position.clone().sub(this.target);
    const distance = Math.max(0.6, Math.min(20, offset.length() * factor));
    this.camera.position.copy(this.target).add(offset.setLength(distance));
    this.camera.updateMatrixWorld();
  }
  reset() {
    if (this.immersive) return;
    this.target.set(0, 1.5, -1.8);
    this.camera.position.copy(this.homePosition);
    this.camera.quaternion.copy(this.homeQuaternion);
    this.camera.updateMatrixWorld();
  }
  setImmersive(value: boolean) {
    if (value === this.immersive) return;
    if (value) {
      this.savedPosition.copy(this.camera.position);
      this.savedQuaternion.copy(this.camera.quaternion);
    } else {
      this.camera.position.copy(this.savedPosition);
      this.camera.quaternion.copy(this.savedQuaternion);
      this.camera.updateMatrixWorld();
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
