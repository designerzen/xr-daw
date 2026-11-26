import {
  actionCue,
  interactionFeedback,
  type FeedbackCue,
  type InteractionFeedback,
} from "./interaction-feedback";

const CONTROLS = "button, summary, select, input, textarea, .file-button";
function control(
  target: EventTarget | null,
  root: HTMLElement,
): HTMLElement | null {
  const found =
    target instanceof Element ? target.closest<HTMLElement>(CONTROLS) : null;
  return found &&
    root.contains(found) &&
    !found.matches(":disabled, [aria-disabled='true']")
    ? found
    : null;
}
function cueFor(target: HTMLElement): FeedbackCue {
  if (target.tagName === "SUMMARY")
    return (target.parentElement as HTMLDetailsElement).open ? "close" : "open";
  const action = target.dataset.action;
  const id =
    action === "mute" || action === "solo"
      ? `track-${action}`
      : (action ?? target.id);
  return actionCue(
    id || (target.matches(".file-button") ? "open" : "select"),
    target.id === "play"
      ? target.getAttribute("aria-label") === "Pause"
      : target.getAttribute("aria-pressed") === "true",
  );
}

/** Delegation also covers dynamically created track controls and native keyboard activation. */
export function installInteractionSounds(
  root: HTMLElement,
  feedback: InteractionFeedback = interactionFeedback,
) {
  const cleanup: (() => void)[] = [];
  const pressed = new Map<
    number,
    { target: HTMLElement; cue: FeedbackCue; range: boolean }
  >();
  const keyboard = new Map<string, { target: HTMLElement; cue: FeedbackCue }>();
  const gestures = new WeakMap<HTMLElement, number>();
  let pointerModality = true;
  const listen = <K extends keyof DocumentEventMap>(
    target: EventTarget,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ) => {
    target.addEventListener(type, listener as EventListener, true);
    cleanup.push(() =>
      target.removeEventListener(type, listener as EventListener, true),
    );
  };
  listen(root, "pointerdown", (event) => {
    if (!event.isTrusted || event.button !== 0) return;
    pointerModality = true;
    const target = control(event.target, root);
    if (!target || target.matches("input[type=checkbox], input[type=radio]"))
      return;
    const range = target.matches("input[type=range]");
    const cue = range
      ? "grab"
      : target.matches("input, textarea, select")
        ? "select"
        : cueFor(target);
    pressed.set(event.pointerId, { target, cue, range });
    gestures.set(target, performance.now());
    feedback.play(cue);
  });
  const release = (event: PointerEvent) => {
    const held = pressed.get(event.pointerId);
    if (!held) return;
    pressed.delete(event.pointerId);
    if (event.type === "pointercancel") feedback.play("back");
    else if (held.range) feedback.play("drop");
    else feedback.play(held.cue, "up");
  };
  listen(window, "pointerup", release);
  listen(window, "pointercancel", release);
  listen(root, "pointerover", (event) => {
    const target = control(event.target, root);
    if (!target || target.contains(event.relatedTarget as Node | null)) return;
    feedback.play("hover", "up");
  });
  listen(document, "keydown", (event) => {
    pointerModality = false;
    const target = control(event.target, root);
    if (
      !target ||
      !target.matches("button, summary, .file-button") ||
      !["Enter", "Space"].includes(event.code) ||
      event.repeat
    )
      return;
    const cue = cueFor(target);
    keyboard.set(event.code, { target, cue });
    gestures.set(target, performance.now());
    feedback.play(cue);
  });
  listen(document, "keyup", (event) => {
    const held = keyboard.get(event.code);
    if (!held) return;
    keyboard.delete(event.code);
    gestures.set(held.target, performance.now());
    feedback.play(held.cue, "up");
  });
  listen(root, "click", (event) => {
    const target = control(event.target, root);
    if (
      !event.isTrusted ||
      !target ||
      target.matches("input, select, textarea") ||
      performance.now() - (gestures.get(target) ?? -Infinity) < 1000
    )
      return;
    // Assistive technology may activate a control without pointer or key events.
    feedback.play(cueFor(target));
  });
  listen(root, "focusin", (event) => {
    if (!pointerModality && control(event.target, root))
      feedback.play("hover", "up");
  });
  listen(root, "input", (event) => {
    if (!event.isTrusted) return;
    const target = control(event.target, root) as HTMLInputElement | null;
    if (
      !target ||
      target.matches(
        "input[type=checkbox], input[type=radio], input[type=file]",
      )
    )
      return;
    const value =
      target.type === "range"
        ? (Number(target.value) - Number(target.min || 0)) /
          (Number(target.max || 100) - Number(target.min || 0))
        : undefined;
    feedback.play(
      target.type === "range" || target.type === "number" ? "adjust" : "select",
      "down",
      value,
    );
  });
  // Bubble after application handlers so enabling feedback can sound immediately.
  const changed = (event: Event) => {
    if (!event.isTrusted) return;
    const target = control(event.target, root) as HTMLInputElement | null;
    if (!target) return;
    if (target.matches("input[type=checkbox], input[type=radio]"))
      feedback.play(target.checked ? "on" : "off");
    else if (target.tagName === "SELECT") feedback.play("navigate");
    else if (target.type === "file") feedback.play("open");
  };
  root.addEventListener("change", changed);
  cleanup.push(() => root.removeEventListener("change", changed));
  const blur = () => {
    pressed.clear();
    keyboard.clear();
  };
  window.addEventListener("blur", blur);
  cleanup.push(() => window.removeEventListener("blur", blur));
  return () => {
    cleanup.forEach((remove) => remove());
    pressed.clear();
    keyboard.clear();
  };
}
