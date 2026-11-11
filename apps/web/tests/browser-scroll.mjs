import assert from "node:assert/strict";

// Scroll mode: the playhead parks in the centre and the notes move past it.
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
    name: "Scrolling",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 240 }],
    tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
    notes: Array.from({ length: 48 }, (_, i) => ({
      id: `n-${i}`,
      trackId: "keys",
      pitch: 60 + (i % 12),
      start: i * 960,
      duration: 480,
      velocity: 0.6,
    })),
  };
  await frame.locator("#open").setInputFiles({
    name: "scroll.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await frame.waitForFunction(
    () => document.querySelector("#project-name").textContent === "Scrolling",
  );
  await frame.locator("#timeline-span").selectOption("4");
  await frame.locator("#timeline-scroll").click();
  assert.equal(
    await frame.locator("#timeline-scroll").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await frame.locator("#next").isVisible(), false);
  assert.equal(await frame.locator("#follow").isVisible(), false);
  assert.equal(await frame.locator("#timeline-page").isVisible(), true);

  const sample = () =>
    frame.evaluate(() => {
      const scene = window.FRAMEWORK_MCP_RUNTIME.world.scene;
      let playhead;
      scene.traverse((object) => {
        if (
          object.geometry?.type === "PlaneGeometry" &&
          object.parent?.name === ""
        )
          playhead ??= object;
      });
      const strip = scene.getObjectByName("Timeline strip");
      return {
        playheadX: playhead.position.x,
        stripX: strip.position.x,
        slider: Number(document.querySelector("#timeline-page").value),
        range: document.querySelector("#timeline-range").textContent,
      };
    });
  await frame.locator("#play").click();
  // 4 bars at 240 BPM is 4 s, so the centre is reached after 2 s.
  await page.waitForTimeout(3000);
  const first = await sample();
  await page.waitForTimeout(1500);
  const second = await sample();
  await frame.locator("#play").click();
  assert.ok(
    Math.abs(first.playheadX) < 0.02,
    `playhead centred (${first.playheadX})`,
  );
  assert.ok(Math.abs(second.playheadX) < 0.02, "playhead stays centred");
  assert.ok(second.stripX < first.stripX - 0.3, "notes move left past it");
  assert.ok(second.slider > first.slider, "the scrubber follows playback");

  // Scrubbing moves the song position, and with it the view.
  await frame.locator("#timeline-page").evaluate((slider) => {
    slider.value = String(480 * 4 * 20);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.waitForFunction(
    () => document.querySelector("#timeline-range").textContent === "21 / 24",
  );
  await page.waitForTimeout(150);
  const scrubbed = await sample();
  assert.ok(Math.abs(scrubbed.playheadX) < 0.02);
  assert.ok(scrubbed.stripX !== second.stripX);
  // Only notes inside the board stay pickable.
  const outside = await frame.evaluate(() => {
    let count = 0;
    window.FRAMEWORK_MCP_RUNTIME.world.scene.traverse((object) => {
      if (object.userData.noteId && object.visible) {
        const x = object.getWorldPosition(object.position.clone()).x;
        if (x < -1.7 || x > 1.7) count++;
      }
    });
    return count;
  });
  assert.equal(outside, 0);
  await page.screenshot({ path: "artifacts/timeline-scroll.png" });
  await frame.locator("#timeline-scroll").click();
  await frame.waitForFunction(
    () =>
      document.querySelector("#timeline-range").textContent === "21–24 / 24",
  );
  return { centred: true, moving: true, scrub: true, backToPages: true };
}
