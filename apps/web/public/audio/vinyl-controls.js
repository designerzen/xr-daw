// Waveform transport adapter for rauchg/vinyl. The upstream physics modules are unmodified.
import {
  W33,
  grooveRadius,
  alphaForRadius,
  stylusXY,
  ARM_LE,
} from "../vendor/vinyl/geometry.js";
import { warpHeight } from "../vendor/vinyl/press.js";

export const CONDITIONS = {
  clean: { noise: 0, dust: 0, scratches: 0, warp: 0, offCenter: 0, echo: 0 },
  worn: {
    noise: 2,
    dust: 0.7,
    scratches: 0.5,
    warp: 0.2,
    offCenter: 0.1,
    echo: 1,
  },
  damaged: {
    noise: 5,
    dust: 2,
    scratches: 1.5,
    warp: 0.5,
    offCenter: 0.3,
    echo: 2,
  },
};
export function conditionStylus(condition) {
  return condition === "clean"
    ? "microline"
    : condition === "damaged"
      ? "conical"
      : "elliptical";
}
export function setCondition(engine, condition) {
  engine.set({
    stylus: conditionStylus(condition),
    flutter: condition === "clean" ? 0 : 1,
    rumble: condition === "clean" ? 0 : 1,
    hum: 0,
    volume: 1,
  });
}
export function seekEngine(engine, seconds) {
  const record = engine.rec;
  if (!record) return;
  const track = record.tracks[0];
  const theta = Math.max(
    track.theta0,
    Math.min(track.theta1 - 1e-6, track.theta0 + seconds * W33),
  );
  const radius = grooveRadius(record.rTab, theta);
  engine.al = alphaForRadius(radius);
  let [x, y] = stylusXY(engine.al);
  engine.thp = theta - Math.atan2(y, x);
  // A warped, off-centre pressing still needs to seek the requested program time.
  for (let i = 0; i < 8; i++) {
    [x, y] = stylusXY(engine.al);
    const cos = Math.cos(engine.thp),
      sin = Math.sin(engine.thp);
    x -= record.ecc[0] * cos + record.ecc[1] * sin;
    y -= -record.ecc[0] * sin + record.ecc[1] * cos;
    const r = Math.hypot(x, y);
    const derivative =
      (ARM_LE * (-Math.sin(engine.al) * x + Math.cos(engine.al) * y)) / r;
    engine.al += (radius - r) / derivative;
    engine.thp = theta - Math.atan2(y, x);
  }
  engine.gn = 0;
  engine.ald =
    engine.zbd =
    engine.xi =
    engine.xid =
    engine.zed =
    engine.mwx =
    engine.mwz =
      0;
  // Seat the needle at static suspension/contact equilibrium rather than dropping it
  // from the air on every waveform seek (which would create a loud impulse).
  const indentation = (engine.p.vtf / (Math.SQRT2 * engine.p.kH)) ** (2 / 3);
  engine.hcP = Math.SQRT2 * (engine.p.R - indentation) - record.W;
  engine.ze = -engine.p.vtf / engine.p.kc;
  engine.mwz = engine.ze;
  engine.zs = warpHeight(record.warp, radius, theta);
  engine.zb = engine.hcP - engine.ze + engine.zs;
  engine.xgP = 0;
  engine.dpIn = engine.dpOut = -1;
  engine.zcue = -2e-3;
  engine.cueUp = false;
  engine.hOn = false;
  engine.auto = 0;
  engine.wp = W33;
  engine.bs = engine.dragTq = 0;
  engine.wj0 = -1e9;
  engine.ringL.fill(0);
  engine.ringR.fill(0);
  engine.fz.fill(0);
  engine.tel.theta = theta;
  engine.platterHand(false);
  engine.setMotor(true);
}
export function engineTime(engine) {
  return engine.rec
    ? (engine.tel.theta - engine.rec.tracks[0].theta0) / W33
    : 0;
}
