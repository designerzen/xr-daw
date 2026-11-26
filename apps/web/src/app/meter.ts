import type { Project, TimeSignature } from "./project";

const COMMON_TIME: TimeSignature[] = [
  { tick: 0, numerator: 4, denominator: 4 },
];
const cache = new WeakMap<
  Project,
  {
    source: Project["timeSignatures"];
    ppq: number;
    value: ReturnType<typeof buildSections>;
  }
>();
function buildSections(project: Project) {
  const signatures = project.timeSignatures ?? COMMON_TIME;
  let firstBar = 0;
  return signatures.map((signature, i) => {
    const beatTicks = (project.ppq * 4) / signature.denominator;
    const barTicks = beatTicks * signature.numerator;
    const next = signatures[i + 1]?.tick ?? Infinity;
    const section = { ...signature, beatTicks, barTicks, firstBar, next };
    firstBar += Math.ceil((next - signature.tick) / barTicks - 1e-10);
    return section;
  });
}
function sections(project: Project) {
  let entry = cache.get(project);
  if (
    !entry ||
    entry.source !== project.timeSignatures ||
    entry.ppq !== project.ppq
  ) {
    entry = {
      source: project.timeSignatures,
      ppq: project.ppq,
      value: buildSections(project),
    };
    cache.set(project, entry);
  }
  return entry.value;
}
/** A meter change starts a new bar, truncating an incomplete preceding bar. */
export function barAt(project: Project, tick: number) {
  const list = sections(project);
  const section =
    [...list].reverse().find((s) => s.tick <= Math.max(0, tick)) ?? list[0];
  const offset = Math.floor(
    Math.max(0, tick - section.tick) / section.barTicks + 1e-10,
  );
  const start = section.tick + offset * section.barTicks;
  const end = Math.min(start + section.barTicks, section.next);
  return {
    ...section,
    index: section.firstBar + offset,
    start,
    end,
    beat: (tick - start) / section.beatTicks + 1,
  };
}
/** Zero-based fractional bar positions, invertible even across changing meters. */
export function tickAtBar(project: Project, position: number): number {
  position = Math.max(0, position);
  const list = sections(project);
  const section =
    [...list].reverse().find((s) => s.firstBar <= position) ?? list[0];
  const whole = Math.floor(position);
  const start = section.tick + (whole - section.firstBar) * section.barTicks;
  const end = Math.min(start + section.barTicks, section.next);
  return start + (position - whole) * (end - start);
}
export function barPosition(project: Project, tick: number): number {
  const bar = barAt(project, tick);
  return bar.index + (tick - bar.start) / (bar.end - bar.start);
}
export function beatTick(
  project: Project,
  tick: number,
  rounding: "floor" | "ceil" | "round" = "round",
): number {
  const bar = barAt(project, Math.max(0, tick));
  const beat = Math[rounding](
    (tick - bar.start) / bar.beatTicks +
      (rounding === "ceil" ? -1e-9 : rounding === "floor" ? 1e-9 : 0),
  );
  return Math.min(bar.end, bar.start + beat * bar.beatTicks);
}
export function nextBeatTick(project: Project, tick: number) {
  return beatTick(
    project,
    tick + barAt(project, tick).beatTicks * 1e-6,
    "ceil",
  );
}
