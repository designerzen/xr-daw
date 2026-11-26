import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMidi } from "midi-file";

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
    name: "Musical information",
    ppq: 480,
    tempos: [{ tick: 0, bpm: 120 }],
    timeSignatures: [
      { tick: 0, numerator: 3, denominator: 4 },
      { tick: 5760, numerator: 5, denominator: 4 },
    ],
    tracks: [
      {
        id: "keys",
        name: "Keys",
        gain: 0.7,
        muted: false,
        program: 16,
        channel: 0,
      },
    ],
    notes: [0, 480, 20000].map((start, i) => ({
      id: `note-${i}`,
      trackId: "keys",
      pitch: 69,
      velocity: 0.7,
      start,
      duration: i === 2 ? 240 : 120,
    })),
    sustain: [
      { trackId: "keys", tick: 0, value: 127 },
      { trackId: "keys", tick: 960, value: 0 },
    ],
    pitchBends: [
      { trackId: "keys", tick: 240, value: 4096 },
      { trackId: "keys", tick: 720, value: 0 },
    ],
    programChanges: [{ trackId: "keys", tick: 480, program: 32 }],
  };
  await frame
    .locator("#open")
    .setInputFiles({
      name: "information.xrdaw.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.startsWith("Musical information"),
  );
  await frame.locator("#timeline-span").selectOption("4");
  assert.equal(await frame.locator("#meter-label").textContent(), "3/4");
  assert.equal(
    await frame.locator("#timeline-range").textContent(),
    "1–4 / 11",
  );
  await frame.locator("#next").click();
  assert.equal(
    await frame.locator("#timeline-range").textContent(),
    "5–8 / 11",
  );
  await frame.locator("#next").click();
  assert.equal(
    await frame.locator("#timeline-range").textContent(),
    "9–11 / 11",
  );
  await frame.locator("#edit-menu > summary").click();
  await frame.locator("#meter-numerator").fill("7");
  await frame.locator("#meter-denominator").selectOption("8");
  await frame.locator("#set-meter").click();
  await frame.waitForFunction(
    () => document.querySelector("#meter-label").textContent === "7/8",
  );
  // The spatial control uses the same model, then desktop undo restores the imported/edit history.
  await frame.evaluate(() =>
    window.FRAMEWORK_MCP_RUNTIME.world
      .requireSceneObject("transport")
      .requireElementById("meter")
      .dispatchEvent({ type: "click" }),
  );
  await frame.waitForFunction(
    () => document.querySelector("#meter-label").textContent === "4/4",
  );
  await frame.locator("#undo").click();
  assert.equal(await frame.locator("#meter-label").textContent(), "7/8");
  await frame.locator("#edit-menu > summary").click();
  await frame.locator("#loop-menu > summary").click();
  await frame.locator("#loop-start").fill("2");
  await frame.locator("#loop-start").press("Tab");
  await frame.locator("#loop-end").fill("4");
  await frame.locator("#loop-end").press("Tab");
  await frame.locator("#loop-menu > summary").click();
  const save = page.waitForEvent("download");
  await frame.locator("#project-menu > summary").click();
  await frame.locator("#save").click();
  const saved = JSON.parse(await readFile(await (await save).path(), "utf8"));
  assert.deepEqual(saved.loopRegion, { start: 1680, end: 5040 });
  assert.deepEqual(saved.sustain, project.sustain);
  assert.deepEqual(saved.pitchBends, project.pitchBends);
  assert.deepEqual(saved.programChanges, project.programChanges);
  assert.equal(saved.timeSignatures[0].numerator, 7);
  const midiDownload = page.waitForEvent("download");
  await frame.locator("#project-menu > summary").click();
  await frame.locator("#note-export-format").selectOption("midi");
  await frame.locator("#export-notes").click();
  const midi = parseMidi(await readFile(await (await midiDownload).path()));
  const events = midi.tracks.flat();
  assert.ok(
    events.some(
      (e) =>
        e.type === "timeSignature" && e.numerator === 7 && e.denominator === 8,
    ),
  );
  assert.ok(
    events.some(
      (e) =>
        e.type === "controller" && e.controllerType === 64 && e.value === 127,
    ),
  );
  assert.ok(events.some((e) => e.type === "pitchBend" && e.value === 4096));
  assert.ok(
    events.some((e) => e.type === "programChange" && e.programNumber === 32),
  );

  // Actual AudioWorklet render: sustain remains audible after key release;
  // signed bends change the fundamental, and timed programs change later notes.
  const rendered = await frame.evaluate(async () => {
    const { demoProject } = await import("/src/app/project.ts");
    const { exportWav } = await import("/src/app/audio.ts");
    const base = demoProject();
    base.tempos = [{ tick: 0, bpm: 120 }];
    base.tracks[0].program = 16;
    base.notes = [{ ...base.notes[0], pitch: 69, start: 0, duration: 120 }];
    const render = async (p) => {
      const view = new DataView(await (await exportWav(p)).arrayBuffer());
      const samples = new Float32Array((view.byteLength - 44) / 4);
      for (let i = 0; i < samples.length; i++)
        samples[i] = view.getInt16(44 + i * 4, true) / 32768;
      return samples;
    };
    const energy = (samples, from, to) => {
      let sum = 0;
      for (let i = Math.floor(from * 44100); i < Math.floor(to * 44100); i++)
        sum += samples[i] ** 2;
      return sum;
    };
    const dry = await render(base);
    const held = await render({
      ...base,
      sustain: [
        { trackId: "track-1", tick: 0, value: 127 },
        { trackId: "track-1", tick: 960, value: 0 },
      ],
    });
    const tone = { ...base, notes: [{ ...base.notes[0], duration: 960 }] };
    const straight = await render(tone);
    const bent = await render({
      ...tone,
      pitchBends: [{ trackId: "track-1", tick: 0, value: 4096 }],
    });
    const peakFrequency = (samples) => {
      let best = 0,
        bestHz = 0;
      for (let frequency = 410; frequency <= 500; frequency++) {
        let re = 0,
          im = 0;
        for (let i = 0; i < 8192; i++) {
          const angle = (2 * Math.PI * frequency * i) / 44100;
          const sample =
            samples[i + 8820] *
            (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 8191));
          re += sample * Math.cos(angle);
          im += sample * Math.sin(angle);
        }
        const power = re * re + im * im;
        if (power > best) {
          best = power;
          bestHz = frequency;
        }
      }
      return bestHz;
    };
    const phrase = {
      ...base,
      notes: [base.notes[0], { ...base.notes[0], id: "next", start: 480 }],
    };
    const piano = await render(phrase);
    const changed = await render({
      ...phrase,
      programChanges: [{ trackId: "track-1", tick: 480, program: 32 }],
    });
    let difference = 0;
    for (let i = 22050; i < 33075; i++)
      difference += Math.abs(piano[i] - changed[i]);
    return {
      dryTail: energy(dry, 0.6, 0.8),
      heldTail: energy(held, 0.6, 0.8),
      straightHz: peakFrequency(straight),
      bentHz: peakFrequency(bent),
      programDifference: difference,
    };
  });
  assert.ok(
    rendered.heldTail > 0.01 && rendered.heldTail > rendered.dryTail * 10,
    JSON.stringify(rendered),
  );
  assert.ok(Math.abs(rendered.straightHz - 440) <= 2, JSON.stringify(rendered));
  assert.ok(Math.abs(rendered.bentHz - 466) <= 2, JSON.stringify(rendered));
  assert.ok(rendered.programDifference > 1);
  page.off("pageerror", onError);
  assert.deepEqual(errors, []);
  return {
    meterNavigation: true,
    desktopAndSpatialMeterEditing: true,
    savedExpression: true,
    midiExport: true,
    rendered,
  };
}
