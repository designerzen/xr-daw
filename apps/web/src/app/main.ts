import { World, VisibilityState } from "@iwsdk/core";
import projectOptions from "virtual:iwsdk-project";
import { encodeWav, exportWav } from "./audio";
import { importMidi } from "./midi";
import { restoreProject, saveProject } from "./persistence";
import { demoProject, projectEnd, validateProject } from "./project";
import { Session } from "./session";
import { sequencerSystem } from "./sequencer-system";
import { waveformSystem } from "./waveform-system";
import type { VinylCondition } from "./vinyl-playback";
import "./style.css";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const root = document.querySelector<HTMLElement>("#controls")!;
const icons: Record<string, string> = {
  play: "M8 5l11 7-11 7z",
  pause: "M8 5v14M16 5v14",
  stop: "M6 6h12v12H6z",
  file: "M3 7h7l2 2h9v11H3zM3 7V4h7l2 3",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  shorter: "M5 12h14",
  longer: "M5 12h14M12 5v14",
  audition: "M4 10h4l5-4v12l-5-4H4zM17 9q4 3 0 6",
  delete: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13",
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name]}"/></svg>`;
const iconButton = (id: string, label: string, name: string, className = "") =>
  `<button type="button" id="${id}" class="icon-button ${className}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
root.innerHTML = `
  <header class="app-header">
    <div class="identity"><h1>XR DAW</h1><span id="project-name"></span></div>
    <nav aria-label="Project">
      <details id="project-menu" class="menu file-menu">
        <summary aria-label="Project menu" title="Project menu">${icon("file")}</summary>
        <div class="menu-panel">
          <label class="file-button">Open media or project<input id="open" type="file" accept="audio/*,.wav,.wave,.mp3,.ogg,.flac,.m4a,.aiff,.aif,.mid,.midi,.json" /></label>
          <button id="preset">Open demo</button><hr />
          <button id="save">Save project</button><button id="export">Export WAV</button>
        </div>
      </details>
      <button id="enter-vr" disabled>Enter VR</button>
    </nav>
  </header>
  <nav class="view-navigation" aria-label="View">
    <button id="view-notes" type="button" aria-pressed="true">Notes</button>
    <button id="view-velocity" type="button" aria-pressed="false">Velocity</button>
    <button id="view-waveform" type="button" aria-pressed="false" hidden>Waveform</button>
  </nav>
  <section class="transport" aria-label="Transport">
    ${iconButton("play", "Play", "play", "primary")}${iconButton("stop", "Stop", "stop")}
    <span class="divider"></span>
    <select id="track" aria-label="Track" title="Track"></select>
    <label class="tempo"><input id="tempo" type="number" min="20" max="300" step="1" aria-label="Tempo" /><span>BPM</span></label>
    <label id="vinyl-control" class="vinyl-control" hidden><input id="vinyl-enabled" type="checkbox" /> Vinyl</label>
    <details id="edit-menu" class="menu edit-menu">
      <summary aria-label="Editing options" title="Editing options">${icon("settings")}</summary>
      <div class="menu-panel">
        <div class="menu-row"><label><input id="loop" type="checkbox" /> Loop</label><label><input id="mute" type="checkbox" /> Mute</label></div>
        <label>Gain <input id="gain" type="range" min="0" max="1" step="0.01" /></label><hr />
        <label id="vinyl-condition-control" hidden>Condition <select id="vinyl-condition" aria-label="Vinyl condition"><option value="clean">Clean</option><option value="worn">Worn</option><option value="damaged">Damaged</option></select></label>
        <div class="menu-row"><button id="previous">← Bars</button><button id="next">Bars →</button></div>
        <div class="menu-row"><button id="lower">Octave −</button><button id="higher">Octave +</button></div>
        <button id="seek">Play from this page</button><hr />
        <div class="menu-row"><button id="undo">Undo</button><button id="redo">Redo</button></div>
        <button id="add">Add note</button>
        <p class="shortcut-hint">Space to play · Arrows to edit<br />Shift + arrows to resize or transpose<br />Ctrl / Cmd + Z to undo</p>
      </div>
    </details>
  </section>
  <section id="note-inspector" class="note-inspector" aria-label="Note inspector" hidden>
    <span id="note-label"></span>
    ${iconButton("shorter", "Shorter note", "shorter")}${iconButton("longer", "Longer note", "longer")}
    <input id="velocity" type="range" min="0.01" max="1" step="0.01" aria-label="Velocity" title="Velocity" disabled />
    ${iconButton("audition", "Audition note", "audition")}${iconButton("delete", "Delete note", "delete")}
  </section>
  <span id="status" class="status" role="status" aria-live="polite">Starting studio…</span>
  <div id="drop-target" aria-hidden="true">Drop MIDI or audio</div>
  <output id="project-summary" class="sr-only"></output>
  <output id="position" class="sr-only">Bar 1 · Beat 1</output>
  <output id="selection" class="sr-only">Select a note to edit</output>
