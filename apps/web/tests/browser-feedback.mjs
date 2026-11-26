import assert from "node:assert/strict";

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
    name: "Feedback test",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
    notes: [
      {
        id: "note",
        trackId: "keys",
        pitch: 60,
        start: 0,
        duration: 1920,
        velocity: 0.7,
      },
    ],
  };
  await frame
    .locator("#open")
    .setInputFiles({
      name: "feedback.xrdaw.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.startsWith("Feedback test"),
  );
  await frame.evaluate(async () => {
    const { ButtonSynth } = await import("/src/vendor/button-synth/synth.ts");
    const { interactionFeedback } =
      await import("/src/app/interaction-feedback.ts");
    interactionFeedback.configure({ muted: false, volume: 0.7 });
    window.__feedbackCalls = [];
    window.__feedbackOriginal = ButtonSynth.prototype.trigger;
    ButtonSynth.prototype.trigger = async function (
      profile,
      phase,
      parameters,
      seed,
    ) {
      window.__feedbackCalls.push({
        profile: typeof profile === "string" ? profile : profile.id,
        phase,
        volume: parameters.volume,
      });
      return window.__feedbackOriginal.call(
        this,
        profile,
        phase,
        parameters,
        seed,
      );
    };
  });
  const calls = () => frame.evaluate(() => window.__feedbackCalls);
  const clear = () =>
    frame.evaluate(() => {
      window.__feedbackCalls = [];
    });
  await frame.locator("#play").click();
  await frame.waitForFunction(
    () =>
      document.querySelector("#play").getAttribute("aria-label") === "Pause",
  );
  await frame.locator("#play").click();
  await frame.waitForFunction(
    () => document.querySelector("#play").getAttribute("aria-label") === "Play",
  );
  await frame.locator("#stop").click();
  const transport = await calls();
  assert.equal(
    transport.filter(
      (c) => c.profile === "game-game-start" && c.phase === "down",
    ).length,
    1,
    "one press sound per pointer activation",
  );
  assert.equal(
    transport.filter((c) => c.profile === "game-game-start" && c.phase === "up")
      .length,
    1,
  );
  assert.ok(transport.some((c) => c.profile === "game-pause-blip"));
  assert.ok(transport.some((c) => c.profile === "game-menu-back"));

  // Native keyboard activation has the same press/release pairing, without a duplicate click.
  await frame.locator("#stop").focus();
  await clear();
  await frame.locator("#stop").press("Enter");
  const keyboard = await calls();
  assert.equal(
    keyboard.filter((c) => c.profile === "game-menu-back" && c.phase === "down")
      .length,
    1,
  );
  assert.equal(
    keyboard.filter((c) => c.profile === "game-menu-back" && c.phase === "up")
      .length,
    1,
  );

  await frame.locator("#edit-menu > summary").click();
  await frame.locator("#mute").check();
  await frame.locator("#mute").uncheck();
  const toggles = await calls();
  assert.ok(toggles.some((c) => c.profile === "guitar-toggle-on"));
  assert.ok(toggles.some((c) => c.profile === "guitar-toggle-off"));
  await frame.locator("#gain").focus();
  await frame.locator("#gain").press("ArrowLeft");
  assert.ok((await calls()).some((c) => c.profile === "hi75-knob"));
  await frame.locator("#feedback-enabled").uncheck();
  await clear();
  await frame.locator("#gain").press("ArrowRight");
  await frame.locator("#mute").check();
  assert.deepEqual(
    await calls(),
    [],
    "muting feedback silences all cue categories",
  );
  await frame.locator("#feedback-enabled").check();
  assert.ok((await calls()).some((c) => c.profile === "guitar-toggle-on"));
  await frame.locator("#mute").uncheck();
  await frame.locator("#edit-menu > summary").click();

  const canvas = frame.locator("#scene-container canvas");
  await canvas.focus();
  await page.keyboard.press("b");
  await page.keyboard.press("v");
  await frame
    .locator("#open")
    .setInputFiles({
      name: "invalid.xrdaw.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":99}'),
    });
  await frame.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.toLowerCase()
      .includes("invalid"),
  );
  assert.ok((await calls()).some((c) => c.profile === "game-menu-error"));

  // The spatial menu also uses the same choices, including click-only activations.
  await clear();
  await frame.evaluate(() => {
    const panel =
      window.FRAMEWORK_MCP_RUNTIME.world.requireSceneObject("transport");
    for (const id of [
      "track-solo",
      "track-solo",
      "view-velocity",
      "view-notes",
    ])
      panel.requireElementById(id).dispatchEvent({ type: "click" });
  });
  const spatial = await calls();
  assert.ok(spatial.some((c) => c.profile === "guitar-toggle-on"));
  assert.ok(spatial.some((c) => c.profile === "guitar-toggle-off"));
  assert.ok(spatial.some((c) => c.profile === "game-8bit-select"));

  const audio = await frame.evaluate(async () => {
    const { FEEDBACK_CUES, interactionFeedback } =
      await import("/src/app/interaction-feedback.ts");
    const { profiles, renderSound, sanitize } =
      await import("/src/vendor/button-synth/synth.ts");
    const rendered = [];
    for (const [name, { profile, ...parameters }] of Object.entries(
      FEEDBACK_CUES,
    )) {
      const sound = profiles.find((p) => p.id === profile);
      const buffer = await renderSound(
        sound,
        "pair",
        sanitize({ ...parameters, bounce: 0, variation: 0 }),
      );
      let peak = 0;
      for (const sample of buffer.getChannelData(0))
        peak = Math.max(peak, Math.abs(sample));
      rendered.push({ name, peak });
    }
    const { exportWav } = await import("/src/app/audio.ts");
    const { demoProject } = await import("/src/app/project.ts");
    const project = demoProject();
    project.tracks[0].drums = true;
    project.notes = [{ ...project.notes[0], pitch: 36 }];
    const hash = async () => {
      const bytes = new Uint8Array(
        await (await exportWav(project)).arrayBuffer(),
      );
      let result = 0;
      for (const byte of bytes) result = (Math.imul(result, 31) + byte) | 0;
      return result;
    };
    const baseline = await hash();
    interactionFeedback.play("press");
    interactionFeedback.play("play");
    const withFeedback = await hash();
    return { rendered, baseline, withFeedback };
  });
  assert.ok(
    audio.rendered.every((r) => r.peak > 0 && r.peak < 1),
    "every chosen press/release sound renders audible, bounded PCM",
  );
  assert.equal(
    audio.baseline,
    audio.withFeedback,
    "UI sounds never enter exported music",
  );
  await frame.evaluate(async () => {
    const { ButtonSynth } = await import("/src/vendor/button-synth/synth.ts");
    ButtonSynth.prototype.trigger = window.__feedbackOriginal;
  });
  page.off("pageerror", onError);
  assert.deepEqual(errors, []);
  return {
    transport: true,
    keyboard: true,
    toggles: true,
    muted: true,
    spatial: true,
    renderedCues: audio.rendered.length,
    exportIsolated: true,
  };
}
