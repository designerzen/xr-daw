import { GrooveReader } from "../vendor/vinyl/groove.js";
import { STYLI } from "../vendor/vinyl/engine.js";
import { conditionStylus } from "./vinyl-controls.js";

// Block layout of the pinned upstream GrooveReader: two walls, each with
// 2048 dilated samples per 1024 original cut samples. Keep upstream unmodified.
const BLOCK = 2048;

export function prepareGrooves(record, condition) {
  const reader = new GrooveReader();
  reader.setRecord(record);
  reader.setScan(STYLI[conditionStylus(condition)].scan);
  const data = new Float32Array(Math.ceil(record.n / 1024) * BLOCK * 2);
  for (let b = 0; b * 1024 < record.n; b++) {
    reader.compute(b, data.subarray(b * BLOCK * 2, (b + 1) * BLOCK * 2));
  }
  return { data, scan: reader.rScan };
}

export function installGrooves(engine, grooves) {
  if (grooves.scan !== engine.reader.rScan)
    throw new Error("Prepared groove stylus does not match playback.");
  const data = grooves.data;
  const n = engine.rec.n * 2;
  // Every location is ready before playback, including arbitrary reverse seeks.
  // No worker round trip, allocation, or lazy reconstruction on the audio thread.
  engine.reader.fill = (j0, length, inner, outer) => {
    let j = j0,
      i = 0;
    while (i < length) {
      if (j < 0 || j >= n) {
        inner[i] = outer[i] = 0;
        i++;
        j++;
      } else {
        const b = Math.floor(j / BLOCK);
        const base = j % BLOCK;
        const offset = b * BLOCK * 2 + base;
        // Match upstream's block padding at the end of the physical record.
        const count = Math.min(length - i, BLOCK - base);
        for (let k = 0; k < count; k++) {
          inner[i + k] = data[offset + k];
          outer[i + k] = data[offset + BLOCK + k];
        }
        i += count;
        j += count;
      }
    }
  };
}

export function mixChannels(channels) {
  const left = new Float32Array(channels[0].length);
  const right = new Float32Array(left.length);
  for (let c = 0; c < channels.length; c++) {
    const target = c % 2 ? right : left;
    const divisor =
      c % 2 ? Math.floor(channels.length / 2) : Math.ceil(channels.length / 2);
    for (let i = 0; i < target.length; i++)
      target[i] += channels[c][i] / divisor;
  }
  if (channels.length === 1) right.set(left);
  return { L: left, R: right };
}
