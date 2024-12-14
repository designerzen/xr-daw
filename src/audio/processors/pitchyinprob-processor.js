import {Essentia, EssentiaWASM} from 'essentia.js';
import { frequencyToNoteNumber } from '../tuning/frequencies';

console.warn( "proc", {Essentia, wasm:EssentiaWASM , EssentiaJS:EssentiaWASM.EssentiaWASM }  )

let essentia = new Essentia(EssentiaWASM.EssentiaWASM);

function Float32Concat(first, second)
{
    var firstLength = first.length,
        result = new Float32Array(firstLength + second.length);

    result.set(first);
    result.set(second, firstLength);

    return result;
}

/**
 * Convert a frequency in hertz into a noteNumber
 * @param {Number} frequency 
 * @returns {Number} NoteNumber
 */
// const L = Math.log(2)
// export const frequencyToNoteNumber = memoize((frequency) => {
// 	const log = Math.log(frequency / 440) / L
// 	return Math.round(12 * log + 69)
// })

class PitchProcessor extends AudioWorkletProcessor {
	name = "PitchProcessor"
    constructor(options) {
        super();
        this._bufferSize = options.processorOptions.bufferSize;
        this._sampleRate = options.processorOptions.sampleRate;
        this._channelCount = 1;
        this._essentia = essentia;
        // specific settings for algorithm
        this._rmsThreshold = 0.04;
        this._frameSize = this._bufferSize / 2;
        this._hopSize = this._frameSize / 4;
        this._lowestFreq = 440 * Math.pow(Math.pow(2, 1/12), -33); // lowest note = C2
        this._highestFreq = 440 * Math.pow(Math.pow(2, 1/12), -33+(6*12)-1); // 6 octaves above C2

        // buffersize mismatch helpers
        this._inputRingBuffer = new ChromeLabsRingBuffer(this._bufferSize, this._channelCount);

        this._accumData = [new Float32Array(this._bufferSize)];

		// console.info("PitchProcessor added", {AudioWriter, essentia, options})
        // SAB config
        // this.port.onmessage = e => {
        //   this._audio_writer = new AudioWriter(new RingBuffer(e.data.sab, Float32Array));
        // };
    }

    process(inputList, outputList, params) {
        let input = inputList[0];
        let output = outputList[0];

        this._inputRingBuffer.push(input);

        if (this._inputRingBuffer.framesAvailable >= this._bufferSize) {

            this._inputRingBuffer.pull(this._accumData);

            const accumDataVector = this._essentia.arrayToVector(this._accumData[0]);

            const rms = this._essentia.RMS(accumDataVector).rms;

            // const algoOutput = this._essentia.PitchYinProbabilistic(essentia.arrayToVector(this._accumData[0]), this._frameSize, this._hopSize, this._rmsThreshold, "zero", false, this._sampleRate);
            const algoOutput = this._essentia.PitchMelodia(
              accumDataVector,
              10, 3, this._frameSize, false, 0.8, this._hopSize, 1, 40, this._highestFreq, 100, this._lowestFreq, 20, 0.9, 0.9, 27.5625, this._lowestFreq, this._sampleRate, 100
            );
            const pitchFrames = essentia.vectorToArray(algoOutput.pitch);
            const confidenceFrames = essentia.vectorToArray(algoOutput.pitchConfidence);

            // average frame-wise pitches in pitch before writing to SAB
            const numVoicedFrames = pitchFrames.filter(p => p > 0).length;
            // const numFrames = pitchFrames.length;
            const meanPitch = pitchFrames.reduce((acc, val) => acc + val, 0) / numVoicedFrames;
            const meanConfidence = confidenceFrames.reduce((acc, val) => acc + val, 0) / numVoicedFrames;
            // console.info("audio: ", meanPitch, meanConfidence, rms);
            // write to SAB using AudioWriter object so that pitch output can be accesed from the main UI thread
            // if (this._audio_writer.available_write() >= 1) {
            //   this._audio_writer.enqueue([meanPitch, meanConfidence, rms]);
            // }

			const logRMS = 1 + Math.log10(rms + Number.MIN_VALUE) * 0.5

			const note = frequencyToNoteNumber(meanPitch)

			this.port.postMessage({
				note,
				rms,
				logRMS,
				pitch:meanPitch,
				confidence:meanConfidence
			});
            
            // reset variables
            this._accumData = [new Float32Array(this._bufferSize)];
        }

        // console.log(output[0]);
        return true;
    }
}

