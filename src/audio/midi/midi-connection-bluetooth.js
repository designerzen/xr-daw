import MIDIConnection from "./midi-connection.js";

export const MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const MIDI_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

/**
 * Web Bluetooth transport for BLE-MIDI packets. Call connect() from a user gesture.
 * Packets retain their BLE timestamps/framing; decoding and DAW routing belong to
 * the consumer. This module has no page-specific DOM or audio side effects.
 */
export default class BluetoothMIDIConnection extends MIDIConnection {
  static TYPE = "Bluetooth MIDI Bridge";
  device = null;
  characteristic = null;
  onPacket = null;
  onDeviceListUpdated = null;
  #connecting = false;
  #generation = 0;

  constructor() {
    super(BluetoothMIDIConnection.TYPE);
  }

  get connected() {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
  }
  get inputs() {
    return this.connected ? [this.#port("input")] : [];
  }
  get outputs() {
    return this.connected ? [this.#port("output")] : [];
  }

  #port(type) {
    return {
      id: `${this.device.id}-${type}`,
      name: this.device.name || "Bluetooth MIDI",
      manufacturer: "",
      type,
      connection: "open",
      state: "connected",
    };
  }

  #changed = (event) => {
    const value = event.target.value;
    if (!value) return;
    // Copy only the DataView's slice; Bluetooth implementations may reuse buffers.
    const packet = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
    this.onPacket?.(packet);
  };

  #disconnected = (event) => {
    this.#detach();
    this.onDeviceListUpdated?.([], [], event);
  };

  #detach() {
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.#changed,
    );
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.#disconnected,
    );
    this.characteristic = null;
    this.device = null;
  }

  async connect(options = {}, onDeviceListUpdated = null) {
    if (this.#connecting || this.connected)
      throw new Error("Bluetooth MIDI is already connecting or connected.");
    if (!globalThis.navigator?.bluetooth)
      throw new Error("Web Bluetooth is unavailable in this browser.");
    const name = typeof options === "string" ? options : options.name;
    this.onDeviceListUpdated = onDeviceListUpdated;
    this.#connecting = true;
    const generation = ++this.#generation;
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [MIDI_SERVICE_UUID], ...(name ? { name } : {}) }],
      });
      if (!device.gatt)
        throw new Error("The selected device has no Bluetooth GATT server.");
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(MIDI_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(
        MIDI_CHARACTERISTIC_UUID,
      );
      await characteristic.startNotifications();
      if (generation !== this.#generation || !device.gatt.connected)
        throw new Error(
          "Bluetooth MIDI connection was cancelled or disconnected.",
        );
      this.device = device;
      this.characteristic = characteristic;
      device.addEventListener("gattserverdisconnected", this.#disconnected);
      characteristic.addEventListener(
        "characteristicvaluechanged",
        this.#changed,
      );
      this.onDeviceListUpdated?.(this.outputs, this.inputs, null);
      return {
        status: "Bluetooth MIDI connected",
        inputs: this.inputs,
        outputs: this.outputs,
      };
    } catch (error) {
      this.#detach();
      if (device?.gatt?.connected) device.gatt.disconnect();
      throw error;
    } finally {
      this.#connecting = false;
    }
  }

  async writePacket(packet) {
    if (!this.connected) throw new Error("Bluetooth MIDI is not connected.");
    if (
      !(packet instanceof Uint8Array) ||
      packet.length < 2 ||
      !(packet[0] & 0x80)
    ) {
      throw new Error("Expected a framed BLE-MIDI packet as Uint8Array.");
    }
    const characteristic = this.characteristic;
    if (characteristic.properties.writeWithoutResponse)
      return characteristic.writeValueWithoutResponse(packet);
    if (characteristic.properties.write)
      return characteristic.writeValueWithResponse(packet);
    throw new Error("This Bluetooth MIDI characteristic is not writable.");
  }

  async disconnect() {
    ++this.#generation;
    const device = this.device;
    const characteristic = this.characteristic;
    this.#detach();
    try {
      if (device?.gatt?.connected) await characteristic?.stopNotifications();
    } finally {
      if (device?.gatt?.connected) device.gatt.disconnect();
      this.onDeviceListUpdated?.([], [], null);
    }
  }
}
