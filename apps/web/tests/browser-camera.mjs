import assert from "node:assert/strict";

// Parallel cameras fill the clear screen area, keep picking exact, and show every track.
export default async function run({ frame, page }) {
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
    name: "Camera fit",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [
      { id: "lead", name: "Lead", gain: 0.7, muted: false },
      { id: "bass", name: "Bass", gain: 0.7, muted: false },
    ],
    notes: [
      {
        id: "lead-0",
        trackId: "lead",
        pitch: 84,
        start: 0,
        duration: 960,
        velocity: 0.9,
      },
      {
        id: "lead-1",
        trackId: "lead",
        pitch: 79,
        start: 1920,
        duration: 960,
        velocity: 0.6,
      },
      {
        id: "bass-0",
        trackId: "bass",
        pitch: 36,
        start: 480,
        duration: 1440,
        velocity: 0.8,
      },
      {
        id: "bass-1",
        trackId: "bass",
        pitch: 31,
        start: 4800,
        duration: 960,
        velocity: 0.4,
      },
    ],
  };
  await frame.locator("#open").setInputFiles({
    name: "camera.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await frame.waitForFunction(
    () => document.querySelector("#project-name").textContent === "Camera fit",
  );
  assert.equal(await frame.locator("#track").inputValue(), "*");
  const hasNote = (id) =>
    frame.evaluate(
      (id) =>
        !!window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByProperty(
          "name",
          `Note ${id} pitch ${{ "lead-0": 84, "bass-0": 36 }[id]}`,
        ),
      id,
    );
  await frame.waitForFunction(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
      "Note bass-0 pitch 36",
    ),
  );
  assert.equal(await hasNote("lead-0"), true, "lead and bass share the board");
  assert.equal(await hasNote("bass-0"), true);

  // Screen rectangle of the board and of a note, under the active camera.
  const measure = (id) =>
    frame.evaluate((id) => {
      const world = window.FRAMEWORK_MCP_RUNTIME.world;
      const canvas = world.renderer.domElement.getBoundingClientRect();
      const rect = (object) => {
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity;
        for (let i = 0; i < 8; i++) {
          const p = object.localToWorld(
            box.min
              .clone()
              .set(
                i & 1 ? box.max.x : box.min.x,
                i & 2 ? box.max.y : box.min.y,
                i & 4 ? box.max.z : box.min.z,
              ),
          );
          p.project(world.camera);
          const x = canvas.left + ((p.x + 1) / 2) * canvas.width;
          const y = canvas.top + ((1 - p.y) / 2) * canvas.height;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
        return { left, right, top, bottom };
      };
      let board;
      world.scene.traverse((object) => {
        const size = object.geometry?.parameters;
        if (!board && size?.width > 3 && size?.depth === 0.025) board = object;
      });
      return {
        parallel: !!world.camera.userData.parallelProjection,
        board: rect(board),
        note: rect(world.scene.getObjectByName(id)),
        transport: document.querySelector(".transport").getBoundingClientRect()
          .top,
        tools: document.querySelector(".scene-tools").getBoundingClientRect()
          .left,
        width: canvas.width,
      };
    }, id);
  const results = {};
  for (const mode of ["cabinet", "front", "cavalier", "perspective"]) {
    await frame.locator("#camera-mode").selectOption(mode);
    await page.waitForTimeout(150);
    const m = await measure("Note lead-0 pitch 84");
    assert.equal(m.parallel, mode !== "perspective", `${mode} projection`);
    // Large: the board spans most of the clear width without hiding under the controls.
    assert.ok(m.board.right <= m.tools + 1, `${mode} clears the scene tools`);
    assert.ok(
      m.board.bottom <= m.transport + 1,
      `${mode} clears the transport`,
    );
    results[mode] = Math.round(
      ((m.board.right - m.board.left) / m.width) * 100,
    );
    if (mode === "perspective") continue;
    // Cavalier draws velocity at full depth, which takes a share of the width.
    assert.ok(
      results[mode] > (mode === "cavalier" ? 60 : 70),
      `${mode} board fills the width (${results[mode]}%)`,
    );
    // Picking: clicking the projected note centre selects that note.
    await frame.locator("#stop").click();
    await page.mouse.click(
      (m.note.left + m.note.right) / 2,
      (m.note.top + m.note.bottom) / 2,
    );
    await frame.waitForFunction(() =>
      document.querySelector("#selection").textContent.startsWith("MIDI 84"),
    );
  }
  // Panning and zooming a parallel view moves the frame, and Reset refits it.
  await frame.locator("#camera-mode").selectOption("cabinet");
  await page.waitForTimeout(150);
  const before = await measure("Note lead-0 pitch 84");
  await frame.locator("#camera-in").click();
  await page.waitForTimeout(100);
  const zoomed = await measure("Note lead-0 pitch 84");
  assert.ok(
    zoomed.board.right - zoomed.board.left >
      before.board.right - before.board.left,
    "zoom in enlarges the board",
  );
  await frame.locator("#camera-reset").click();
  await page.waitForTimeout(150);
  const reset = await measure("Note lead-0 pitch 84");
  assert.ok(Math.abs(reset.board.left - before.board.left) < 1);
  assert.equal(await frame.locator("#camera-look").isDisabled(), true);
  await page.screenshot({ path: "artifacts/camera-oblique.png" });
  return { boardWidthPercent: results, picking: true, zoomAndReset: true };
}
