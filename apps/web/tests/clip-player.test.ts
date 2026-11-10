import assert from "node:assert/strict";
import test from "node:test";
import { ClipPlayer, type AudioClip } from "../src/app/clip-player";

class Parameter {
  value = 1;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  cancelScheduledValues() {}
  setTargetAtTime() {}
}
class Node {
  gain = new Parameter();
  playbackRate = new Parameter();
  buffer?: AudioBuffer;
  loop = false;
  onended?: () => void;
  offset = 0;
  connect(destination: Node) {
    return destination;
  }
  disconnect() {}
  start(_at: number, offset: number) {
    this.offset = offset;
  }
  stop() {}
}
class Context {
  static instance: Context;
  currentTime = 0;
  destination = new Node();
  sources: Node[] = [];
  constructor() {
    Context.instance = this;
  }
  async resume() {}
  async close() {}
  createGain() {
    return new Node();
  }
  createBufferSource() {
    const node = new Node();
    this.sources.push(node);
    return node;
  }
}
const clip = {
  buffer: { duration: 10, length: 480000, sampleRate: 48000 },
  reversed: { duration: 10, length: 480000, sampleRate: 48000 },
} as AudioClip;

test("scratching uses reversed PCM at the correct offset and resumes forward on release", async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  const player = new ClipPlayer();
  try {
    player.load(clip);
    await player.beginScrub(6);
    const context = Context.instance;
    assert.equal(context.sources[0].buffer, clip.buffer);
    assert.equal(context.sources[0].offset, 6);
    player.scrubTo(4);
    assert.equal(context.sources.at(-1)!.buffer, clip.reversed);
    assert.equal(context.sources.at(-1)!.offset, 6);
    assert.ok(player.playbackRate < 0);
    assert.equal(player.positionSeconds, 4);
    await player.endScrub();
    assert.equal(context.sources.at(-1)!.buffer, clip.buffer);
    assert.equal(context.sources.at(-1)!.offset, 4);
    context.currentTime = 1;
    assert.equal(player.positionSeconds, 5);
    player.loop = true;
    assert.equal(context.sources.at(-1)!.loop, true);
    player.pause();
    context.currentTime = 8;
    assert.equal(player.positionSeconds, 5);
    player.stop();
    assert.equal(player.positionSeconds, 0);
  } finally {
    player.dispose();
    globalThis.AudioContext = previous;
  }
});

test("stop cancels a pending audio play request", async () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  const player = new ClipPlayer();
  try {
    player.load(clip);
    const pending = player.play(2);
    player.stop();
    await pending;
    assert.equal(player.playing, false);
    assert.equal(Context.instance.sources.length, 0);
  } finally {
    player.dispose();
    globalThis.AudioContext = previous;
  }
});
