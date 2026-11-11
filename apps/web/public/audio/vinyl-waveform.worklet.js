import { Engine } from "../vendor/vinyl/engine.js";
import { W33 } from "../vendor/vinyl/geometry.js";
import { engineTime, seekEngine, setCondition } from "./vinyl-controls.js";
import { installGrooves } from "./vinyl-grooves.js";

class WaveformVinyl extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.playing = false;
    this.loop = false;
    this.scratching = false;
    this.count = 0;
    this.revision = 0;
    this.port.onmessage = ({ data: message }) => {
      const engine = this.engine;
      if (message.revision !== undefined) this.revision = message.revision;
      switch (message.type) {
        case "record":
          engine.setRecord(message.record);
          setCondition(engine, message.condition);
          installGrooves(engine, message.record.grooves);
          this.duration = message.duration;
          this.playing = false;
          this.port.postMessage({ type: "record-ready", id: message.id });
          break;
        case "play":
          seekEngine(engine, message.time);
          this.playing = true;
          this.scratching = false;
          break;
        case "pause":
          this.playing = false;
          this.scratching = false;
          engine.platterHand(false);
          engine.setMotor(false);
          break;
        case "loop":
          this.loop = message.on;
          break;
        case "scratch": {
          if (!this.playing) break;
          const delta = message.time - engineTime(engine);
          if (!this.scratching || Math.abs(delta) > 0.2) {
            seekEngine(engine, message.time);
            engine.wp = message.rate * W33;
            engine.platterHand(true);
            engine.platterMove(message.rate * W33 * 0.025);
          } else engine.platterMove(delta * W33);
          engine.setMotor(false);
          this.scratching = true;
          break;
        }
        case "release":
          engine.platterHand(false);
          engine.setMotor(true);
          this.scratching = false;
          break;
      }
    };
    this.port.postMessage({ type: "ready" });
  }
  process(_inputs, outputs) {
    const left = outputs[0][0],
      right = outputs[0][1];
    if (!this.playing || !this.engine.rec) {
      left.fill(0);
      right.fill(0);
      return true;
    }
    this.engine.process(left, right, left.length);
    let time = engineTime(this.engine);
    if (!this.scratching && (time >= this.duration || time < -0.1)) {
      if (this.loop) {
        seekEngine(this.engine, 0);
        time = 0;
      } else {
        this.playing = false;
        this.port.postMessage({ type: "ended", revision: this.revision });
      }
    }
    this.count += left.length;
    if (this.count >= 1024) {
      this.count = 0;
      this.port.postMessage({
        type: "position",
        revision: this.revision,
        contextTime: currentTime + left.length / sampleRate,
        time: Math.max(0, Math.min(this.duration, time)),
        rate: this.engine.wp / W33,
        peak: this.engine.tel.peak,
        scratching: this.scratching,
      });
      this.engine.tel.peak = 0;
    }
    // Guard the destination if a simulated needle collision produces a transient.
    for (let i = 0; i < left.length; i++) {
      left[i] = Number.isFinite(left[i])
        ? Math.max(-1, Math.min(1, left[i]))
        : 0;
      right[i] = Number.isFinite(right[i])
        ? Math.max(-1, Math.min(1, right[i]))
        : 0;
    }
    return true;
  }
}
registerProcessor("xr-daw-vinyl", WaveformVinyl);
