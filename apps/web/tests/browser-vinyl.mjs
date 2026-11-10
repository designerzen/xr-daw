import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { wavFile } from "./browser-media.mjs";

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
  await frame.evaluate(() => {
    window.__vinylCommands = [];
    window.__vinylTelemetry = [];
    const Base = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Base {
      constructor(...args) {
        super(...args);
        if (args[1] !== "xr-daw-vinyl") return;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...rest) => {
          window.__vinylCommands.push({
            type: message.type,
            time: message.time,
            rate: message.rate,
          });
          return post(message, ...rest);
        };
        this.port.addEventListener("message", ({ data }) => {
          window.__vinylTelemetry.push(data);
          if (window.__vinylTelemetry.length > 500)
            window.__vinylTelemetry.shift();
        });
      }
    };
  });
  await frame
    .locator("#open")
    .setInputFiles({
      name: "Vinyl test.wav",
      mimeType: "audio/wav",
      buffer: wavFile(),
    });
  await frame.waitForFunction(
    () =>
      document
        .querySelector("#project-summary")
        .textContent.includes("8192 circles"),
    null,
    { timeout: 60000 },
  );
  await frame.locator("#vinyl-enabled").check();
  await frame.waitForFunction(
    () => !document.querySelector("#vinyl-enabled").disabled,
    null,
    { timeout: 60000 },
  );
  assert.equal(await frame.locator("#vinyl-enabled").isChecked(), true);
  const canvas = frame.locator("#scene-container canvas");
  const point = (fraction) =>
    frame.evaluate((fraction) => {
      const world = window.FRAMEWORK_MCP_RUNTIME.world;
      const p = world.scene
        .getObjectByName("Waveform seek surface")
        .position.clone()
        .set(-1.6 + fraction * 3.2, 1.58, -2.09)
        .project(world.camera);
      return {
        x: ((p.x + 1) / 2) * world.renderer.domElement.clientWidth,
        y: ((1 - p.y) / 2) * world.renderer.domElement.clientHeight,
      };
    }, fraction);
  await canvas.click({ position: await point(0.25) });
  await frame.waitForFunction(() =>
    window.__vinylTelemetry.some(
      (message) => message.type === "position" && message.peak > 1e-6,
    ),
  );
  const position = await frame.evaluate(() =>
    window.__vinylTelemetry.filter((m) => m.type === "position").at(-1),
  );
  assert.ok(
    position.time >= 1.9 && position.time < 4,
    `vinyl seeks into the program, got ${position.time}`,
  );
  const bounds = await canvas.boundingBox();
  const from = await point(0.75),
    to = await point(0.35);
  await page.mouse.move(bounds.x + from.x, bounds.y + from.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + to.x, bounds.y + to.y, { steps: 25 });
  await frame.waitForFunction(() =>
    window.__vinylTelemetry.some(
      (m) => m.type === "position" && m.scratching && m.rate < -0.05,
    ),
  );
  await page.mouse.up();
  assert.ok(
    await frame.evaluate(() =>
      window.__vinylCommands.some((m) => m.type === "release"),
    ),
  );
  const reverseRate = await frame.evaluate(
    () =>
      window.__vinylTelemetry.find((m) => m.scratching && m.rate < -0.05).rate,
  );
  await frame.locator("#stop").click();
  await frame.locator("#edit-menu > summary").click();
  await frame.locator("#vinyl-condition").selectOption("damaged");
  await frame.waitForFunction(
    () => !document.querySelector("#vinyl-enabled").disabled,
  );
  assert.equal(await frame.locator("#vinyl-condition").inputValue(), "damaged");
  await frame.locator("#project-menu > summary").click();
  const download = page.waitForEvent("download");
  await frame.locator("#export").click();
  const file = await download;
  assert.match(file.suggestedFilename(), /vinyl-damaged\.wav$/);
  const bytes = await readFile(await file.path());
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.ok(bytes.subarray(44).some((byte) => byte !== 0));
  assert.equal(
    bytes.equals(wavFile()),
    false,
    "export contains the physical vinyl rendering",
  );
  await frame.locator("#vinyl-enabled").uncheck();
  await frame.waitForFunction(
    () => !document.querySelector("#vinyl-enabled").disabled,
  );
  assert.equal(await frame.locator("#vinyl-enabled").isChecked(), false);
  page.off("pageerror", onError);
  assert.deepEqual(errors, []);
  return {
    position,
    reverseRate,
    exportedBytes: bytes.length,
    filename: file.suggestedFilename(),
    errors,
  };
}
