// Run against IWSDK's managed browser: npx @iwsdk/cli browser run tests/browser-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export default async function run({ frame, page, workspaceRoot }) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await frame.goto(frame.url());
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
      velocity: 0.7,
    })),
  };
  const loadProject = async (value, name = "smoke.xrdaw.json") => {
    await frame
      .locator("#open")
      .setInputFiles({
        name,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(value)),
      });
  };
  await loadProject(project);
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-name")
      .textContent.includes("Browser smoke · 3 notes"),
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
  await frame.locator("#longer").click();
  await frame.waitForFunction(() =>
    document.querySelector("#selection").textContent.includes("1.00 long"),
  );
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
    () => document.querySelector("#play").textContent === "Pause",
  );
  await frame.waitForFunction(
    () => !document.querySelector("#position").textContent.endsWith("Beat 1.0"),
  );
  await frame.locator("#stop").click();
  await frame.waitForFunction(() =>
    document.querySelector("#position").textContent.endsWith("Beat 1.0"),
  );
  await frame.locator("#add").click();
  await frame.waitForFunction(() =>
    document.querySelector("#project-name").textContent.includes("4 notes"),
  );
  await frame.locator("#delete").click();
  await frame.waitForFunction(() =>
    document.querySelector("#project-name").textContent.includes("3 notes"),
  );
  await frame.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Saved"),
  );

  const directory = path.join(workspaceRoot, "artifacts");
  await mkdir(directory, { recursive: true });
  const download = page.waitForEvent("download");
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
  // Invalid imports leave the current project intact.
  await loadProject({ version: 99 });
  await frame.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("invalid"),
  );
  assert.match(
    await frame.locator("#project-name").textContent(),
    /Browser smoke · 3 notes/,
  );
  await frame.goto(frame.url());
  await frame.waitForFunction(
    () => document.querySelector("#status")?.textContent.includes("Ready"),
    null,
    { timeout: 60000 },
  );
  assert.match(
    await frame.locator("#project-name").textContent(),
    /Browser smoke · 3 notes/,
  );
  await frame.locator("#preset").click();
  await frame.waitForFunction(() =>
    document.querySelector("#project-name").textContent.startsWith("Stories"),
  );
  const imported = await frame.locator("#project-name").textContent();
  await loadProject(savedProject);
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-name")
      .textContent.startsWith("Browser smoke"),
  );
  const wavDownload = page.waitForEvent("download");
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
