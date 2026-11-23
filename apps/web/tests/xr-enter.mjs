// Enter through the actual app button because the app deliberately does not auto-offer VR.
export default async function run({ frame }) {
  await frame.waitForFunction(
    () => !document.querySelector("#enter-vr")?.disabled,
  );
  if (
    !(await frame.evaluate(() => !!window.FRAMEWORK_MCP_RUNTIME?.world.session))
  ) {
    await frame.locator("#enter-vr").click();
  }
  await frame.waitForFunction(
    () => window.FRAMEWORK_MCP_RUNTIME?.world.session != null,
  );
  // Exercise both spatial navigation actions while an XR session is active.
  for (const view of ["velocity", "notes"]) {
    await frame.evaluate((view) => {
      window.FRAMEWORK_MCP_RUNTIME.world
        .requireSceneObject("transport")
        .requireElementById(`view-${view}`)
        .dispatchEvent({ type: "click" });
    }, view);
    await frame.waitForFunction((view) => {
      const angle =
        window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
          "Sequencer view",
        ).rotation.x;
      return Math.abs(angle - (view === "velocity" ? -Math.PI / 2 : 0)) < 1e-6;
    }, view);
  }
  // Cycle the same live output modes from the spatial transport menu.
  await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world
      .requireSceneObject("transport")
      .requireElementById("output-clear")
      .dispatchEvent({ type: "click" }),
  );
  const modes = await frame
    .locator("#output-mode option")
    .evaluateAll((options) => options.map((option) => option.value));
  for (const mode of [...modes.slice(1), "off"]) {
    await frame.evaluate(() =>
      window.FRAMEWORK_MCP_RUNTIME.world
        .requireSceneObject("transport")
        .requireElementById("output-mode")
        .dispatchEvent({ type: "click" }),
    );
    await frame.waitForFunction((mode) => {
      const root =
        window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Live output");
      const particles =
        window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
          "Live output particles",
        );
      return (
        root.visible === (mode !== "off") &&
        (mode === "off" || particles.userData.mode === mode)
      );
    }, mode);
  }
  const waveformAvailable = await frame.evaluate(
    () =>
      !!window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
        "Waveform circles channel 1",
      ),
  );
  // Browsing choices leaves existing scopes in place; Add/Remove changes the set.
  const clickScope = async (id) =>
    frame.evaluate(
      (id) =>
        window.FRAMEWORK_MCP_RUNTIME.world
          .requireSceneObject("transport")
          .requireElementById(id)
          .dispatchEvent({ type: "click" }),
      id,
    );
  await clickScope("output-choice");
  await clickScope("output-toggle");
  await clickScope("output-choice");
  await clickScope("output-toggle");
  await frame.waitForFunction(
    () =>
      window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Live output")
        .children.length === 2,
  );
  await clickScope("output-toggle");
  await frame.waitForFunction(
    () =>
      window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Live output")
        .children.length === 1,
  );
  await clickScope("output-clear");
  await frame.waitForFunction(
    () =>
      !window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Live output")
        .visible,
  );
  if (waveformAvailable) {
    await frame.evaluate(() =>
      window.FRAMEWORK_MCP_RUNTIME.world
        .requireSceneObject("transport")
        .requireElementById("view-waveform")
        .dispatchEvent({ type: "click" }),
    );
    await frame.waitForFunction(
      () =>
        window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
          "Audio waveform",
        ).visible,
    );
  }
  return frame.evaluate(() => {
    const world = window.FRAMEWORK_MCP_RUNTIME.world;
    let note;
    world.scene.traverse((object) => {
      if (!note && object.userData.noteId) note = object;
    });
    return {
      sessionActive: !!world.session,
      note: note
        ? {
            name: note.name,
            position: note.getWorldPosition(note.position.clone()).toArray(),
          }
        : null,
      panelVisible: world.requireSceneObject("transport").visible,
      viewNavigation: true,
      waveformVisible:
        world.scene.getObjectByName("Audio waveform")?.visible ?? false,
    };
  });
}
