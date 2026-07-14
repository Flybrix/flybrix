import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { DataListener, PortInfo, Transport } from "./Transport";

export async function listPorts(): Promise<PortInfo[]> {
  return invoke<PortInfo[]>("serial_list_ports");
}

export class TauriSerialTransport implements Transport {
  private unlisten: UnlistenFn[] = [];
  private sending = false;

  private constructor(private onError: (msg: string) => void) {}

  static async open(
    path: string,
    onData: DataListener,
    onError: (msg: string) => void,
    baud = 230400,
  ): Promise<TauriSerialTransport> {
    const t = new TauriSerialTransport(onError);
    t.unlisten.push(
      await listen<number[]>("serial:data", (e) => onData(Uint8Array.from(e.payload))),
      await listen<string>("serial:error", (e) => onError(e.payload)),
    );
    try {
      await invoke("serial_open", { path, baud });
    } catch (err) {
      await t.close();
      throw err;
    }
    return t;
  }

  async send(data: Uint8Array): Promise<void> {
    this.sending = true;
    try {
      await invoke("serial_write", { data: Array.from(data) });
    } catch (err) {
      this.onError(String(err));
      throw err;
    } finally {
      this.sending = false;
    }
  }

  busy(): boolean {
    return this.sending;
  }

  async close(): Promise<void> {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
    await invoke("serial_close");
  }
}
