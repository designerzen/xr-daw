import { analyzeWave } from "./spectrum";

self.onmessage = (
  event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>,
) => {
  const { channels, sampleRate } = event.data;
  const analysis = analyzeWave(channels, sampleRate);
  channels.forEach((channel) => channel.reverse());
  self.postMessage(
    { analysis, reversed: channels },
    {
      transfer: [
        ...channels.map((channel) => channel.buffer),
        ...analysis.channels.flatMap((channel) => [
          channel.amplitudes.buffer,
          channel.frequencies.buffer,
        ]),
      ],
    },
  );
};
