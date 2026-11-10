import assert from "node:assert/strict";
import { test } from "node:test";
// Retained JS modules are exercised here without adding the legacy DSP tree to app typechecking.
// @ts-expect-error Retained JavaScript module has no declaration file.
import * as Bluetooth from "../src/audio/midi/midi-connection-bluetooth.js";
// @ts-expect-error Retained JavaScript module has no declaration file.
import MIDIConnection from "../src/audio/midi/midi-connection.js";

const {
  default: BluetoothMIDIConnection,
  MIDI_SERVICE_UUID,
  MIDI_CHARACTERISTIC_UUID,
} = Bluetooth;

class Characteristic extends EventTarget {
  properties = { writeWithoutResponse: true, write: false };
  value?: DataView;
  writes: Uint8Array[] = [];
  stopped = false;
  async startNotifications() {
    return this;
  }
  async stopNotifications() {
    this.stopped = true;
  }
  async writeValueWithoutResponse(packet: Uint8Array) {
    this.writes.push(packet.slice());
  }
}
class Device extends EventTarget {
  id = "keyboard-1";
  name = "Test keyboard";
  constructor(readonly characteristic: Characteristic) {
    super();
  }
  gatt = {
    connected: false,
    connect: async () => {
      this.gatt.connected = true;
      return this.gatt;
    },
    getPrimaryService: async (uuid: string) => {
      assert.equal(uuid, MIDI_SERVICE_UUID);
      return {
        getCharacteristic: async (uuid: string) => {
          assert.equal(uuid, MIDI_CHARACTERISTIC_UUID);
          return this.characteristic;
        },
      };
    },
    disconnect: () => {
      this.gatt.connected = false;
      this.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
}

test("Bluetooth transport connects, copies packet slices, writes, and cleans up on disconnect", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "bluetooth");
  const characteristic = new Characteristic();
  const device = new Device(characteristic);
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    value: {
      requestDevice: async (options: unknown) => {
        assert.deepEqual(options, {
          filters: [{ services: [MIDI_SERVICE_UUID], name: "Test keyboard" }],
        });
        return device;
      },
    },
  });
  const connection = new BluetoothMIDIConnection();
  try {
    assert.equal(new MIDIConnection().title, "No MIDI");
    assert.equal(connection.title, "Bluetooth MIDI Bridge");
    assert.deepEqual(connection.inputs, []);
    const result = await connection.connect("Test keyboard");
    assert.equal(result.inputs[0].name, "Test keyboard");
    assert.equal(connection.connected, true);
    const packets: Uint8Array[] = [];
    connection.onPacket = (packet: Uint8Array) => packets.push(packet);
    const backing = Uint8Array.of(1, 0x80, 0x80, 0x90, 60, 100, 2);
    characteristic.value = new DataView(backing.buffer, 1, 5);
    characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    backing.fill(0);
    assert.deepEqual([...packets[0]], [0x80, 0x80, 0x90, 60, 100]);
    await connection.writePacket(packets[0]);
    assert.deepEqual(characteristic.writes[0], packets[0]);
    await assert.rejects(connection.writePacket(Uint8Array.of(0x90)), /framed/);
    await connection.disconnect();
    assert.equal(characteristic.stopped, true);
    assert.equal(device.gatt.connected, false);
    assert.deepEqual(connection.outputs, []);
    characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    assert.equal(packets.length, 1, "notification listener was removed");
    await assert.rejects(connection.writePacket(packets[0]), /not connected/);
  } finally {
    await connection.disconnect();
    if (previous) Object.defineProperty(navigator, "bluetooth", previous);
    else Reflect.deleteProperty(navigator, "bluetooth");
  }
});

test("failed Bluetooth notification setup disconnects the partially opened device", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "bluetooth");
  const characteristic = new Characteristic();
  const device = new Device(characteristic);
  characteristic.startNotifications = async () => {
    throw new Error("Notifications unavailable");
  };
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    value: { requestDevice: async () => device },
  });
  try {
    const connection = new BluetoothMIDIConnection();
    await assert.rejects(connection.connect(), /Notifications unavailable/);
    assert.equal(connection.connected, false);
    assert.equal(device.gatt.connected, false);
  } finally {
    if (previous) Object.defineProperty(navigator, "bluetooth", previous);
    else Reflect.deleteProperty(navigator, "bluetooth");
  }
});
