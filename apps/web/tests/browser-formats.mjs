import assert from "node:assert/strict";

export default async function run({ frame, page }) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await frame.goto(frame.url(), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await frame.waitForFunction(
      () => document.querySelector("#status")?.textContent.includes("Ready"),
      null,
      { timeout: 60000 },
    );
    const results = await frame.evaluate(async () => {
      const { exportNotes, importMediaFile, NOTE_EXPORT_FORMATS } =
        await import("/src/app/media-formats.ts");
      const project = {
        version: 1,
        name: "Format fixture",
        ppq: 480,
        tempos: [{ tick: 0, bpm: 120 }],
        tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
        notes: [60, 64].map((pitch, i) => ({
          id: `note-${i}`,
          trackId: "keys",
          pitch,
          velocity: 0.7,
          start: i * 480,
          duration: 480,
        })),
      };
      const results = [];
      for (const [id, , extension] of NOTE_EXPORT_FORMATS) {
        try {
          const blob = await exportNotes(project, id);
          if (id === "lilypond") {
            results.push({ id, size: blob.size });
            continue;
          }
          const file = new File([blob], `format-${id}.${extension}`);
          const imported = await importMediaFile(file);
          if (imported.kind !== "project")
            throw new Error("Expected note project");
          const transfer = new DataTransfer();
          transfer.items.add(file);
          window.dispatchEvent(
            new DragEvent("drop", {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
            }),
          );
          const until = performance.now() + 10000;
          while (
            !document
              .querySelector("#project-summary")
              ?.textContent.includes(`format-${id} ·`)
          ) {
            if (performance.now() > until)
              throw new Error(
                `Drop failed: ${document.querySelector("#status")?.textContent}`,
              );
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          results.push({
            id,
            size: blob.size,
            pitches: imported.project.notes.map((note) => note.pitch),
            start: imported.project.notes[1]?.start / 960,
          });
        } catch (error) {
          results.push({ id, error: error.message });
        }
      }
      // A minimal ProTracker file exercises the real lazy-loaded libopenmpt WASM.
      const mod = new Uint8Array(1084 + 1024 + 2);
      mod.set(new TextEncoder().encode("Tracker fixture"));
      mod[43] = 1;
      mod[45] = 64;
      mod[950] = 1;
      mod.set(new TextEncoder().encode("M.K."), 1080);
      mod.set([1, 172, 16, 0], 1084);
      try {
        const file = new File([mod], "tracker.mod");
        const imported = await importMediaFile(file);
        results.push({
          id: "tracker",
          notes:
            imported.kind === "project" ? imported.project.notes.length : 0,
        });
      } catch (error) {
        results.push({ id: "tracker", error: error.message });
      }
      return results;
    });
    assert.deepEqual(
      results.filter((result) => result.error),
      [],
      JSON.stringify(results),
    );
    for (const result of results.filter((result) => result.pitches)) {
      assert.deepEqual(result.pitches, [60, 64], result.id);
      assert.ok(
        Math.abs(result.start - 0.5) < 0.025,
        `${result.id}: ${result.start}`,
      );
    }
    assert.ok(results.find((result) => result.id === "tracker").notes > 0);
    // Exercise the actual export controls and browser download, not just adapter calls.
    const menu = frame.locator("#project-menu");
    if (!(await menu.evaluate((node) => node.open)))
      await frame.locator("#project-menu > summary").click();
    await frame.locator("#note-export-format").selectOption("midi");
    const download = page.waitForEvent("download");
    await frame.locator("#export-notes").click();
    assert.match((await download).suggestedFilename(), /\.mid$/);
    assert.deepEqual(errors, []);
    return { formats: results, errors };
  } finally {
    page.off("pageerror", onError);
  }
}
