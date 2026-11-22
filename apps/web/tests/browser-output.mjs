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
    const project = {
      version: 1,
      name: "Output fixture",
      ppq: 480,
      tempos: [{ tick: 0, bpm: 120 }],
      tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
      notes: [60, 64, 67].map((pitch, i) => ({
        id: `note-${i}`,
        trackId: "keys",
        pitch,
        velocity: 0.8,
        start: 0,
        duration: 24000,
      })),
    };
    await frame.locator("#open").setInputFiles({
      name: "output.xrdaw.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await frame.waitForFunction(() =>
      document
        .querySelector("#project-summary")
        ?.textContent.includes("Output fixture"),
    );
    await frame.locator("#output-mode").selectOption("spectrum");
    await frame.locator("#play").click();
    const modes = [];
    for (const mode of ["spectrum", "rings", "scope", "floor"]) {
      await frame.locator("#output-mode").selectOption(mode);
      await frame.waitForFunction((mode) => {
        const particles =
          window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
            "Live output particles",
          );
        return (
          particles?.userData.mode === mode &&
          particles.userData.frames > 4 &&
          particles.userData.peak > 0.02
        );
      }, mode);
      modes.push(
        await frame.evaluate(() => {
          const world = window.FRAMEWORK_MCP_RUNTIME.world;
          const particles = world.scene.getObjectByName(
            "Live output particles",
          );
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          const data = particles.instanceMatrix.array;
          let active = 0;
          let height = 0;
          for (let i = 0; i < particles.count; i++) {
            if (data[i * 16] <= 0) continue;
            active++;
            height = Math.max(height, data[i * 16 + 5]);
            for (let axis = 0; axis < 3; axis++) {
              min[axis] = Math.min(min[axis], data[i * 16 + 12 + axis]);
              max[axis] = Math.max(max[axis], data[i * 16 + 12 + axis]);
            }
          }
          return {
            ...particles.userData,
            active,
            height,
            ranges: max.map((value, axis) => value - min[axis]),
            boardVisible: world.scene.getObjectByName("Sequencer view").visible,
          };
        }),
      );
      assert.equal(
        await frame.locator("#play").getAttribute("aria-label"),
        "Pause",
        "mode changes keep playback running",
      );
    }
    for (const mode of modes) {
      assert.ok(mode.active > 10, mode.mode);
      if (mode.mode === "floor") {
        assert.ok(mode.ranges[0] > 0.01 && mode.ranges[2] > 0.01);
        assert.ok(mode.ranges[1] < 1e-6, "all columns share one flat baseline");
        assert.ok(
          mode.height > 0.001,
          "rectified peaks extend upward from the flat side",
        );
      } else
        assert.ok(
          mode.ranges.every((range) => range > 0.01),
          `${mode.mode} uses all three spatial axes`,
        );
      assert.equal(mode.boardVisible, false);
    }
    await frame.locator("#stop").click();
    // Real stereo FFT input verifies channel splitting and that output gain precedes analysis.
    const stereo = await frame.evaluate(async () => {
      const { OutputAnalysis } = await import("/src/app/output-analysis.ts");
      const context = new AudioContext();
      await context.resume();
      const merge = context.createChannelMerger(2),
        master = context.createGain();
      master.gain.value = 0.2;
      merge.connect(master).connect(context.destination);
      const oscillators = [220, 1760].map((frequency, channel) => {
        const osc = context.createOscillator();
        osc.frequency.value = frequency;
        osc.connect(merge, 0, channel);
        osc.start();
        return osc;
      });
      const analysis = new OutputAnalysis(context, master);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const data = analysis.read();
      const result = {
        left: data.left.indexOf(Math.max(...data.left)),
        right: data.right.indexOf(Math.max(...data.right)),
      };
      master.gain.value = 0;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const silent = analysis.read();
      result.mutedPeak = Math.max(
        ...silent.leftWave.map(Math.abs),
        ...silent.rightWave.map(Math.abs),
      );
      analysis.dispose();
      oscillators.forEach((osc) => osc.stop());
      await context.close();
      return result;
    });
    assert.ok(stereo.right > stereo.left + 10);
    assert.ok(stereo.mutedPeak < 0.0001);
    const offlineRenders = await frame.evaluate(async () => {
      const { exportWav } = await import("/src/app/audio.ts");
      const results = [];
      for (let i = 0; i < 3; i++) {
        const project = {
          version: 1,
          name: "Offline race",
          ppq: 480,
          tempos: [{ tick: 0, bpm: 120 }],
          tracks: [{ id: "keys", name: "Keys", gain: 0.7, muted: false }],
          notes: [
            {
              id: "note",
              trackId: "keys",
              pitch: 60,
              velocity: 0.8,
              start: 0,
              duration: 240,
            },
          ],
        };
        const bytes = new Uint8Array(
          await (await exportWav(project)).arrayBuffer(),
        );
        results.push(bytes.subarray(44).some((value) => value !== 0));
      }
      return results;
    });
    assert.deepEqual(
      offlineRenders,
      [true, true, true],
      "fresh offline worklets always receive their notes before rendering",
    );
    await frame.evaluate(async () => {
      const { encodeWav } = await import("/src/app/audio.ts");
      const buffer = new AudioBuffer({
        numberOfChannels: 2,
        length: 48000 * 8,
        sampleRate: 48000,
      });
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++)
          data[i] =
            Math.sin((i / 48000) * Math.PI * 2 * (channel ? 880 : 220)) * 0.35;
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([encodeWav(buffer)], "output-stereo.wav"));
      window.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await frame.waitForFunction(() =>
      document.querySelector("#status")?.textContent.includes("Audio ready"),
    );
    await frame.locator("#play").click();
    await frame.waitForFunction(() => {
      const data = window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName(
        "Live output particles",
      ).userData;
      return data.source === "audio" && data.frames > 4 && data.peak > 0.1;
    });
    await frame.locator("#output-mode").selectOption("off");
    await frame.waitForFunction(
      () =>
        !window.FRAMEWORK_MCP_RUNTIME.world.scene.getObjectByName("Live output")
          .visible,
    );
    assert.equal(
      await frame.locator("#play").getAttribute("aria-label"),
      "Pause",
    );
    await frame.locator("#stop").click();
    assert.deepEqual(errors, []);
    return { modes, stereo, offlineRenders, audioSource: true, errors };
  } finally {
    page.off("pageerror", onError);
  }
}
