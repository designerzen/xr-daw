# Vinyl engine

Unmodified engine, lathe, and pressing modules from [rauchg/vinyl](https://github.com/rauchg/vinyl), pinned to commit `bcc9264509d78ccbf4a449618f19c1cc3104b49c`. Copyright 2026 Guillermo Rauch; see [LICENSE](LICENSE).

XR DAW's waveform/transport adapters are in `../../audio/vinyl-controls.js`, `../../audio/vinyl-waveform.worklet.js`, and `../../audio/vinyl-master.worker.js`. The upstream page, graphics, and music recordings are not included.

`../../audio/vinyl-grooves.js` prepares the pinned reader's dilated groove blocks in the mastering worker before playback. The AudioWorklet reads these blocks directly, including during arbitrary seeks and reverse scratching; live physics and scratch commands remain on the audio thread without an added audio buffer. This trades preparation time and approximately 16 bytes per physical cut sample for avoiding synchronous groove reconstruction during playback. Raw groove walls stay in the mastering worker for export rather than being duplicated into the worklet. Recheck the block layout and audio-equivalence tests when updating the upstream revision.
