import { World, VisibilityState } from "@iwsdk/core";
import projectOptions from "virtual:iwsdk-project";
import { exportWav } from "./audio";
import { importMidi } from "./midi";
import { restoreProject, saveProject } from "./persistence";
import { demoProject, projectEnd, validateProject } from "./project";
import { Session } from "./session";
import { sequencerSystem } from "./sequencer-system";
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
root.innerHTML = `
  <header><div><span class="eyebrow">IMMERSIVE WEB STUDIO</span><h1>XR DAW</h1></div><button id="enter-vr" disabled>Enter VR</button></header>
  <section class="toolbar" aria-label="Project">
    <label class="file-button">Open MIDI / project<input id="open" type="file" accept=".mid,.midi,.json" /></label>
    <button id="preset">Load preset MIDI</button><button id="save">Download project</button><button id="export">Export WAV</button>
  </section>
  <section class="toolbar" aria-label="Transport">
    <button id="play" class="primary">Play</button><button id="stop">Stop</button>
    <label><input id="loop" type="checkbox" /> Loop project</label>
    <label>Tempo <input id="tempo" type="number" min="20" max="300" step="1" /> BPM</label>
    <output id="position">Bar 1 · Beat 1</output>
  </section>
  <section class="toolbar" aria-label="Track and timeline">
    <label>Track <select id="track"></select></label>
    <label>Gain <input id="gain" type="range" min="0" max="1" step="0.01" /></label>
    <label><input id="mute" type="checkbox" /> Mute</label>
    <button id="previous">← Bars</button><button id="next">Bars →</button><button id="seek">Play from view</button>
    <button id="lower">Octave ↓</button><button id="higher">Octave ↑</button>
  </section>
  <section class="toolbar" aria-label="Note inspector">
    <output id="selection">Select a note to edit</output>
    <button id="shorter">Shorter</button><button id="longer">Longer</button>
    <label>Velocity <input id="velocity" type="range" min="0.01" max="1" step="0.01" disabled /></label>
    <button id="audition">Audition</button><button id="add">Add note</button><button id="delete">Delete</button><button id="undo">Undo</button><button id="redo">Redo</button>
  </section>
  <footer><span id="project-name"></span><span id="status" role="status" aria-live="polite">Starting studio…</span></footer>
  <p class="help">Drag notes to move them; edits snap to sixteenths. Arrow keys move the selected note. Shift + arrows resize or transpose by octave. Space plays or pauses. Ctrl/Cmd + Z undoes. In VR, use the transport panel below the timeline.</p>
`;
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const status = (message: string) => {
  element("status").textContent = message;
};
const report = (error: unknown) => {
  console.error(error);
  status(error instanceof Error ? error.message : String(error));
};

