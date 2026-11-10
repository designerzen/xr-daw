import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function wavFile() {
  const rate = 48000,
    seconds = 8;
  const bytes = Buffer.alloc(44 + rate * seconds * 4);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < rate * seconds; i++) {
    const frequency = i < rate * 4 ? 220 : 4000;
    const envelope = 0.15 + 0.65 * (0.5 + 0.5 * Math.sin((i / rate) * 7));
    bytes.writeInt16LE(
      Math.round(
        Math.sin((2 * Math.PI * frequency * i) / rate) * envelope * 32767,
      ),
      44 + i * 4,
    );
    bytes.writeInt16LE(
      Math.round(
        Math.sin((2 * Math.PI * frequency * i) / rate + 0.4) * envelope * 22000,
      ),
      46 + i * 4,
    );
  }
  return bytes;
}

export default async function run({ frame, page, workspaceRoot }) {
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
    window.__mediaSources = [];
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (...args) => {
        window.__mediaSources.push({ source, offset: args[1] });
        return start(...args);
      };
      return source;
    };
  });
  const drop = async (bytes, name, type) => {
    await frame.evaluate(
      ({ base64, name, type }) => {
        const file = new File(
          [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
          name,
          { type },
        );
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        window.dispatchEvent(
          new DragEvent("dragenter", { dataTransfer, cancelable: true }),
        );
        window.dispatchEvent(
          new DragEvent("drop", { dataTransfer, cancelable: true }),
        );
      },
      { base64: bytes.toString("base64"), name, type },
    );
  };
  await drop(
    await readFile(
      path.join(workspaceRoot, "src/assets/midi/Stories_100BPM_Gmin.mid"),
    ),
    "Dropped.mid",
    "audio/midi",
  );
  await frame.waitForFunction(() =>
    document
      .querySelector("#project-summary")
      .textContent.startsWith("Dropped"),
  );
  const midiSummary = await frame.locator("#project-summary").textContent();
  await drop(wavFile(), "Spectrum stereo.wav", "audio/wav");
  await frame.waitForFunction(
    () =>
      document
        .querySelector("#project-summary")
        .textContent.includes("8192 circles"),
    null,
    { timeout: 60000 },
  );
  await frame.waitForFunction(() =>
    window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
      "Waveform circles channel 2",
    ),
  );
  const geometry = await frame.evaluate(() => {
    const scene = window.FRAMEWORK_MCP_RUNTIME.world.scene;
    return [1, 2].map((channel) => {
      const mesh = scene.getObjectByName(`Waveform circles channel ${channel}`);
      const colors = mesh.instanceColor.array;
      return {
        count: mesh.count,
        type: mesh.geometry.type,
        low: [...colors.slice(3 * 500, 3 * 500 + 3)],
        high: [...colors.slice(3 * 3500, 3 * 3500 + 3)],
      };
    });
  });
  assert.equal(geometry[0].count + geometry[1].count, 8192);
  assert.ok(geometry.every((channel) => channel.type === "RingGeometry"));
  assert.notDeepEqual(
    geometry[0].low,
    geometry[0].high,
    "FFT colors differ for 220 Hz and 4 kHz",
  );
  const canvas = frame.locator("#scene-container canvas");
  const point = (fraction) =>
    frame.evaluate((fraction) => {
      const world = window.FRAMEWORK_MCP_RUNTIME.world;
      const surface = world.scene.getObjectByName("Waveform seek surface");
      const target = surface.position
        .clone()
        .set(-1.6 + fraction * 3.2, 1.58, -2.09)
        .project(world.camera);
      return {
        x: ((target.x + 1) / 2) * world.renderer.domElement.clientWidth,
        y: ((1 - target.y) / 2) * world.renderer.domElement.clientHeight,
      };
    }, fraction);
  await canvas.click({ position: await point(0.25) });
  await frame.waitForFunction(() => window.__mediaSources.length > 0);
  const startOffset = await frame.evaluate(
    () => window.__mediaSources[0].offset,
  );
  assert.ok(
    Math.abs(startOffset - 2) < 0.1,
    `click seeks to 2s, got ${startOffset}`,
  );
  await frame.waitForFunction(
    () =>
      document.querySelector("#play").getAttribute("aria-label") === "Pause",
  );
  const ringPoint = await frame.evaluate(() => {
    const world = window.FRAMEWORK_MCP_RUNTIME.world;
    const mesh = world.scene.getObjectByName("Waveform circles channel 1");
    mesh.addEventListener("pointerdown", (event) => {
      window.__ringHitTime = ((event.point.x + 1.6) / 3.2) * 8;
    });
    const matrix = mesh.matrix.clone();
    mesh.getMatrixAt(1024, matrix);
    const p = mesh.position.clone().setFromMatrixPosition(matrix);
    p.z += Math.hypot(...matrix.elements.slice(4, 7));
    p.project(world.camera);
    return {
      x: ((p.x + 1) / 2) * world.renderer.domElement.clientWidth,
      y: ((1 - p.y) / 2) * world.renderer.domElement.clientHeight,
    };
  });
  await canvas.click({ position: ringPoint });
  await frame.waitForFunction(
    () =>
      window.__ringHitTime !== undefined &&
      Math.abs(window.__mediaSources.at(-1).offset - window.__ringHitTime) <
        0.001,
  );
  const bounds = await canvas.boundingBox();
  const from = await point(0.75),
    to = await point(0.35);
  await page.mouse.move(bounds.x + from.x, bounds.y + from.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + to.x, bounds.y + to.y, { steps: 25 });
  const reverse = await frame.evaluate(() => {
    const entries = window.__mediaSources;
    const forward = entries[0].source.buffer;
    const reverse = entries.find((entry) => entry.source.buffer !== forward);
    if (!reverse) return null;
    const data = reverse.source.buffer.getChannelData(0);
    const original = forward.getChannelData(0);
    return {
      rate: reverse.source.playbackRate.value,
      samplesReversed: [0, 100, 10000].every(
        (i) => data[i] === original[original.length - 1 - i],
      ),
    };
  });
  assert.ok(
    reverse?.samplesReversed,
    "backward scratching actually plays reversed PCM",
  );
  assert.ok(reverse.rate > 0);
  await page.mouse.up();
  await frame.waitForFunction(() => {
    const entries = window.__mediaSources;
    return entries.at(-1).source.buffer === entries[0].source.buffer;
  });
  await frame.locator("#stop").click();
  await frame.waitForFunction(() =>
    document.querySelector("#position").textContent.startsWith("0.00s"),
  );
  await frame.locator("#view-notes").click();
  assert.equal(
    await frame.locator("#project-summary").textContent(),
    midiSummary,
  );
  await frame.locator("#view-waveform").click();
  assert.equal(
    await frame.locator("#view-waveform").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await frame.locator("#drop-target").isVisible(), false);
  const originalName = await frame.locator("#project-name").textContent();
  await drop(Buffer.from("not an audio file"), "broken.wav", "audio/wav");
  await frame.waitForFunction(
    () =>
      document.querySelector("#status").classList.contains("visible") &&
      !document.querySelector("#status").textContent.includes("Decoding"),
  );
  assert.equal(
    await frame.locator("#project-name").textContent(),
    originalName,
  );
  // The same decoder/analysis path also works through the file chooser.
  await frame.locator("#open").setInputFiles({
    name: "Uploaded.wave",
    mimeType: "audio/wav",
    buffer: wavFile(),
  });
  await frame.waitForFunction(
    () =>
      document.querySelector("#project-name").textContent === "Uploaded.wave",
    null,
    { timeout: 60000 },
  );
  page.off("pageerror", onError);
  assert.deepEqual(errors, []);
  return { midiSummary, geometry, startOffset, reverse, errors };
}
