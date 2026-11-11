import assert from "node:assert/strict";
import test from "node:test";
import { VinylPlayback } from "../src/app/vinyl-playback";

test("vinyl display follows the audio clock but scratch commands remain immediate", () => {
  const context = { currentTime: 10 };
  const player = new VinylPlayback(context as AudioContext, {} as AudioNode);
  const commands: any[] = [];
  // Replace only the browser boundary, keeping the transport and clock real.
  const internal = player as any;
  internal.node = {
    port: { postMessage: (message: any) => commands.push(message) },
  };
  internal.duration = 20;
  player.play(4, false);
  const revision = commands.at(-1).revision;
  context.currentTime += 0.01;
  assert.ok(Math.abs(player.position - 4.01) < 1e-9);
  internal.receive({
    type: "position",
    revision,
    time: 4.02,
    rate: 1,
    contextTime: 10.02,
  });
  context.currentTime = 10.03;
  assert.ok(Math.abs(player.position - 4.03) < 1e-9);
  player.scratch(3, -2);
  assert.equal(commands.at(-1).type, "scratch");
  assert.equal(commands.at(-1).time, 3);
  assert.equal(commands.at(-1).rate, -2);
  context.currentTime += 0.01;
  assert.equal(
    player.position,
    3,
    "pointer position is never extrapolated while scratching",
  );
  internal.receive({
    type: "position",
    revision,
    time: 4.04,
    rate: 1,
    contextTime: 10.04,
  });
  assert.equal(
    player.position,
    3,
    "queued pre-scratch telemetry cannot undo input",
  );
  player.release();
  assert.equal(commands.at(-1).type, "release");
  context.currentTime += 0.01;
  assert.ok(Math.abs(player.position - 2.98) < 1e-9);
  player.pause();
  const paused = player.position;
  context.currentTime += 1;
  assert.equal(player.position, paused);
  internal.receive({ type: "ended", revision });
  assert.equal(
    player.position,
    paused,
    "stale ended events cannot affect a new transport state",
  );
  player.play(19.99, true);
  context.currentTime += 0.02;
  assert.ok(Math.abs(player.position - 0.01) < 1e-9);
  context.currentTime += 1;
  assert.ok(
    Math.abs(player.position - 0.04) < 1e-9,
    "prediction stops if telemetry stalls",
  );
});