registerProcessor("pitchyinprob-processor", PitchProcessor);
console.warn("pitchyinprob-processor", "registered")


// helper classes from https://github.com/GoogleChromeLabs/web-audio-samples/blob/gh-pages/audio-worklet/design-pattern/lib/wasm-audio-helper.js#L170:

/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

// Basic byte unit of WASM heap. (16 bit = 2 bytes)
const BYTES_PER_UNIT = Uint16Array.BYTES_PER_ELEMENT;

// Byte per audio sample. (32 bit float)
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;

// The max audio channel on Chrome is 32.
const MAX_CHANNEL_COUNT = 32;

// WebAudio's render quantum size.
const RENDER_QUANTUM_FRAMES = 128;

/**
 * A JS FIFO implementation for the AudioWorklet. 3 assumptions for the
 * simpler operation:
 *  1. the push and the pull operation are done by 128 frames. (Web Audio
 *    API's render quantum size in the speficiation)
 *  2. the channel count of input/output cannot be changed dynamically.
 *    The AudioWorkletNode should be configured with the `.channelCount = k`
 *    (where k is the channel count you want) and
 *    `.channelCountMode = explicit`.
 *  3. This is for the single-thread operation. (obviously)
 *
 * @class
 */
class ChromeLabsRingBuffer {
  /**
   * @constructor
   * @param  {number} length Buffer length in frames.
   * @param  {number} channelCount Buffer channel count.
   */
  constructor(length, channelCount) {
    this._readIndex = 0;
    this._writeIndex = 0;
    this._framesAvailable = 0;

    this._channelCount = channelCount;
    this._length = length;
    this._channelData = [];
    for (let i = 0; i < this._channelCount; ++i) {
      this._channelData[i] = new Float32Array(length);
    }
  }

  /**
   * Getter for Available frames in buffer.
   *
   * @return {number} Available frames in buffer.
   */
  get framesAvailable() {
    return this._framesAvailable;
  }

  /**
   * Push a sequence of Float32Arrays to buffer.
   *
   * @param  {array} arraySequence A sequence of Float32Arrays.
   */
  push(arraySequence) {
    // The channel count of arraySequence and the length of each channel must
    // match with this buffer obejct.

    // Transfer data from the |arraySequence| storage to the internal buffer.
    let sourceLength = arraySequence[0].length;
    for (let i = 0; i < sourceLength; ++i) {
      let writeIndex = (this._writeIndex + i) % this._length;
      for (let channel = 0; channel < this._channelCount; ++channel) {
        this._channelData[channel][writeIndex] = arraySequence[channel][i];
      }
    }

    this._writeIndex += sourceLength;
    if (this._writeIndex >= this._length) {
      this._writeIndex = 0;
    }

    // For excessive frames, the buffer will be overwritten.
    this._framesAvailable += sourceLength;
    if (this._framesAvailable > this._length) {
      this._framesAvailable = this._length;
    }
  }

  /**
   * Pull data out of buffer and fill a given sequence of Float32Arrays.
   *
   * @param  {array} arraySequence An array of Float32Arrays.
   */
  pull(arraySequence) {
    // The channel count of arraySequence and the length of each channel must
    // match with this buffer obejct.

    // If the FIFO is completely empty, do nothing.
    if (this._framesAvailable === 0) {
      return;
    }

    let destinationLength = arraySequence[0].length;

    // Transfer data from the internal buffer to the |arraySequence| storage.
    for (let i = 0; i < destinationLength; ++i) {
      let readIndex = (this._readIndex + i) % this._length;
      for (let channel = 0; channel < this._channelCount; ++channel) {
        arraySequence[channel][i] = this._channelData[channel][readIndex];
      }
    }

    this._readIndex += destinationLength;
    if (this._readIndex >= this._length) {
      this._readIndex = 0;
    }

    this._framesAvailable -= destinationLength;
    if (this._framesAvailable < 0) {
      this._framesAvailable = 0;
    }
  }
} // class ChromeLabsRingBuffer
