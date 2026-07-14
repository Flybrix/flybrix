/**
 * Binds the @flybrix/core message router to a concrete transport. On connect
 * it opens the transport, pipes inbound bytes into the router, and kicks off
 * firmware-version negotiation. UI code subscribes via onReceive/onLog.
 */
import { SerialRouter, type MessageTypeName } from "@flybrix/core";
import type { DataListener, Transport } from "./transport/Transport";

export interface DeviceHandlers {
  onReceive: (type: MessageTypeName, message: unknown) => void;
  onLog: (message: string) => void;
  onDisconnect: () => void;
}

/**
 * Opens a concrete transport, wiring the given data/error callbacks. Lets the
 * Device stay agnostic to USB serial vs BLE — the caller supplies whichever.
 */
export type TransportOpener = (
  onData: DataListener,
  onError: (msg: string) => void,
) => Promise<Transport>;

export class Device {
  readonly router = new SerialRouter({ log: (m) => this.handlers.onLog(m) });
  private transport: Transport | null = null;

  constructor(private handlers: DeviceHandlers) {
    this.router.addOnReceiveCallback((type, message) =>
      this.handlers.onReceive(type, message),
    );
  }

  async connect(open: TransportOpener): Promise<void> {
    const transport = await open(
      (data) => this.router.onRead(data),
      (msg) => {
        this.handlers.onLog(`transport error: ${msg}`);
        this.handlers.onDisconnect();
      },
    );
    this.transport = transport;
    this.router.setTransport(transport);
    // Ask the board who it is; the Response/Protocol handlers registered in
    // the router update firmware version and schema negotiation.
    try {
      await this.router.handlePostConnect();
    } catch (err) {
      this.handlers.onLog(`version negotiation pending: ${err}`);
    }
  }

  firmwareKey(): string {
    return this.router.firmware.key();
  }

  async disconnect(): Promise<void> {
    await this.transport?.close();
    this.transport = null;
  }
}
