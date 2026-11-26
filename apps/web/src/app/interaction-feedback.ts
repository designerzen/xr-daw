import {
  ButtonSynth,
  type Parameters,
  type Phase,
} from "../vendor/button-synth/synth";

export const FEEDBACK_CUES = {
  hover: { profile: "hi75-soft", decay: 0.3, volume: 0.18 },
  press: { profile: "ps5-snappy", decay: 0.55, volume: 0.7 },
  select: { profile: "asus-mouse", decay: 0.4, volume: 0.65 },
  navigate: { profile: "game-8bit-select", decay: 0.45, volume: 0.5 },
  on: { profile: "guitar-toggle-on", decay: 0.5, volume: 0.7 },
  off: { profile: "guitar-toggle-off", decay: 0.5, volume: 0.7 },
  adjust: { profile: "hi75-knob", decay: 0.3, volume: 0.5 },
  grab: { profile: "lock-open", decay: 0.4, volume: 0.6 },
  drop: { profile: "camera-latch", decay: 0.4, volume: 0.65 },
  create: { profile: "popper-empty", decay: 0.45, volume: 0.65 },
  erase: { profile: "kvm-switch", decay: 0.4, volume: 0.65, pitch: -5 },
  back: { profile: "game-menu-back", decay: 0.45, volume: 0.5 },
  open: { profile: "lock-open", decay: 0.45, volume: 0.65 },
  close: { profile: "lock-closed", decay: 0.45, volume: 0.65 },
  play: { profile: "game-game-start", decay: 0.45, volume: 0.55 },
  pause: { profile: "game-pause-blip", decay: 0.5, volume: 0.55 },
  stop: { profile: "game-menu-back", decay: 0.55, volume: 0.6, pitch: -5 },
  success: { profile: "game-console-confirm", decay: 0.65, volume: 0.65 },
  error: { profile: "game-menu-error", decay: 0.65, volume: 0.65 },
} satisfies Record<string, Partial<Parameters> & { profile: string }>;
export type FeedbackCue = keyof typeof FEEDBACK_CUES;
type Synth = Pick<ButtonSynth, "trigger" | "setMuted" | "dispose">;
type Settings = { muted: boolean; volume: number };
const SETTINGS_KEY = "xr-daw.interaction-sounds";

/** One lazy, independent audio graph: feedback never enters musical analysis or exports. */
export class InteractionFeedback {
  muted = false;
  volume = 0.7;
  private armed = false;
  private disposed = false;
  private last = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(private synth: Synth = new ButtonSynth()) {
    try {
      const settings = JSON.parse(
        localStorage.getItem(SETTINGS_KEY) ?? "null",
      ) as Partial<Settings> | null;
      if (typeof settings?.muted === "boolean") this.muted = settings.muted;
      if (
        typeof settings?.volume === "number" &&
        Number.isFinite(settings.volume)
      )
        this.volume = Math.max(0, Math.min(1, settings.volume));
    } catch {
      /* Storage is optional. */
    }
    this.synth.setMuted(this.muted);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Main can remount the shared service after a development hot reload. */
  mount() {
    this.disposed = false;
    this.armed = false;
  }
  configure(settings: Partial<Settings>) {
    if (typeof settings.muted === "boolean") this.muted = settings.muted;
    if (typeof settings.volume === "number" && Number.isFinite(settings.volume))
      this.volume = Math.max(0, Math.min(1, settings.volume));
    this.synth.setMuted(this.muted || this.volume === 0);
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ muted: this.muted, volume: this.volume }),
      );
    } catch {
      /* Storage is optional. */
    }
    this.listeners.forEach((listener) => listener());
  }
  play(cue: FeedbackCue, phase: Phase = "down", value?: number) {
    if (this.disposed) return;
    // Wheel/hover events do not grant browser audio permission. Do not queue
    // suspended resume promises that would all sound on the first real press.
    const activation =
      typeof navigator === "undefined" ? undefined : navigator.userActivation;
    if (activation && !activation.hasBeenActive && !activation.isActive) return;
    // Hover and asynchronous completion never unlock audio on their own.
    if (cue === "hover" || cue === "success" || cue === "error") {
      if (!this.armed) return;
    } else this.armed = true;
    if (
      this.muted ||
      this.volume === 0 ||
      (this.synth instanceof ButtonSynth && typeof AudioContext === "undefined")
    )
      return;
    const now = performance.now();
    const interval =
      cue === "hover"
        ? 100
        : cue === "adjust"
          ? 65
          : cue === "erase" || cue === "select"
            ? 35
            : cue === "error"
              ? 250
              : 0;
    const key = `${cue}:${phase}`;
    if (interval && now - (this.last.get(key) ?? -Infinity) < interval) return;
    this.last.set(key, now);
    const { profile, volume, ...parameters } = FEEDBACK_CUES[cue];
    const pitch =
      value === undefined || !Number.isFinite(value)
        ? "pitch" in parameters
          ? parameters.pitch
          : 0
        : -5 + Math.max(0, Math.min(1, value)) * 10;
    // Audio failures must not interrupt editing, XR entry or file operations.
    void this.synth
      .trigger(profile, phase, {
        ...parameters,
        pitch,
        volume: volume * this.volume * (phase === "up" ? 0.65 : 1),
        bounce: 0,
        variation: 0.03,
      })
      .catch(() => {});
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.last.clear();
    await this.synth.dispose().catch(() => {});
  }
}

export const interactionFeedback = new InteractionFeedback();

/** Shared semantic choices for desktop buttons, shortcuts and the spatial menu. */
export function actionCue(id: string, active = false): FeedbackCue {
  if (id === "play") return active ? "pause" : "play";
  if (id === "stop") return "stop";
  if (/^(delete|cut|tool-erase)$/.test(id)) return "erase";
  if (/^(add|add-track|paste|duplicate)$/.test(id)) return "create";
  if (/^(undo|previous|lower|exit)$/.test(id)) return "back";
  if (
    /^(loop|region-loop|follow|scroll|timeline-scroll|camera-look|track-mute|track-solo|track-drums|metronome|count-in|vinyl|feedback-enabled)$/.test(
      id,
    )
  )
    return active ? "off" : "on";
  if (
    /^(shorter|longer|higher|camera-in|camera-out|track-quieter|track-louder|feedback-quieter|feedback-louder|grid|quantize)$/.test(
      id,
    )
  )
    return "adjust";
  if (/^(view-|tool|span|condition|track|next|redo|output-|show-all)/.test(id))
    return "navigate";
  if (id.startsWith("enter-") || id === "seek") return "play";
  if (id === "open" || id === "preset") return "open";
  return "press";
}
