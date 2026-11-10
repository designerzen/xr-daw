// Run against IWSDK's managed browser: npx @iwsdk/cli browser run tests/browser-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export default async function run({ frame, page, workspaceRoot }) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await frame.goto(frame.url(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await frame.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("Ready"),
    null,
    { timeout: 60000 },
  );
  const project = {
    version: 1,
    name: "Browser smoke",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
    notes: [60, 64, 67].map((pitch, i) => ({
      id: `smoke-${i}`,
      trackId: "keys",
      pitch,
      start: i * 480,
      duration: 360,
      velocity: [0.25, 0.5, 1][i],
    })),
  };
  const loadProject = async (value, name = "smoke.xrdaw.json") => {
    await frame.locator("#open").setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
  };
  const options = async () => {
    if (!(await frame.locator("#edit-menu").evaluate((menu) => menu.open)))
      await frame.locator("#edit-menu > summary").click();
  };
  const files = async () => {
    if (!(await frame.locator("#project-menu").evaluate((menu) => menu.open)))
      await frame.locator("#project-menu > summary").click();
  };
  assert.equal(await frame.locator("#note-inspector").isVisible(), false);
  assert.equal(
    await frame.locator("#save").isVisible(),
    false,
    "file tools are tucked away",
  );
  assert.equal(
    await frame.locator("#add").isVisible(),
    false,
    "editing options are tucked away",
  );
  const viewport = await frame.evaluate(() => ({
    canvas: document.querySelector("#scene-container").getBoundingClientRect()
      .height,
    height: innerHeight,
  }));
  assert.equal(
    viewport.canvas,
    viewport.height,
    "the scene uses the full viewport",
  );
  await loadProject(project);
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.includes("Browser smoke · 3 notes"),
  );
  await frame.waitForFunction(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
      "Note smoke-2 pitch 67",
    ),
  );
  const volumes = await frame.evaluate(() => {
    const world = window.FRAMEWORK_MCP_RUNTIME.world;
    return [60, 64, 67].map((pitch, i) => {
      const mesh = world.scene.getObjectByName(
        `Note smoke-${i} pitch ${pitch}`,
      );
      return {
        depth: mesh.geometry.parameters.depth,
        width: mesh.geometry.parameters.width,
        rear: mesh.position.z - mesh.geometry.parameters.depth / 2,
      };
    });
  });
  assert.deepEqual(
    volumes.map((note) => note.depth),
    [0.2, 0.4, 0.8],
  );
  assert.ok(
    volumes.every((note) => Math.abs(note.rear + 2.1) < 1e-6),
    "velocity depths share a baseline",
  );
  assert.ok(
    volumes.every((note) => note.width === volumes[0].width),
    "velocity does not change duration geometry",
  );
  const notePoint = async (id) => {
    return frame.evaluate((id) => {
      const world = window.FRAMEWORK_MCP_RUNTIME.world;
      const object = world.scene.getObjectByName(
        `Note ${id} pitch ${id === "smoke-0" ? 60 : 64}`,
      );
      if (!object) throw new Error("Note mesh is missing");
      const point = object
        .getWorldPosition(object.position.clone())
        .project(world.camera);
      const canvas = world.renderer.domElement;
      return {
        x: ((point.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - point.y) / 2) * canvas.clientHeight,
      };
    }, id);
  };
  const canvas = frame.locator("#scene-container canvas");
  const point = await notePoint("smoke-0");
  await canvas.click({ position: point });
  await frame.waitForFunction(() =>
    document.querySelector("#selection").textContent.includes("MIDI 60"),
  );
  await frame.locator("#velocity").evaluate((input) => {
    input.value = "0.75";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await frame.waitForFunction(() => {
    const mesh = window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
      "Note smoke-0 pitch 60",
    );
    return (
      Math.abs(mesh.geometry.parameters.depth - 0.6) < 1e-6 &&
      Math.abs(mesh.position.z - mesh.geometry.parameters.depth / 2 + 2.1) <
        1e-6
    );
  });
  const selectionBeforeView = await frame.locator("#selection").textContent();
  await frame.locator("#view-velocity").click();
  await frame.waitForFunction(() => {
    const world = window.FRAMEWORK_MCP_RUNTIME.world;
    return (
      Math.abs(
        world.scene.getObjectByName("Sequencer view").rotation.x + Math.PI / 2,
      ) < 1e-6
    );
  });
  assert.equal(
    await frame.locator("#view-velocity").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await frame.locator("#selection").textContent(),
    selectionBeforeView,
  );
  await frame.locator("#view-notes").click();
  await frame.waitForFunction(
    () =>
      window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Sequencer view")
        .rotation.x === 0,
  );
  await frame.locator("#longer").click();
  await frame.waitForFunction(() =>
    document.querySelector("#selection").textContent.includes("1.00 long"),
  );
  await options();
  await frame.locator("#undo").click();
  await frame.waitForFunction(() =>
    document.querySelector("#selection").textContent.includes("0.75 long"),
  );
  await frame.locator("#redo").click();
  await frame.waitForFunction(() =>
    document.querySelector("#selection").textContent.includes("1.00 long"),
  );
  // Real mouse events exercise IWSDK capture and the release-to-command bridge.
  const dragPoint = await notePoint("smoke-0");
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + dragPoint.x, bounds.y + dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + dragPoint.x + 45,
    bounds.y + dragPoint.y - 18,
    { steps: 12 },
  );
  await page.mouse.up();
  await frame.waitForFunction(
    () =>
      !document
        .querySelector("#selection")
        .textContent.includes("MIDI 60 · 0.00 beats"),
  );
  const edited = await frame.locator("#selection").textContent();
  await frame.locator("#play").click();
  await frame.waitForFunction(
    () =>
      document.querySelector("#play").getAttribute("aria-label") === "Pause",
  );
  await frame.waitForFunction(
    () => !document.querySelector("#position").textContent.endsWith("Beat 1.0"),
  );
  await frame.locator("#view-velocity").click();
  assert.equal(
    await frame.locator("#play").getAttribute("aria-label"),
    "Pause",
  );
  assert.ok(
    !(await frame.locator("#position").textContent()).endsWith("Beat 1.0"),
  );
  await frame.locator("#view-notes").click();
  await frame.locator("#stop").click();
  await frame.waitForFunction(() =>
    document.querySelector("#position").textContent.endsWith("Beat 1.0"),
  );
  await options();
  await frame.locator("#add").click();
  await frame.waitForFunction(() =>
    document.querySelector("#project-summary").textContent.includes("4 notes"),
  );
  await frame.locator("#delete").click();
  await frame.waitForFunction(() =>
    document.querySelector("#project-summary").textContent.includes("3 notes"),
  );
  await frame.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Saved"),
  );

  const directory = path.join(workspaceRoot, "artifacts");
  await mkdir(directory, { recursive: true });
  const download = page.waitForEvent("download");
  await files();
  await frame.locator("#save").click();
  const saved = await download;
  const projectPath = path.join(directory, "smoke.xrdaw.json");
  await saved.saveAs(projectPath);
  const savedProject = JSON.parse(await readFile(projectPath, "utf8"));
  assert.notEqual(
    savedProject.notes[0].start,
    0,
    "mouse drag must persist musical time",
  );
  assert.equal(savedProject.notes[0].duration, 480);
  assert.equal(
    savedProject.notes[0].velocity,
    0.75,
    "time/pitch dragging preserves velocity",
  );
  // Invalid imports leave the current project intact.
  await loadProject({ version: 99 });
  await frame.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("invalid"),
  );
  assert.match(
    await frame.locator("#project-summary").textContent(),
    /Browser smoke · 3 notes/,
  );
  await frame.goto(frame.url(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await frame.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("Ready"),
    null,
    { timeout: 60000 },
  );
  assert.match(
    await frame.locator("#project-summary").textContent(),
    /Browser smoke · 3 notes/,
  );
  await files();
  await frame.locator("#preset").click();
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.startsWith("Stories"),
  );
  const imported = await frame.locator("#project-summary").textContent();
  await loadProject(savedProject);
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.startsWith("Browser smoke"),
  );
  const wavDownload = page.waitForEvent("download");
  await files();
  await frame.locator("#export").click();
  const wav = await wavDownload;
  const wavPath = path.join(directory, "smoke.wav");
  await wav.saveAs(wavPath);
  const bytes = await readFile(wavPath);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.ok(bytes.length > 10000);
  assert.ok(
    bytes.subarray(44).some((byte) => byte !== 0),
    "rendered WAV contains sound",
  );
  page.off("pageerror", onError);
  assert.deepEqual(errors, []);
  return {
    edited,
    imported,
    wavBytes: bytes.length,
    projectPath,
    wavPath,
    errors,
  };
}