`;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const status = (message: string) => {
  element("status").textContent = message;
  element("status").classList.remove("visible");
};
const report = (error: unknown) => {
  console.error(error);
  status(error instanceof Error ? error.message : String(error));
  element("status").classList.add("visible");
};

const menus = [...root.querySelectorAll<HTMLDetailsElement>("details")];
const closeMenus = () =>
  menus.forEach((menu) => {
    menu.open = false;
  });
document.addEventListener("pointerdown", (event) => {
  if (!(event.target as HTMLElement).closest("details")) closeMenus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
});
menus.forEach((menu) =>
  menu.addEventListener("toggle", () => {
    if (menu.open)
      menus
        .filter((other) => other !== menu)
        .forEach((other) => {
          other.open = false;
        });
  }),
);

async function start() {
  let initial = demoProject();
  try {
    initial = (await restoreProject()) ?? initial;
  } catch (error) {
    report(error);
  }
  const session = new Session(initial);
  session.onError = report;
  session.clipPlayer.onError = report;
  const world = await World.create(
    element<HTMLDivElement>("scene-container"),
    projectOptions,
  );
  const resizeViewport = () => {
    if (world.session) return;
    const container = element("scene-container");
    const width = container.clientWidth;
    const height = container.clientHeight;
    world.camera.aspect = width / Math.max(1, height);
    world.camera.fov = Math.max(
      50,
      (2 * Math.atan(3.7 / (2 * 2.8 * world.camera.aspect)) * 180) / Math.PI,
    );
    world.camera.updateProjectionMatrix();
    world.renderer.setSize(width, height);
  };
  window.addEventListener("resize", resizeViewport);
  resizeViewport();
  world.registerSystem(sequencerSystem(session));
  world.registerSystem(waveformSystem(session));
  let lastRevision = session.store.revision;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let trackKey = "";
  let destroyed = false;

  function sync() {
    const waveform = session.view === "waveform";
    root.classList.toggle("audio-mode", waveform);
    element("vinyl-control").hidden = !waveform;
    element("vinyl-condition-control").hidden = !waveform;
    input("vinyl-enabled").checked = session.clipPlayer.vinylEnabled;
    input("vinyl-enabled").disabled = session.clipPlayer.vinylBusy;
    element<HTMLSelectElement>("vinyl-condition").value =
      session.clipPlayer.vinylCondition;
    element<HTMLSelectElement>("vinyl-condition").disabled =
      !session.clipPlayer.vinylEnabled || session.clipPlayer.vinylBusy;
    button("view-waveform").hidden = !session.clipPlayer.clip;
    for (const view of ["notes", "velocity", "waveform"] as const)
      button(`view-${view}`).setAttribute(
        "aria-pressed",
        String(session.view === view),
      );
    const project = session.store.project;
    const nextTrackKey = JSON.stringify(
      project.tracks.map((t) => [t.id, t.name]),
    );
    const select = element<HTMLSelectElement>("track");
    select.disabled = waveform;
    input("tempo").disabled = waveform;
    if (trackKey !== nextTrackKey) {
      select.replaceChildren(
        ...project.tracks.map((t) => {
          const option = document.createElement("option");
          option.value = t.id;
          option.textContent = t.name;
          return option;
        }),
      );
      trackKey = nextTrackKey;
    }
    select.value = session.trackId;
    input("tempo").value = String(
      Math.round(project.tempos[0].bpm * 100) / 100,
    );
    input("gain").value = String(
      waveform ? session.clipPlayer.gain : (session.track?.gain ?? 0.7),
    );
    input("mute").checked = waveform
      ? session.clipPlayer.muted
      : (session.track?.muted ?? false);
    const note = waveform ? undefined : session.store.selected;
    element("note-inspector").hidden = !note;
    if (note) {
      const pitchNames = [
        "C",
        "C♯",
        "D",
        "D♯",
        "E",
        "F",
        "F♯",
        "G",
        "G♯",
        "A",
        "A♯",
        "B",
      ];
      element("note-label").textContent =
        `${pitchNames[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}`;
    }
    element("selection").textContent = note
      ? `MIDI ${note.pitch} · ${(note.start / project.ppq).toFixed(2)} beats · ${(note.duration / project.ppq).toFixed(2)} long`
      : "Select a note to edit";
    input("velocity").disabled = !note;
    input("velocity").value = String(note?.velocity ?? 0.7);
    for (const id of ["shorter", "longer", "audition", "delete"])
      button(id).disabled = !note;
    button("undo").disabled = waveform || !session.store.canUndo;
    button("redo").disabled = waveform || !session.store.canRedo;
    for (const id of ["add", "lower", "higher"]) button(id).disabled = waveform;
    button("previous").disabled = waveform || session.pageTick === 0;
    button("next").disabled =
      waveform || session.pageTick + session.pageSize >= projectEnd(project);
    element("project-name").textContent = waveform
      ? session.clipPlayer.clip!.name
      : project.name;
    button("save").textContent = waveform ? "Download audio" : "Save project";
    element("project-summary").textContent = waveform
      ? `${session.clipPlayer.clip!.name} · ${session.clipPlayer.clip!.analysis.channels.reduce((count, channel) => count + channel.amplitudes.length, 0)} circles`
      : `${project.name} · ${project.notes.length} notes · ${session.visibleNotes.length} in view`;
    if (lastRevision !== session.store.revision) {
      lastRevision = session.store.revision;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void saveProject(session.store.project)
          .then(() => status("Saved on this device"))
          .catch(report);
      }, 400);
    }
  }
  const unsubscribe = session.subscribe(sync);
  sync();
  const handle = (id: string, action: () => void | Promise<void>) => {
    button(id).onclick = () => {
      Promise.resolve()
        .then(action)
        .then(() => {
          element<HTMLDetailsElement>("project-menu").open = false;
        })
        .catch(report);
    };
  };
  // Session requests must be made directly during the user's click, without awaiting file/audio loading.
  button("enter-vr").disabled = false;
  let requestingXR = false;
  button("enter-vr").onclick = () => {
    if (world.session) world.exitXR();
    else {
      world.renderer.setSize(window.innerWidth, window.innerHeight);
      requestingXR = true;
      void session.audio.unlock().catch(report);
      world.launchXR();
    }
  };
  const visibilityCleanup = world.visibilityState.subscribe((value) => {
    const immersive = value !== VisibilityState.NonImmersive;
    root.classList.toggle("immersive", immersive);
    button("enter-vr").textContent = immersive ? "Exit VR" : "Enter VR";
    if (!immersive) {
      resizeViewport();
    }
    if (
      value === VisibilityState.Hidden ||
      value === VisibilityState.VisibleBlurred
    )
      session.pause();
  });
  handle("play", () => session.togglePlay());
  handle("stop", () => session.stop());
  handle("view-notes", () => session.setView("notes"));
  handle("view-velocity", () => session.setView("velocity"));
  handle("view-waveform", () => session.setView("waveform"));
  handle("previous", () => session.page(-1));
  handle("next", () => session.page(1));
  handle("lower", () => session.scrollPitch(-1));
  handle("higher", () => session.scrollPitch(1));
  handle("seek", async () => {
    if (session.view === "waveform") await session.clipPlayer.play(0);
    else await session.audio.play(session.store.project, session.pageTick);
  });
  handle("shorter", () => session.resize(-1));
  handle("longer", () => session.resize(1));
  handle("undo", () => session.store.undo());
  handle("redo", () => session.store.redo());
  handle("add", () => session.addNote());
  handle("delete", () => session.deleteNote());
  handle("audition", async () => {
    if (session.store.selected)
      await session.audio.audition(session.store.selected, session.track?.gain);
  });
  input("loop").onchange = () => {
    session.audio.loop = input("loop").checked;
    session.clipPlayer.loop = input("loop").checked;
  };
  const configureVinyl = async () => {
    const condition = element<HTMLSelectElement>("vinyl-condition")
      .value as VinylCondition;
    const operation = session.clipPlayer.configureVinyl(
      input("vinyl-enabled").checked,
      condition,
    );
    session.emit();
    status("Preparing vinyl…");
    element("status").classList.add("visible");
    try {
      await operation;
      status("Audio ready");
    } catch (error) {
      report(error);
    } finally {
      session.emit();
    }
  };
  input("vinyl-enabled").onchange = () => {
    void configureVinyl();
  };
  element<HTMLSelectElement>("vinyl-condition").onchange = () => {
    void configureVinyl();
  };
  input("tempo").onchange = () => {
    const bpm = Number(input("tempo").value);
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) {
      sync();
      return;
    }
    // Scale all tempo changes together, preserving the imported tempo map's relative changes.
    const ratio = bpm / session.store.project.tempos[0].bpm;
    try {
      session.store.edit((p) => {
        p.tempos.forEach((t) => {
          t.bpm *= ratio;
        });
      });
    } catch (error) {
      report(error);
      sync();
    }
  };
  element<HTMLSelectElement>("track").onchange = (event) =>
    session.selectTrack((event.target as HTMLSelectElement).value);
  input("gain").onchange = () =>
    session.view === "waveform"
      ? (session.clipPlayer.gain = Number(input("gain").value))
      : session.store.edit((p) => {
          const t = p.tracks.find((t) => t.id === session.trackId);
          if (t) t.gain = Number(input("gain").value);
        });
  input("mute").onchange = () =>
    session.view === "waveform"
      ? (session.clipPlayer.muted = input("mute").checked)
      : session.store.edit((p) => {
          const t = p.tracks.find((t) => t.id === session.trackId);
          if (t) t.muted = input("mute").checked;
        });
  input("velocity").onchange = () => {
    if (session.store.selected)
      session.store.updateNote(session.store.selected.id, {
        velocity: Number(input("velocity").value),
      });
  };
  const fileName = () =>
    session.store.project.name.replace(/[^\w -]/g, "").trim() || "xr-daw";
  handle("save", () =>
    session.view === "waveform"
      ? download(session.clipPlayer.clip!.file, session.clipPlayer.clip!.name)
      : download(
          new Blob([JSON.stringify(session.store.project, null, 2)], {
            type: "application/json",
          }),
          `${fileName()}.xrdaw.json`,
        ),
  );
  handle("export", async () => {
    button("export").disabled = true;
    status("Rendering WAV…");
    try {
      const clip =
        session.view === "waveform" ? session.clipPlayer.clip : undefined;
      download(
        clip
          ? encodeWav(await session.clipPlayer.exportBuffer())
          : await exportWav(session.store.project),
        `${clip ? clip.name.replace(/\.[^.]+$/, "") + (session.clipPlayer.vinylEnabled ? `-vinyl-${session.clipPlayer.vinylCondition}` : "") : fileName()}.wav`,
      );
      status("WAV exported");
    } finally {
      button("export").disabled = false;
    }
  });
  handle("preset", async () => {
    const request = ++mediaRequest;
    session.clipPlayer.cancelDecode();
    const response = await fetch(
      `${import.meta.env.BASE_URL}assets/midi/Stories_100BPM_Gmin.mid`,
    );
    if (!response.ok)
      throw new Error(`Could not load preset (${response.status}).`);
    if (request !== mediaRequest || destroyed) return;
    session.load(
      importMidi(new Uint8Array(await response.arrayBuffer()), "Stories"),
    );
    status("Preset imported");
  });
  let mediaRequest = 0;
  const loadMedia = async (file: File) => {
    const request = ++mediaRequest;
    session.clipPlayer.cancelDecode();
    try {
      const musical = /\.(json|midi?)$/i.test(file.name);
      if (file.size > (musical ? 10 : 100) * 1024 * 1024)
        throw new Error(
          musical
            ? "MIDI and project files must be smaller than 10 MB."
            : "Audio files must be smaller than 100 MB.",
        );
      if (!musical) {
        status("Decoding audio and analyzing spectrum…");
        element("status").classList.add("visible");
        const clip = await session.clipPlayer.decode(file);
        if (request !== mediaRequest || destroyed) return;
        session.loadClip(clip);
        if (session.clipPlayer.vinylEnabled) {
          const operation = session.clipPlayer.configureVinyl(true);
          session.emit();
          await operation;
          if (request !== mediaRequest || destroyed) return;
          session.emit();
        }
        status("Audio ready · click to play, drag to scratch");
        return;
      }
      const project = /\.json$/i.test(file.name)
        ? validateProject(JSON.parse(await file.text()))
        : importMidi(
            new Uint8Array(await file.arrayBuffer()),
            file.name.replace(/\.midi?$/i, ""),
          );
      if (request !== mediaRequest || destroyed) return;
      session.load(project);
      status("Project loaded");
    } catch (error) {
      if (request === mediaRequest && !destroyed) report(error);
    }
  };
  input("open").onchange = () => {
    const file = input("open").files?.[0];
    input("open").value = "";
    if (file) void loadMedia(file);
  };
  let dragDepth = 0;
  const dragEnter = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    element("drop-target").classList.add("visible");
  };
  const dragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const dragLeave = () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      element("drop-target").classList.remove("visible");
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth = 0;
    element("drop-target").classList.remove("visible");
    const file = event.dataTransfer?.files[0];
    if (file) void loadMedia(file);
  };
  window.addEventListener("dragenter", dragEnter);
  window.addEventListener("dragover", dragOver);
  window.addEventListener("dragleave", dragLeave);
  window.addEventListener("drop", drop);
  const keyboard = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input, select, textarea, button, summary, [contenteditable]",
      )
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      void session.togglePlay().catch(report);
    }
    if (session.view === "waveform") {
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        void session.clipPlayer
          .play(
            session.clipPlayer.positionSeconds +
              (event.code === "ArrowLeft" ? -1 : 1),
          )
          .catch(report);
      }
      return;
    }
    if (event.code === "Delete" || event.code === "Backspace") {
      event.preventDefault();
      session.deleteNote();
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
      event.preventDefault();
      event.shiftKey ? session.store.redo() : session.store.undo();
    }
    if (event.code.startsWith("Arrow") && session.store.selected) {
      event.preventDefault();
      if (event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.code))
        session.resize(event.code === "ArrowLeft" ? -1 : 1);
      else
        session.nudge(
          event.code === "ArrowLeft" ? -1 : event.code === "ArrowRight" ? 1 : 0,
          (event.code === "ArrowUp" ? 1 : event.code === "ArrowDown" ? -1 : 0) *
            (event.shiftKey ? 12 : 1),
        );
    }
  };
  window.addEventListener("keydown", keyboard);
  const interval = setInterval(() => {
    if (requestingXR && !world.sessionRequestPending) {
      requestingXR = false;
      if (!world.session) {
        resizeViewport();
        report(
          new Error(
            "VR did not start. Check headset support and browser permissions.",
          ),
        );
      }
    }
    const beats = session.audio.positionTick / session.store.project.ppq;
    element("position").textContent =
      session.view === "waveform"
        ? `${session.clipPlayer.positionSeconds.toFixed(2)}s / ${session.clipPlayer.clip!.buffer.duration.toFixed(2)}s`
        : `Bar ${Math.floor(beats / 4) + 1} · Beat ${((beats % 4) + 1).toFixed(1)}`;
    const playLabel = session.playing ? "Pause" : "Play";
    if (button("play").getAttribute("aria-label") !== playLabel) {
      button("play").setAttribute("aria-label", playLabel);
      button("play").title = playLabel;
      button("play").innerHTML = icon(session.audio.playing ? "pause" : "play");
    }
  }, 100);
  const dispose = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(saveTimer);
    clearInterval(interval);
    unsubscribe();
    visibilityCleanup();
    window.removeEventListener("keydown", keyboard);
    window.removeEventListener("resize", resizeViewport);
    window.removeEventListener("dragenter", dragEnter);
    window.removeEventListener("dragover", dragOver);
    window.removeEventListener("dragleave", dragLeave);
    window.removeEventListener("drop", drop);
    void saveProject(session.store.project).catch(console.error);
    session.dispose();
    world.destroy();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  status("Ready · autosaves on this device");
}

void start().catch(report);
