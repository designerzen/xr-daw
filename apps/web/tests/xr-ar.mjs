import assert from "node:assert/strict";

// AR shares the VR scene, but the real room replaces the studio backdrop and floor.
export default async function run({ frame }) {
  await frame.waitForFunction(
    () => document.querySelector("#enter-ar")?.hidden === false,
    null,
    { timeout: 60000 },
  );
  // The desktop floor only shows with the 3D camera.
  await frame.locator("#camera-mode").selectOption("perspective");
  await frame.waitForFunction(() => {
    let floor;
    window.FRAMEWORK_MCP_RUNTIME.world.scene.traverse((object) => {
      if (object.type === "GridHelper") floor = object;
    });
    return floor.visible;
  });
  const state = () =>
    frame.evaluate(() => {
      const world = window.FRAMEWORK_MCP_RUNTIME.world;
      let floor;
      world.scene.traverse((object) => {
        if (object.type === "GridHelper") floor = object;
      });
      return {
        blend: world.session?.environmentBlendMode ?? null,
        background: world.scene.background !== null,
        floor: floor.visible,
        panel: world.requireSceneObject("transport").visible,
        ar: document.querySelector("#enter-ar").textContent,
        vrHidden: document.querySelector("#enter-vr").hidden,
      };
    });
  assert.deepEqual(await state(), {
    blend: null,
    background: true,
    floor: true,
    panel: false,
    ar: "Enter AR",
    vrHidden: false,
  });
  await frame.locator("#enter-ar").click();
  await frame.waitForFunction(() => {
    const world = window.FRAMEWORK_MCP_RUNTIME.world;
    return world.session != null && world.scene.background === null;
  });
  const immersive = await state();
  assert.notEqual(immersive.blend, "opaque");
  assert.equal(immersive.floor, false);
  assert.equal(immersive.panel, true);
  assert.equal(immersive.ar, "Exit AR");
  assert.equal(immersive.vrHidden, true);
  await frame.evaluate(() => window.FRAMEWORK_MCP_RUNTIME.world.exitXR());
  await frame.waitForFunction(
    () =>
      window.FRAMEWORK_MCP_RUNTIME.world.session == null &&
      window.FRAMEWORK_MCP_RUNTIME.world.scene.background !== null,
  );
  const restored = await state();
  assert.equal(restored.floor, true);
  assert.equal(restored.ar, "Enter AR");
  assert.equal(restored.vrHidden, false);
  return { blend: immersive.blend, passthrough: true, restored: true };
}
