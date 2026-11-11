import assert from "node:assert/strict";

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
    name: "Full song navigation",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 300 }],
    tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
    notes: Array.from({ length: 6 }, (_, i) => ({
      id: `page-${i}`,
      trackId: "keys",
      pitch: 60 + i * 2,
      start: i * 7680,
      duration: i === 5 ? 7680 : 480,
      velocity: 0.5,
    })),
  };
  await frame.locator("#open").setInputFiles({
    name: "song.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await frame.waitForFunction(
    () =>
      document.querySelector("#project-name").textContent ===
      "Full song navigation",
  );
  assert.equal(await frame.locator("#next").isVisible(), true);
  await frame.locator("#next").click();
  await frame.waitForFunction(
    () => document.querySelector("#timeline-range").textContent === "5–8 / 24",
  );
  await frame.locator("#timeline-page").evaluate((input) => {
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.waitForFunction(
    () =>
      !!window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
        "Note page-5 pitch 70",
      ),
  );
  assert.equal(
    await frame.locator("#timeline-range").textContent(),
    "21–24 / 24",
  );
  assert.equal(await frame.locator("#next").isDisabled(), true);
  await frame.locator("#timeline-span").selectOption("song");
  await frame.waitForFunction(() => {
    const scene = window.FRAMEWORK_MCP_RUNTIME.world.scene;
    return (
      !!scene.getObjectByName("Note page-0 pitch 60") &&
      !!scene.getObjectByName("Note page-5 pitch 70")
    );
  });
  assert.equal(
    await frame.locator("#timeline-range").textContent(),
    "1–24 / 24",
  );
  await frame.locator("#timeline-span").selectOption("4");
  await frame.locator("#timeline-page").evaluate((input) => {
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.locator("#follow").click();
  await frame.locator("#play").click();
  await frame.waitForFunction(
    () => document.querySelector("#timeline-page").value === "1",
    null,
    { timeout: 12000 },
  );
  assert.equal(
    await frame.locator("#follow").getAttribute("aria-pressed"),
    "true",
  );
  await frame.locator("#previous").click();
  assert.equal(
    await frame.locator("#follow").getAttribute("aria-pressed"),
    "false",
  );
  await frame.locator("#stop").click();
  const camera = () =>
    frame.evaluate(() =>
      window.FRAMEWORK_MCP_RUNTIME.world.camera.position.toArray(),
    );
  const home = await camera();
  const canvas = frame.locator("#scene-container canvas"),
    bounds = await canvas.boundingBox();
  const drag = async (button = "left") => {
    await page.mouse.move(bounds.x + 22, bounds.y + bounds.height * 0.7);
    await page.mouse.down({ button });
    await page.mouse.move(bounds.x + 110, bounds.y + bounds.height * 0.7 - 35, {
      steps: 10,
    });
    await page.mouse.up({ button });
  };
  await drag();
  assert.notDeepEqual(
    await camera(),
    home,
    "background drag orbits the camera",
  );
  await frame.locator("#camera-reset").click();
  assert.deepEqual(await camera(), home);
  await drag("right");
  assert.notDeepEqual(await camera(), home, "right drag pans");
  await frame.locator("#camera-reset").click();
  await page.mouse.move(bounds.x + 22, bounds.y + bounds.height * 0.7);
  await page.mouse.wheel(0, -180);
  await frame.waitForFunction(
    (home) =>
      window.FRAMEWORK_MCP_RUNTIME.world.camera.position.distanceTo({
        x: home[0],
        y: home[1],
        z: home[2],
      }) > 0.05,
    home,
  );
  await frame.locator("#camera-reset").click();
  // Native touch events exercise pointer capture and the two-finger gesture path.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([id, x, y]) => ({
        id,
        x: bounds.x + x,
        y: bounds.y + y,
        radiusX: 2,
        radiusY: 2,
      })),
    });
  await touch("touchStart", [[1, 25, bounds.height * 0.7]]);
  await touch("touchMove", [[1, 100, bounds.height * 0.7 - 35]]);
  await touch("touchEnd", []);
  assert.notDeepEqual(
    await camera(),
    home,
    "one-finger background orbit works",
  );
  await frame.locator("#camera-reset").click();
  await touch("touchStart", [
    [1, 25, bounds.height * 0.7],
    [2, 90, bounds.height * 0.7],
  ]);
  await touch("touchMove", [
    [1, 20, bounds.height * 0.7 - 25],
    [2, 140, bounds.height * 0.7 - 25],
  ]);
  await touch("touchEnd", []);
  assert.notDeepEqual(await camera(), home, "two-finger pan and pinch work");
  await cdp.detach();
  await frame.locator("#camera-reset").click();
  await frame.locator("#camera-look").click();
  assert.equal(
    await frame.locator("#camera-look").getAttribute("aria-pressed"),
    "true",
  );
  await drag();
  assert.notDeepEqual(await camera(), home);
  await frame.locator("#camera-look").click();
  await frame.locator("#camera-reset").click();
  return {
    pages: 6,
    mouseOrbit: true,
    mousePan: true,
    mouseZoom: true,
    touchOrbit: true,
    touchPanPinch: true,
    followPlayback: true,
  };
}
