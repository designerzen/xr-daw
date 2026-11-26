import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export default async function run({ frame, page }) {
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
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
    name: "Composition controls",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [
      { id: "keys", name: "Keys", gain: 0.7, muted: false },
      { id: "kit", name: "Kit", gain: 0.5, muted: false },
    ],
    notes: [
      {
        id: "key",
        trackId: "keys",
        pitch: 60,
        start: 0,
        duration: 480,
        velocity: 0.7,
      },
      {
        id: "kick",
        trackId: "kit",
        pitch: 36,
        start: 480,
        duration: 480,
        velocity: 0.8,
      },
    ],
  };
  await frame
    .locator("#open")
    .setInputFiles({
      name: "composition.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.startsWith("Composition controls"),
  );
  await frame.locator("#track-panel").evaluate((panel) => {
    panel.open = true;
  });
  const keys = frame.locator('[data-track-id="keys"]');
  const kit = frame.locator('[data-track-id="kit"]');
  await keys.locator('[data-field="program"]').selectOption("32");
  await keys.locator('[data-field="name"]').fill("Bass");
  await keys.locator('[data-field="name"]').press("Tab");
  assert.equal(await keys.locator("[data-name]").textContent(), "Bass");
  await keys.locator('[data-action="solo"]').click();
  assert.equal(
    await keys.locator('[data-action="solo"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.match(await kit.getAttribute("class"), /inaudible/);
  await keys.locator('[data-action="solo"]').click();
  await kit.locator('[data-field="drums"]').check();
  assert.equal(await kit.locator('[data-field="program"]').isDisabled(), true);
  await kit.locator('[data-action="activate"]').click();
  assert.match(await kit.getAttribute("class"), /active/);
  assert.equal(
    await frame.locator("#track").inputValue(),
    "*",
    "activation retains all-track view",
  );

  await frame.locator("#loop-menu > summary").click();
  await frame.locator("#loop-start").fill("2");
  await frame.locator("#loop-start").press("Tab");
  await frame.locator("#loop-end").fill("4");
  await frame.locator("#loop-end").press("Tab");
  assert.equal(await frame.locator("#region-loop").isChecked(), true);
  await frame.locator("#metronome").check();
  await frame.locator("#count-in").check();
  // Drag backwards across the ruler; it must produce ordered, beat-snapped bounds.
  const ruler = await frame.locator("#loop-ruler").boundingBox();
  assert.ok(ruler);
  await page.mouse.move(
    ruler.x + ruler.width * 0.75,
    ruler.y + ruler.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    ruler.x + ruler.width * 0.25,
    ruler.y + ruler.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.match(
    await frame.locator("#loop-description").textContent(),
    /Bars 2.00–4.00/,
  );
  await frame.locator("#loop-menu > summary").click();

  const pending = page.waitForEvent("download");
  await frame.locator("#project-menu > summary").click();
  await frame.locator("#save").click();
  const download = await pending;
  const saved = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(saved.tracks[0].program, 32);
  assert.equal(saved.tracks[0].name, "Bass");
  assert.equal(saved.tracks[1].drums, true);
  assert.deepEqual(saved.loopRegion, { start: 1920, end: 5760 });

  // Render actual AudioWorklets: two programs must yield distinct, non-silent PCM.
  const renders = await frame.evaluate(async () => {
    const { exportWav } = await import("/src/app/audio.ts");
    const { demoProject } = await import("/src/app/project.ts");
    const results = [];
    for (const sound of [0, 32, "drums"]) {
      const project = demoProject();
      project.notes = [
        { ...project.notes[0], pitch: sound === "drums" ? 36 : 60 },
      ];
      project.tracks[0].program = sound === "drums" ? 0 : sound;
      project.tracks[0].drums = sound === "drums";
      const pcm = new Int16Array(
        (await (await exportWav(project)).arrayBuffer()).slice(44),
      );
      let energy = 0,
        hash = 0;
      for (let i = 0; i < pcm.length; i++) {
        energy += pcm[i] ** 2;
        hash = (Math.imul(hash, 31) + pcm[i]) | 0;
      }
      results.push({ sound, energy, hash });
    }
    return results;
  });
  assert.ok(renders.every((r) => r.energy > 0));
  assert.equal(new Set(renders.map((r) => r.hash)).size, 3);
  page.off("pageerror", onError);
  assert.deepEqual(errors, []);
  return { trackPanel: true, loopDrag: true, savedSettings: true, renders };
}
