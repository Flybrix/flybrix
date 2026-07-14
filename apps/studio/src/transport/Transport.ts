// Mirrors the legacy flybrix-common serial.Backend contract so the
// @flybrix/core message router can drive any transport.
export interface Transport {
  send(data: Uint8Array): Promise<void> | void;
  busy(): boolean;
  close(): Promise<void>;
}

export type DataListener = (data: Uint8Array) => void;

export interface PortInfo {
  name: string;
  kind: string;
  vid: number | null;
  pid: number | null;
}

// PJRC (Teensy) USB vendor id — same filter the chrome app's manifest used.
export const TEENSY_VID = 0x16c0;
