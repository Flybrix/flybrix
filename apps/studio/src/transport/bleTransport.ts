import {
  connect,
  disconnect,
  send,
  startScan,
  stopScan,
  subscribe,
  type BleDevice,
} from "@mnlphlp/plugin-blec";
import type { DataListener, Transport } from "./Transport";

// Nordic UART Service — the same GATT UUIDs the legacy Flybrix mobile app used
// to talk to the flight board over BLE.
export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
// Characteristic the app writes commands to (the board's RX).
const NUS_WRITE = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
// Characteristic the app subscribes to for telemetry (the board's TX, notify).
const NUS_NOTIFY = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

// Nordic UART is a streaming link with no per-packet BLE acknowledgement; the
// Flybrix protocol carries its own Response-message acks, so we write without
// response for throughput.
const WRITE_TYPE = "withoutResponse" as const;

export interface BleDeviceInfo {
  address: string;
  name: string;
  rssi: number;
  isFlybrix: boolean;
}

function toDeviceInfo(d: BleDevice): BleDeviceInfo {
  return {
    address: d.address,
    name: d.name || "(unnamed)",
    rssi: d.rssi,
    isFlybrix: d.services.includes(NUS_SERVICE),
  };
}

/**
 * Scan for BLE devices. `onDevices` is called repeatedly with the growing list
 * as devices are discovered, until `timeoutMs` elapses. Devices advertising the
 * Nordic UART service are flagged `isFlybrix`.
 */
export async function scanBleDevices(
  onDevices: (devices: BleDeviceInfo[]) => void,
  timeoutMs = 5000,
): Promise<void> {
  await startScan((devices: BleDevice[]) => {
    onDevices(devices.map(toDeviceInfo));
  }, timeoutMs);
}

export async function stopBleScan(): Promise<void> {
  await stopScan();
}

export class BleTransport implements Transport {
  private sending = false;

  private constructor() {}

  static async open(
    address: string,
    onData: DataListener,
    onError: (msg: string) => void,
  ): Promise<BleTransport> {
    const t = new BleTransport();
    try {
      await connect(address, () => onError("BLE device disconnected"));
      await subscribe(NUS_NOTIFY, NUS_SERVICE, (data: number[]) =>
        onData(Uint8Array.from(data)),
      );
    } catch (err) {
      await disconnect().catch(() => {});
      throw err;
    }
    return t;
  }

  async send(data: Uint8Array): Promise<void> {
    this.sending = true;
    try {
      await send(NUS_WRITE, Array.from(data), WRITE_TYPE, NUS_SERVICE);
    } catch (err) {
      this.sending = false;
      throw err;
    }
    this.sending = false;
  }

  busy(): boolean {
    return this.sending;
  }

  async close(): Promise<void> {
    await disconnect();
  }
}
