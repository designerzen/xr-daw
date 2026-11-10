/** Velocity is spatial data: notes extend from a common rear plane toward the viewer. */
export const MAX_NOTE_DEPTH = 0.8;

export function noteDepth(velocity: number): number {
  // Keep silent notes selectable; all audible MIDI velocities use a linear scale.
  return Math.max(0.006, velocity * MAX_NOTE_DEPTH);
}
