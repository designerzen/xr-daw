import assert from "node:assert/strict";

export default async function run({ frame }) {
  await frame.evaluate(() => {
    if (window.FRAMEWORK_MCP_RUNTIME.world.session)
      window.FRAMEWORK_MCP_RUNTIME.world.exitXR();
  });
  await frame.waitForFunction(
    () =>
      !window.FRAMEWORK_MCP_RUNTIME.world.session &&
      !document.querySelector("#controls").classList.contains("immersive"),
  );
  const project = {
    version: 1,
    name: "XR navigation",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
    notes: [0, 32].map((beat, i) => ({
      id: `xr-${i}`,
      trackId: "keys",
      start: beat * 480,
      duration: 480,
      pitch: 60 + i * 4,
      velocity: 0.5,
    })),
  };
  await frame.locator("#open").setInputFiles({
    name: "xr-navigation.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await frame.waitForFunction(
    () =>
      document.querySelector("#project-name").textContent === "XR navigation",
  );
  await frame.locator("#timeline-span").selectOption("4");
  await frame.locator("#camera-in").click();
  const desktop = await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.camera.position.toArray(),
  );
  await frame.locator("#enter-vr").click();
  await frame.waitForFunction(
    () => !!window.FRAMEWORK_MCP_RUNTIME.world.session,
  );
  const before = await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.camera.position.toArray(),
  );
  await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.renderer.domElement.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const after = await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.camera.position.toArray(),
  );
  assert.deepEqual(after, before, "desktop wheel navigation is inactive in XR");
  await frame.evaluate(() => {
    const panel =
      window.FRAMEWORK_MCP_RUNTIME.world.requireSceneObject("transport");
    panel.requireElementById("next").dispatchEvent({ type: "click" });
  });
  await frame.waitForFunction(
    () => document.querySelector("#timeline-range").textContent === "5–8 / 9",
  );
  await frame.evaluate(() => window.FRAMEWORK_MCP_RUNTIME.world.exitXR());
  await frame.waitForFunction(
    () =>
      !window.FRAMEWORK_MCP_RUNTIME.world.session &&
      !document.querySelector("#controls").classList.contains("immersive"),
  );
  const restored = await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.camera.position.toArray(),
  );
  assert.ok(
    restored.every((value, i) => Math.abs(value - desktop[i]) < 1e-5),
    "desktop camera is restored after XR",
  );
  await frame.locator("#camera-reset").click();
  return {
    desktopNavigationDisabledInXR: true,
    vrTimelineAction: true,
    restoredDesktopCamera: true,
  };
}
