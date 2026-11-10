// Enter through the actual app button because the app deliberately does not auto-offer VR.
export default async function run({ frame }) {
  await frame.waitForFunction(
    () => !document.querySelector("#enter-vr")?.disabled,
  );
  if (!(await frame.evaluate(() => !!window.FRAMEWORK_MCP_RUNTIME?.world.session))) {
    await frame.locator("#enter-vr").click();
  }
  await frame.waitForFunction(
    () => window.FRAMEWORK_MCP_RUNTIME?.world.session != null,
  );
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
    };
  });
}
