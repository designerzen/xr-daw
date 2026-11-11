import { cut } from "../vendor/vinyl/cut.js";
import { press } from "../vendor/vinyl/press.js";
import { Engine } from "../vendor/vinyl/engine.js";
import { CONDITIONS, seekEngine, setCondition } from "./vinyl-controls.js";
import { prepareGrooves, mixChannels } from "./vinyl-grooves.js";

let master, record;
self.onmessage = ({ data: message }) => {
  try {
    if (message.type === "prepare") {
      if (message.channels)
        master = cut([mixChannels(message.channels)], message.sampleRate);
      if (!master) throw new Error("Load audio before preparing vinyl.");
      record = press(
        {
          ...master,
          wallIn: master.wallIn.slice(),
          wallOut: master.wallOut.slice(),
        },
        CONDITIONS[message.condition],
        7,
      );
      if (record.truncated)
        throw new Error("This audio does not fit the simulated record.");
      const copy = {
        ...record,
        // Playback reads prepared geometry; retain raw walls only here for export.
        wallIn: undefined,
        wallOut: undefined,
        grooves: prepareGrooves(record, message.condition),
      };
      self.postMessage({ type: "record", id: message.id, record: copy }, [
        copy.grooves.data.buffer,
      ]);
    } else if (message.type === "render") {
      if (!record) throw new Error("Prepare vinyl before rendering.");
      const engine = new Engine(message.sampleRate);
      engine.setRecord(record);
      setCondition(engine, message.condition);
      seekEngine(engine, 0);
      const length = Math.ceil(message.duration * message.sampleRate);
      const left = new Float32Array(length),
        right = new Float32Array(length);
      for (let i = 0; i < length; i += 128) {
        const size = Math.min(128, length - i);
        engine.process(
          left.subarray(i, i + size),
          right.subarray(i, i + size),
          size,
        );
      }
      for (let i = 0; i < length; i++) {
        left[i] = Number.isFinite(left[i])
          ? Math.max(-1, Math.min(1, left[i] * message.gain))
          : 0;
        right[i] = Number.isFinite(right[i])
          ? Math.max(-1, Math.min(1, right[i] * message.gain))
          : 0;
      }
      self.postMessage({ type: "rendered", id: message.id, left, right }, [
        left.buffer,
        right.buffer,
      ]);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      message: String(error.message || error),
    });
  }
};
