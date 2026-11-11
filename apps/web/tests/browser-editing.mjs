import assert from "node:assert/strict";

// Note editing with real pointer input: draw, multi-select, repeat, deselect, erase and undo.
export default async function run({ frame, page }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
    name: "Editing",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
    notes: [60, 64].map((pitch, i) => ({
      id: `edit-${i}`,
      trackId: "keys",
      pitch,
      start: i * 480,
      duration: 480,
      velocity: 0.6,
    })),
  };
  await frame.locator("#open").setInputFiles({
    name: "editing.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const notes = (count) =>
    frame.waitForFunction(
      (count) =>
        document
          .querySelector("#project-summary")
          .textContent.includes(`Editing · ${count} notes`),
      count,
    );
  await notes(2);
  await frame.locator("#timeline-span").selectOption("4");
  // Screen position of a note, or of a point beside it on the board (offset in world units).
  const screen = (id, dx = 0, dy = 0, board = false) =>
    frame.evaluate(
      ({ id, dx, dy, board }) => {
        const world = window.FRAMEWORK_MCP_RUNTIME.world;
        let target;
        world.scene.traverse((object) => {
          if (object.userData.noteId === id) target = object;
        });
        if (!target) throw new Error(`Note ${id} is missing`);
        const point = target.getWorldPosition(target.position.clone());
        point.x += dx;
        point.y += dy;
        if (board) point.z = -2.1 - 0.022;
        point.project(world.camera);
        const canvas = world.renderer.domElement;
        return {
          x: ((point.x + 1) / 2) * canvas.clientWidth,
          y: ((1 - point.y) / 2) * canvas.clientHeight,
        };
      },
      { id, dx, dy, board },
    );
  const canvas = frame.locator("#scene-container canvas");
  await page.waitForTimeout(500);

  // Draw: hovering previews the note; a click adds it in the grid cell under the pointer.
  await frame.locator("#tool-draw").click();
  assert.equal(
    await frame.locator("#tool-draw").getAttribute("aria-pressed"),
    "true",
  );
  const beat = 3.2 / 16;
  const drawAt = await screen("edit-0", beat * 2.6, 0, true);
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + drawAt.x, bounds.y + drawAt.y);
  await frame.waitForFunction(
    () =>
      window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Draw preview")
        .visible,
  );
  await canvas.click({ position: drawAt });
  await notes(3);
  const drawn = await frame.evaluate(
    () => document.querySelector("#selection").textContent,
  );
  assert.match(drawn, /MIDI 60 · 3\.00 beats · 1\.00 long/);

  // Select: Ctrl-click builds a selection, and Ctrl+D repeats it after itself.
  await frame.locator("#tool-select").click();
  await canvas.click({ position: await screen("edit-0") });
  await canvas.click({
    position: await screen("edit-1"),
    modifiers: ["Control"],
  });
  await frame.waitForFunction(
    () => document.querySelector("#note-label").textContent === "2 notes",
  );
  await page.keyboard.press("Control+d");
  await notes(5);
  assert.equal(
    await frame.locator("#note-label").textContent(),
    "2 notes",
    "the repeat is selected",
  );

  // A tap on empty space clears the selection.
  const empty = await screen("edit-0", 0, 0.9);
  await canvas.click({ position: empty });
  await frame.waitForFunction(
    () => document.querySelector("#note-inspector").hidden,
  );

  // Erase removes a note on click; undo brings it back.
  await frame.locator("#tool-erase").click();
  await page.waitForTimeout(200);
  await canvas.click({ position: await screen("edit-1") });
  await notes(4);
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await notes(5);
  await page.keyboard.press("v");
  assert.equal(
    await frame.locator("#tool-select").getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: "artifacts/note-editing.png" });
  assert.deepEqual(errors, []);
  return { draw: true, multiSelect: true, repeat: true, erase: true };
}
