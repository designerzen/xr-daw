export interface WaveChannel {
  amplitudes: Float32Array;
  frequencies: Float32Array;
}
export interface WaveAnalysis {
  channels: WaveChannel[];
  duration: number;
}

/** Hann-windowed radix-2 FFT, expressed as a spectral energy centroid in Hz. */
export function spectralFrequency(
  samples: Float32Array,
  center: number,
  sampleRate: number,
) {
  const size = 1024;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let i = 0; i < size; i++)
    real[i] =
      (samples[center + i - size / 2] ?? 0) *
      (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let width = 2; width <= size; width *= 2) {
    for (let start = 0; start < size; start += width) {
      for (let i = 0; i < width / 2; i++) {
        const angle = (-2 * Math.PI * i) / width;
        const even = start + i,
          odd = even + width / 2;
        const re =
          real[odd] * Math.cos(angle) - imaginary[odd] * Math.sin(angle);
        const im =
          real[odd] * Math.sin(angle) + imaginary[odd] * Math.cos(angle);
        real[odd] = real[even] - re;
        imaginary[odd] = imaginary[even] - im;
        real[even] += re;
        imaginary[even] += im;
      }
    }
  }
  let energy = 0,
    weighted = 0;
  for (let bin = 1; bin < size / 2; bin++) {
    const power = real[bin] ** 2 + imaginary[bin] ** 2;
    energy += power;
    weighted += (power * bin * sampleRate) / size;
  }
  return energy < 1e-12 ? 0 : weighted / energy;
}

/** One displayed data point per peak-preserving time bucket; bound GPU work for long files. */
export function analyzeWave(
  channels: Float32Array[],
  sampleRate: number,
): WaveAnalysis {
  const count = Math.min(
    channels[0].length,
    Math.floor(8192 / channels.length),
  );
  return {
    duration: channels[0].length / sampleRate,
    channels: channels.map((samples) => {
      const amplitudes = new Float32Array(count);
      const frequencies = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const start = Math.floor((i * samples.length) / count);
        const end = Math.floor(((i + 1) * samples.length) / count);
        let peak = 0;
        for (let j = start; j < end; j++)
          peak = Math.max(peak, Math.abs(samples[j]));
        amplitudes[i] = peak;
        frequencies[i] = spectralFrequency(
          samples,
          Math.floor((start + end) / 2),
          sampleRate,
        );
      }
      return { amplitudes, frequencies };
    }),
  };
}

export function waveformTime(x: number, duration: number) {
  return Math.max(0, Math.min(duration, ((x + 1.6) / 3.2) * duration));
}

export function scratchRate(previous: number, next: number, elapsed: number) {
  return Math.max(
    -4,
    Math.min(4, (next - previous) / Math.max(0.008, elapsed)),
  );
}
