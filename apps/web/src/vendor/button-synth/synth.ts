import rawProfiles from './profiles.json';
import { gameProfiles } from './game-profiles';

export type Phase = 'down' | 'up';
export interface Impact {
  notes?: { frequency: number; at: number; duration: number; wave: OscillatorType; endFrequency?: number }[];
  /** [freq, amp, decay?, endFreq?] */
  modes: number[][];
  /** [freq, amp, decay, Q] perceptual broadband noise bands */
  bands?: number[][];
  /** [at, gain, pitchRatio, brightRatio] multi-hit sub-events */
  events?: number[][];
  attack?: number;
  snap?: number;
  decay: number;
  brightness: number;
  noise: number;
  bounce: number;
  level: number;
}
export interface Profile { id: string; name: string; samples: number; down: Impact; up: Impact }
export const profiles: Profile[] = [...(rawProfiles as Profile[]), ...gameProfiles];
export interface Parameters {
  pitch: number; decay: number; brightness: number; body: number; noise: number;
  snap: number; bounce: number; variation: number; volume: number;
}
export const defaults: Parameters = { pitch: 0, decay: 1, brightness: 1, body: .65, noise: 1, snap: .5, bounce: 1, variation: .12, volume: .65 };
export const limits: Record<keyof Parameters, [number, number]> = {
  pitch: [-24, 24], decay: [.2, 3], brightness: [.2, 3], body: [0, 1], noise: [0, 2],
  snap: [0, 1], bounce: [0, 2], variation: [0, .5], volume: [0, 1],
};
export function sanitize(value: unknown): Parameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a parameter object.');
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Parameters)[]) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid ${key} value.`);
    result[key] = Math.max(limits[key][0], Math.min(limits[key][1], v));
  }
  return result;
}
function random(seed: number) {
  let a = seed | 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// A common, memoryless output stage keeps live audio and offline exports aligned.
// Scale before waveshaping to represent input levels up to +/-4 without a hard edge.
const limiterCurve = new Float32Array(8193);
for (let i = 0; i < limiterCurve.length; i++) {
  const x = (i / (limiterCurve.length - 1) * 2 - 1) * 4;
  limiterCurve[i] = Math.sign(x) * (Math.abs(x) <= .65 ? Math.abs(x) : .65 + .3 * Math.tanh((Math.abs(x) - .65) / .3));
}
function outputStage(ctx: BaseAudioContext, destination: AudioNode): GainNode {
  const input = ctx.createGain(), limiter = ctx.createWaveShaper();
  input.gain.value = .25; limiter.curve = limiterCurve;
  input.connect(limiter).connect(destination);
  return input;
}
function scheduledEvents(spec: Impact, p: Parameters): [number, number, number, number][] {
  if (!spec.events?.length) return [[0, 1, 1, 1]];
  let primaryIdx = 0;
  for (let i = 1; i < spec.events.length; i++) if (spec.events[i][1] > spec.events[primaryIdx][1]) primaryIdx = i;
  if (p.bounce <= 0) {
    const [, g, pr = 1, br = 1] = spec.events[primaryIdx];
    return [[0, g, pr, br]];
  }
  const primaryAt = spec.events[primaryIdx][0];
  const raw = spec.events.map(([at, gain, pr = 1, br = 1], i): [number, number, number, number] => {
    const rel = (at - primaryAt) * p.bounce;
    const scaledAt = primaryAt + rel;
    const scaledGain = i === primaryIdx ? gain : gain * Math.min(1.6, p.bounce);
    return [scaledAt, scaledGain, pr, br];
  });
  const minAt = Math.min(...raw.map(e => e[0]));
  return raw.map(([at, g, pr, br]) => [Math.max(0, at - minAt), g, pr, br]);
}
export function duration(profile: Profile, phase: Phase, p: Parameters) {
  const spec = profile[phase];
  if (spec.notes?.length) return Math.max(...spec.notes.map(n => n.at * Math.sqrt(p.decay) + n.duration * p.decay * 1.25)) + spec.bounce * p.bounce + .04;
  const maxEvent = Math.max(0, ...scheduledEvents(spec, p).map(e => e[0]));
  const taus = [spec.decay, ...spec.modes.map(m => m[2] ?? spec.decay), ...(spec.bands ?? []).map(b => b[2] ?? spec.decay)];
  const maxTau = Math.max(.004, ...taus);
  const atk = Math.min(.025, (spec.attack ?? .0004) * 1.8);
  return Math.max(.05, maxEvent + atk + maxTau * p.decay * 7.8 + .025);
}

/** Native oscillators + multi-band filtered, generated noise. No recorded buffers involved. */
export function scheduleImpact(ctx: BaseAudioContext, destination: AudioNode, profile: Profile, phase: Phase, params: Parameters, time: number, seed: number) {
  const p = sanitize(params), spec = profile[phase], rng = random(seed);
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
  const varied = 1 + (rng() * 2 - 1) * p.variation;
  const pitch = 2 ** (p.pitch / 12) * varied;
  const decayScale = p.decay * (1 + (rng() - .5) * p.variation);
  const length = duration(profile, phase, p);
  const nyq = ctx.sampleRate * .44;

  const bus = keep(ctx.createGain());
  bus.gain.value = spec.level * p.volume * (spec.notes ? .8 : 1);
  if (!spec.notes && p.brightness < .98) {
    const tone = keep(ctx.createBiquadFilter());
    tone.type = 'lowpass'; tone.Q.value = .65;
    tone.frequency.value = Math.max(220, Math.min(nyq, 18000 * p.brightness * p.brightness));
    bus.connect(tone).connect(destination);
  } else {
    bus.connect(destination);
  }

  const expEnvelope = (at: number, tau: number, amplitude: number, attackSec: number) => {
    const gain = keep(ctx.createGain());
    const amp = Math.max(.000001, amplitude);
    const atk = Math.max(.00012, Math.min(.025, attackSec));
    const life = Math.max(.002, Math.min(length - (at - time) - atk - .004, tau * 7.13));
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(amp, at + atk);
    gain.gain.exponentialRampToValueAtTime(Math.max(.000001, amp * .0008), at + atk + life);
    gain.gain.linearRampToValueAtTime(0, at + atk + life + .002);
    gain.connect(bus);
    return { gain, end: at + atk + life + .004 };
  };

  // Game cues: authored note sequences with square/triangle/sawtooth/sine oscillators.
  if (spec.notes) {
    const strikeGame = (at: number, strength: number) => {
      const filter = keep(ctx.createBiquadFilter());
      filter.type = 'lowpass'; filter.Q.value = .7;
      filter.frequency.value = Math.min(nyq, spec.brightness * p.brightness);
      const toneBus = keep(ctx.createGain()); toneBus.connect(filter).connect(bus);
      const concurrent = Math.max(1, ...spec.notes!.map(n => spec.notes!.filter(m => m.at <= n.at && m.at + m.duration > n.at).length));
      for (const n of spec.notes!) {
        const start = at + n.at * Math.sqrt(p.decay);
        const life = Math.max(.006, n.duration * decayScale);
        const osc = keep(ctx.createOscillator()); osc.type = n.wave;
        const hz = (f: number) => Math.max(30, Math.min(nyq, f * pitch));
        osc.frequency.setValueAtTime(hz(n.frequency), start);
        if (n.endFrequency) osc.frequency.exponentialRampToValueAtTime(hz(n.endFrequency), start + life);
        const gain = keep(ctx.createGain());
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(Math.max(.000001, strength * p.body * .9 / Math.sqrt(concurrent)), start + .0007);
        gain.gain.exponentialRampToValueAtTime(.00001, start + life);
        gain.gain.linearRampToValueAtTime(0, start + life + .002);
        gain.connect(toneBus);
        osc.connect(gain); osc.start(start); osc.stop(start + life + .004);
      }
      if (spec.noise > 0 && p.noise > 0) {
        const nLife = Math.min(length - .004, Math.max(.006, spec.decay * decayScale * 3));
        const buf = ctx.createBuffer(1, Math.ceil((nLife + .004) * ctx.sampleRate), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
        const src = keep(ctx.createBufferSource()); src.buffer = buf;
        const low = keep(ctx.createBiquadFilter()); low.type = 'lowpass'; low.Q.value = .7;
        low.frequency.value = Math.min(nyq, spec.brightness * p.brightness * pitch);
        const { gain, end } = expEnvelope(at, nLife / 5, strength * spec.noise * p.noise * 1.4, .0005);
        src.connect(low).connect(gain); src.start(at); src.stop(end);
      }
    };
    strikeGame(time, 1);
    if (spec.bounce > 0 && p.bounce > 0) strikeGame(time + spec.bounce * p.bounce, Math.min(.6, p.bounce * .25));
    return { end: time + length + .02, disconnect: () => nodes.forEach(n => n.disconnect()) };
  }

  // Acoustic button synthesis: damped modal oscillators + multi-band shaped noise + multi-event hits.
  const bodyGain = p.body / defaults.body;
  const baseAttack = (spec.attack ?? .0003) * (1.8 - p.snap * 1.6);
  const tilt = (hz: number, brightMul: number) => {
    const b = p.brightness * brightMul;
    if (Math.abs(b - 1) < .005) return 1;
    return Math.max(.06, Math.min(3.2, Math.pow(Math.max(.08, hz / 1000), Math.log2(b) * .48)));
  };

  const strike = (at: number, strength: number, evPitch: number, evBright: number) => {
    if (strength <= .0005) return;

    // 1. Damped resonant modes with per-mode decay & optional pitch sweep.
    for (const m of spec.modes) {
      const [freq, amp, modeDecay, endFreq] = m;
      const hz = Math.max(25, Math.min(nyq, freq * pitch * evPitch));
      const tau = Math.max(.0015, (modeDecay ?? spec.decay) * decayScale);
      const modeAmp = strength * bodyGain * amp * Math.SQRT2 * tilt(hz, evBright);
      if (modeAmp < .0005) continue;
      const osc = keep(ctx.createOscillator());
      osc.type = 'sine';
      if (endFreq) {
        osc.frequency.setValueAtTime(hz, at);
        osc.frequency.exponentialRampToValueAtTime(Math.max(25, Math.min(nyq, endFreq * pitch * evPitch)), at + Math.min(tau * 2.5, .06));
      } else if (p.snap > .5 && (spec.snap ?? 0) > .1) {
        const drop = (p.snap - .5) * (spec.snap ?? .3) * .25;
        osc.frequency.setValueAtTime(Math.min(nyq, hz * (1 + drop)), at);
        osc.frequency.exponentialRampToValueAtTime(hz, at + .0035);
      } else {
        osc.frequency.setValueAtTime(hz, at);
      }
      const { gain, end } = expEnvelope(at, tau, modeAmp, baseAttack);
      osc.connect(gain); osc.start(at); osc.stop(end);
    }

    // 2. Multi-band filtered procedural noise with ENBW gain calibration & per-band decay.
    const bands = spec.bands ?? [];
    if (bands.length && p.noise > 0) {
      const maxBandTau = Math.max(...bands.map(b => b[2] ?? spec.decay)) * decayScale;
      const noiseDur = Math.min(length - (at - time) - .002, maxBandTau * 7.2 + baseAttack + .008);
      if (noiseDur > .003) {
        const buffer = ctx.createBuffer(1, Math.max(64, Math.ceil(noiseDur * ctx.sampleRate)), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
        const source = keep(ctx.createBufferSource()); source.buffer = buffer;

        for (const [bFreq, bAmp, bDecay, bQ = 1.3] of bands) {
          const hz = Math.max(30, Math.min(nyq, bFreq * pitch * evPitch));
          const tau = Math.max(.001, bDecay * decayScale);
          // 4th-order bandpass (two cascaded biquads) gives steep -12 dB/oct skirts so low bands don't leak HF hiss.
          const enbwRms = Math.sqrt(Math.max(.00005, Math.PI * hz / (6 * bQ * ctx.sampleRate)));
          const enbwGain = Math.min(24, 1 / enbwRms);
          const lowBody = hz < 450 ? (.4 + .6 * bodyGain) : 1;
          const snapBoost = p.snap > .5 && tau <= .005 && hz >= 1200 ? (1 + (p.snap - .5) * .7) : 1;
          const bandAmp = strength * p.noise * bAmp * enbwGain * lowBody * snapBoost * tilt(hz, evBright);
          if (bandAmp < .0005) continue;
          const bp1 = keep(ctx.createBiquadFilter()), bp2 = keep(ctx.createBiquadFilter());
          bp1.type = 'bandpass'; bp1.frequency.value = hz; bp1.Q.value = bQ;
          bp2.type = 'bandpass'; bp2.frequency.value = hz; bp2.Q.value = bQ;
          // Shape excitation BEFORE the resonator so low bands ring naturally without startup loss.
          const { gain } = expEnvelope(at, tau, bandAmp, baseAttack);
          gain.disconnect();
          source.connect(gain).connect(bp1).connect(bp2).connect(bus);
        }
        source.start(at); source.stop(at + noiseDur);
      }
    }
  };

  for (const [evAt, evGain, evPitch, evBright] of scheduledEvents(spec, p)) {
    strike(time + evAt, evGain, evPitch, evBright);
  }
  return { end: time + length + .02, disconnect: () => nodes.forEach(n => n.disconnect()) };
}

export class ButtonSynth {
  private ctx?: AudioContext;
  private output?: GainNode;
  private voices: { disconnect: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private muted = false;
  async ready() {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
      this.output = this.ctx.createGain(); this.output.gain.value = this.muted ? 0 : 1;
      this.output.connect(this.ctx.destination);
      this.input = outputStage(this.ctx, this.output);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }
  private input?: AudioNode;
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.output) this.output.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, .008);
  }
  async trigger(profile: Profile | string, phase: Phase = 'down', parameters: Partial<Parameters> = {}, seed?: number) {
    const selected = typeof profile === 'string' ? profiles.find(p => p.id === profile) : profile;
    if (!selected) throw new Error('Unknown sound preset.');
    const ctx = await this.ready();
    while (this.voices.length >= 24) { const old = this.voices.shift()!; clearTimeout(old.timer); old.disconnect(); }
    const p = sanitize(parameters);
    const voice = scheduleImpact(ctx, this.input!, selected, phase, p, ctx.currentTime + .003, seed ?? (p.variation === 0 ? 42 : Math.floor(Math.random() * 2 ** 32)));
    const entry = { disconnect: voice.disconnect, timer: setTimeout(() => { voice.disconnect(); this.voices = this.voices.filter(v => v !== entry); }, (voice.end - ctx.currentTime) * 1000 + 50) };
    this.voices.push(entry);
  }
  async dispose() {
    this.voices.forEach(v => { clearTimeout(v.timer); v.disconnect(); }); this.voices = [];
    await this.ctx?.close(); this.ctx = undefined;
  }
}

export async function renderSound(profile: Profile, phase: Phase | 'pair', params: Parameters, seed = 42): Promise<AudioBuffer> {
  const p = sanitize(params);
  const gap = .2;
  const seconds = phase === 'pair' ? Math.max(duration(profile, 'down', p), gap + duration(profile, 'up', p)) : duration(profile, phase, p);
  const ctx = new OfflineAudioContext(1, Math.ceil((seconds + .04) * 48000), 48000);
  const destination = outputStage(ctx, ctx.destination);
  if (phase === 'pair') {
    scheduleImpact(ctx, destination, profile, 'down', p, .005, seed);
    scheduleImpact(ctx, destination, profile, 'up', p, gap + .005, seed + 1);
  } else scheduleImpact(ctx, destination, profile, phase, p, .005, seed);
  return ctx.startRendering();
}

export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const output = new ArrayBuffer(44 + buffer.length * 2), view = new DataView(output);
  const word = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset+i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + buffer.length * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, buffer.length * 2, true);
  buffer.getChannelData(0).forEach((x, i) => view.setInt16(44 + i*2, Math.round(Math.max(-1, Math.min(1, x)) * (x < 0 ? 32768 : 32767)), true));
  return output;
}
