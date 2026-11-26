import { GENERAL_MIDI_INSTRUMENT_NAMES } from "audiobus/midi/general-midi-instrument-constants.ts";
import { trackAudible, trackHue } from "./project";
import type { Session } from "./session";

/** Retain row elements while values change, preserving keyboard and slider focus. */
export class TrackPanel {
  private key = "";
  constructor(
    private root: HTMLElement,
    private session: Session,
  ) {}
  sync() {
    const { session, root } = this;
    const project = session.store.project;
    const key = JSON.stringify(project.tracks.map((t) => t.id));
    if (key !== this.key) {
      root.replaceChildren();
      for (const track of project.tracks) {
        const row = document.createElement("section");
        row.className = "track-row";
        row.dataset.trackId = track.id;
        row.innerHTML = `<div class="track-heading"><button type="button" data-action="activate" title="Make this the active track for new notes"><span class="track-swatch"></span><span data-name></span></button><button type="button" data-action="focus" title="Show only this track">Focus</button></div>
          <input data-field="name" maxlength="80" aria-label="Track name" />
          <select data-field="program" aria-label="Instrument"></select>
          <div class="track-mix"><button type="button" data-action="mute" aria-pressed="false">Mute</button><button type="button" data-action="solo" aria-pressed="false">Solo</button><label><input data-field="drums" type="checkbox" /> Drums</label></div>
          <label class="track-level">Level <input data-field="gain" type="range" min="0" max="1" step="0.01" /><output></output></label><output class="track-events" data-expression></output>`;
        const select = row.querySelector("select")!;
        GENERAL_MIDI_INSTRUMENT_NAMES.forEach((name, program) => {
          const option = document.createElement("option");
          option.value = String(program);
          option.textContent = `${program + 1}. ${name}`;
          select.append(option);
        });
        row.addEventListener("click", (event) => {
          const action = (
            event.target as HTMLElement
          ).closest<HTMLButtonElement>("button[data-action]")?.dataset.action;
          if (action === "activate") session.activateTrack(track.id);
          if (action === "focus") session.selectTrack(track.id);
          const current = session.store.project.tracks.find(
            (t) => t.id === track.id,
          );
          if (current && action === "mute")
            session.updateTrack(track.id, { muted: !current.muted });
          if (current && action === "solo")
            session.updateTrack(track.id, { solo: !current.solo });
        });
        row.addEventListener("change", (event) => {
          const target = event.target as HTMLInputElement;
          switch (target.dataset.field) {
            case "name":
              session.updateTrack(track.id, {
                name: target.value.trim() || "Untitled track",
              });
              break;
            case "program":
              session.updateTrack(track.id, { program: Number(target.value) });
              break;
            case "drums":
              session.updateTrack(track.id, { drums: target.checked });
              break;
            case "gain":
              session.updateTrack(track.id, { gain: Number(target.value) });
              break;
          }
        });
        row
          .querySelector<HTMLInputElement>('[data-field="gain"]')!
          .addEventListener("input", (event) => {
            row.querySelector("output")!.textContent =
              `${Math.round(Number((event.target as HTMLInputElement).value) * 100)}%`;
          });
        root.append(row);
      }
      this.key = key;
    }
    project.tracks.forEach((track, index) => {
      const row = root.children[index] as HTMLElement;
      row.setAttribute("aria-label", track.name);
      row.classList.toggle("active", session.trackId === track.id);
      row.classList.toggle("inaudible", !trackAudible(project, track));
      row.style.setProperty(
        "--track-colour",
        `hsl(${trackHue(index) * 360} 65% 58%)`,
      );
      row.querySelector("[data-name]")!.textContent = track.name;
      row
        .querySelector('[data-action="activate"]')!
        .setAttribute("aria-pressed", String(session.trackId === track.id));
      row
        .querySelector('[data-action="mute"]')!
        .setAttribute("aria-pressed", String(track.muted));
      row
        .querySelector('[data-action="solo"]')!
        .setAttribute("aria-pressed", String(!!track.solo));
      row
        .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]")
        .forEach((input) => {
          const field = input.dataset.field;
          if (document.activeElement !== input)
            input.value = String(
              field === "name"
                ? track.name
                : field === "gain"
                  ? track.gain
                  : (track.program ?? 0),
            );
          if (field === "drums")
            (input as HTMLInputElement).checked = !!track.drums;
          if (field === "program") input.disabled = !!track.drums;
          input.setAttribute(
            "aria-label",
            `${track.name} ${field === "program" ? "instrument" : field}`,
          );
        });
      row.querySelector("output")!.textContent =
        `${Math.round(track.gain * 100)}%`;
      const changes = [
        (project.programChanges ?? []).filter((e) => e.trackId === track.id)
          .length,
        (project.sustain ?? []).filter((e) => e.trackId === track.id).length,
        (project.pitchBends ?? []).filter((e) => e.trackId === track.id).length,
      ];
      const expression =
        row.querySelector<HTMLOutputElement>("[data-expression]")!;
      expression.hidden = !changes.some(Boolean);
      expression.textContent = changes
        .map((count, i) =>
          count ? `${["Programs", "Pedal", "Bend"][i]} ${count}` : "",
        )
        .filter(Boolean)
        .join(" · ");
    });
  }
}
