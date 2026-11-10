/**
 * This is an interface way to connect to MIDI devices and to swap
 * out the selected midi device and channels etc
 */
export default class MIDIConnection {
  #title = "No MIDI";

  get title() {
    return this.#title;
  }
  constructor(title = "No MIDI") {
    this.#title = title;
  }
  async connect(port = 0) {}
  async disconnect() {}
}