async function start() {
  let initial = demoProject();
  try {
    initial = (await restoreProject()) ?? initial;
  } catch (error) {
    report(error);
  }
  const session = new Session(initial);
  session.onError = report;
  let activeWorld: World | undefined;
  const desktopLayout = () => {
    if (activeWorld?.session || activeWorld?.sessionRequestPending) return;
    const container = element("scene-container");
    container.style.top = `${root.getBoundingClientRect().bottom + 8}px`;
    container.style.bottom = "55px";
    window.dispatchEvent(new Event("resize"));
  };
  const resizeControls = new ResizeObserver(desktopLayout);
  resizeControls.observe(root);
  const world = await World.create(
    element<HTMLDivElement>("scene-container"),
    projectOptions,
  );
  activeWorld = world;
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
  let lastRevision = session.store.revision;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let trackKey = "";
  let destroyed = false;

  function sync() {
    const project = session.store.project;
    const nextTrackKey = JSON.stringify(
      project.tracks.map((t) => [t.id, t.name]),
    );
    const select = element<HTMLSelectElement>("track");
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
    input("gain").value = String(session.track?.gain ?? 0.7);
    input("mute").checked = session.track?.muted ?? false;
    const note = session.store.selected;
    element("selection").textContent = note
      ? `MIDI ${note.pitch} · ${(note.start / project.ppq).toFixed(2)} beats · ${(note.duration / project.ppq).toFixed(2)} long`
      : "Select a note to edit";
    input("velocity").disabled = !note;
    input("velocity").value = String(note?.velocity ?? 0.7);
    for (const id of ["shorter", "longer", "audition", "delete"])
      button(id).disabled = !note;
    button("undo").disabled = !session.store.canUndo;
    button("redo").disabled = !session.store.canRedo;
    button("previous").disabled = session.pageTick === 0;
    button("next").disabled =
      session.pageTick + session.pageSize >= projectEnd(project);
    element("project-name").textContent =
      `${project.name} · ${project.notes.length} notes · ${session.visibleNotes.length} in view`;
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
      Promise.resolve().then(action).catch(report);
    };
  };
  // Session requests must be made directly during the user's click, without awaiting file/audio loading.
  button("enter-vr").disabled = false;
  let requestingXR = false;
  button("enter-vr").onclick = () => {
    if (world.session) world.exitXR();
    else {
      // IWER preserves the canvas CSS aspect at entry. Expand it before requesting
      // a session so a short desktop editing viewport doesn't become a thin XR view.
      element("scene-container").style.top = "0";
      element("scene-container").style.bottom = "0";
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
      desktopLayout();
      resizeViewport();
    }
    if (
      value === VisibilityState.Hidden ||
      value === VisibilityState.VisibleBlurred
    )
      session.audio.pause();
  });
  handle("play", () => session.togglePlay());
  handle("stop", () => session.stop());
  handle("previous", () => session.page(-1));
  handle("next", () => session.page(1));
  handle("lower", () => session.scrollPitch(-1));
  handle("higher", () => session.scrollPitch(1));
  handle("seek", async () => {
    await session.audio.play(session.store.project, session.pageTick);
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
    session.store.edit((p) => {
      const t = p.tracks.find((t) => t.id === session.trackId);
      if (t) t.gain = Number(input("gain").value);
    });
  input("mute").onchange = () =>
    session.store.edit((p) => {
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
    download(
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
      download(await exportWav(session.store.project), `${fileName()}.wav`);
      status("WAV exported");
    } finally {
      button("export").disabled = false;
    }
  });
  handle("preset", async () => {
    const response = await fetch(
      `${import.meta.env.BASE_URL}assets/midi/Stories_100BPM_Gmin.mid`,
    );
    if (!response.ok)
      throw new Error(`Could not load preset (${response.status}).`);
    session.load(
      importMidi(new Uint8Array(await response.arrayBuffer()), "Stories"),
    );
    status("Preset imported");
  });
  input("open").onchange = async () => {
    const file = input("open").files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Files must be smaller than 10 MB.");
      const project = /\.json$/i.test(file.name)
        ? validateProject(JSON.parse(await file.text()))
        : importMidi(
            new Uint8Array(await file.arrayBuffer()),
            file.name.replace(/\.midi?$/i, ""),
          );
      session.load(project);
      status("Project loaded");
    } catch (error) {
      report(error);
    } finally {
      input("open").value = "";
    }
  };
  const keyboard = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea, button, [contenteditable]"))
      return;
    if (event.code === "Space") {
      event.preventDefault();
      void session.togglePlay().catch(report);
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
        desktopLayout();
        resizeViewport();
        status(
          "VR did not start. Check headset support and browser permissions.",
        );
      }
    }
    const beats = session.audio.positionTick / session.store.project.ppq;
    element("position").textContent =
      `Bar ${Math.floor(beats / 4) + 1} · Beat ${((beats % 4) + 1).toFixed(1)}`;
    button("play").textContent = session.audio.playing ? "Pause" : "Play";
  }, 100);
  const dispose = () => {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(saveTimer);
    clearInterval(interval);
    unsubscribe();
    visibilityCleanup();
    resizeControls.disconnect();
    window.removeEventListener("keydown", keyboard);
    window.removeEventListener("resize", resizeViewport);
    void saveProject(session.store.project).catch(console.error);
    session.dispose();
    world.destroy();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  status("Ready · autosaves on this device");
}

void start().catch(report);
