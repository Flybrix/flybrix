/**
 * Flybrix message router: frames outbound structures (type byte + XOR
 * checksum + COBS), decodes inbound frames, dispatches messages to listeners,
 * tracks command acknowledgements, and handles protocol-version negotiation.
 *
 * Ported from flybrix-common/src/serial.js with all Angular constructs
 * replaced: $q -> native Promise, $timeout -> setTimeout, the Angular factory
 * -> a plain class, commandLog -> an injectable log callback. The legacy
 * `Backend` contract is preserved as the `Transport` interface plus the
 * router's `onRead` entry point.
 */
import { Serializer, type MaskSpec } from '@flybrix/protocol';
import { encode as cobsEncode, Reader } from './cobs.js';
import { FirmwareVersion } from './firmwareVersion.js';
import { SerializationHandlerRegistry } from './serializationHandler.js';

/**
 * Physical link abstraction (Tauri serial, Web Bluetooth, WebUSB, ...).
 * Mirrors the legacy serial.Backend contract: implement send/busy, and feed
 * received bytes into SerialRouter.onRead.
 */
export interface Transport {
  send(data: Uint8Array): Promise<void> | void;
  busy(): boolean;
}

export enum MessageType {
  State = 0,
  Command = 1,
  DebugString = 3,
  HistoryData = 4,
  Protocol = 128,
  Response = 255,
}

export type MessageTypeName = keyof typeof MessageType;

export type OnReceiveCallback = (messageType: MessageTypeName, message: any) => void;

export type BytesHandler = (
  data: Uint8Array,
  processData: (bytes: Uint8Array) => void,
) => void;

export interface SerialRouterOptions {
  /** Handler registry; a descriptor-seeded one is created if omitted. */
  registry?: SerializationHandlerRegistry;
  /** Firmware version tracker; created over the registry if omitted. */
  firmware?: FirmwareVersion;
  /** Diagnostics sink (legacy commandLog). Defaults to a no-op. */
  log?: (message: string) => void;
  /** COBS reader buffer capacity in bytes (legacy default 10000). */
  readerCapacity?: number;
}

const MessageTypeInversion: MessageTypeName[] = [];
(Object.keys(MessageType) as MessageTypeName[]).forEach((key) => {
  const code = MessageType[key];
  if (typeof code === 'number') {
    MessageTypeInversion[code] = key;
  }
});

interface PendingAcknowledge {
  mask: number;
  resolve: () => void;
  reject: (reason: Error) => void;
}

export class SerialRouter {
  readonly registry: SerializationHandlerRegistry;
  readonly firmware: FirmwareVersion;

  private transport: Transport;
  private readonly log: (message: string) => void;
  private readonly cobsReader: Reader;
  private acknowledges: PendingAcknowledge[] = [];
  private onReceiveListeners: OnReceiveCallback[] = [];
  private bytesHandler: BytesHandler | undefined = undefined;
  private lastTimestampUs = 0;

  constructor(options: SerialRouterOptions = {}) {
    this.registry = options.registry ?? new SerializationHandlerRegistry();
    this.firmware = options.firmware ?? new FirmwareVersion(this.registry);
    this.log = options.log ?? (() => {});
    this.cobsReader = new Reader(options.readerCapacity ?? 10000);
    this.transport = this.defaultTransport();

    this.addOnReceiveCallback((messageType, message) => {
      if (messageType === 'Response') {
        this.acknowledge(message.mask, message.ack);
      } else if (messageType === 'Protocol') {
        const data = message.response;
        if (data) {
          this.registry.addHandler(data.version, data.structure);
        }
      }
    });
  }

  private defaultTransport(): Transport {
    return {
      send: () => {
        this.log('No "send" defined for serial backend');
      },
      busy: () => false,
    };
  }

  /** Plug in the physical link (legacy setBackend). */
  setTransport(transport: Transport): void {
    this.transport = transport;
  }

  busy(): boolean {
    return this.transport.busy();
  }

  /**
   * Entry point for raw bytes arriving from the transport
   * (legacy backend.onRead).
   */
  onRead(data: Uint8Array): void {
    if (this.bytesHandler) {
      this.bytesHandler(data, this.processData);
    } else {
      this.cobsReader.readBytes(data, this.processData, (issue, text) => {
        this.log('COBS decoding failed (' + issue + '): ' + text);
      });
    }
  }

  /** Override raw byte handling (e.g. for non-COBS transports). */
  setBytesHandler(handler: BytesHandler | undefined): void {
    this.bytesHandler = handler;
  }

  addOnReceiveCallback(callback: OnReceiveCallback): void {
    this.onReceiveListeners = this.onReceiveListeners.concat([callback]);
  }

  removeOnReceiveCallback(callback: OnReceiveCallback): void {
    this.onReceiveListeners = this.onReceiveListeners.filter((cb) => cb !== callback);
  }

  /** Kick off protocol negotiation after connecting. */
  handlePostConnect(): Promise<void> {
    return this.requestFirmwareVersion();
  }

  private requestFirmwareVersion(): Promise<void> {
    return this.sendStructure('Command', {
      request_response: true,
      req_partial_eeprom_data: {
        version: true,
      },
    });
  }

  /**
   * Encode, frame, and send a structure. The returned promise resolves when
   * the firmware acknowledges the command (Response message with a matching
   * mask) and rejects on a missing or partial acknowledgement.
   */
  sendStructure(
    messageType: MessageTypeName,
    data: any,
    options: { logSend?: boolean; extraMask?: MaskSpec } = {},
  ): Promise<void> {
    if (messageType === 'State') {
      data = this.processStateOutput(data);
    }
    const handlers = this.firmware.serializationHandler();

    if (!(messageType in MessageType)) {
      return Promise.reject(
        new Error(
          'Message type "' +
            messageType +
            '" not supported by app, supported message types are:' +
            Object.keys(MessageType)
              .filter((key) => isNaN(Number(key)))
              .join(', '),
        ),
      );
    }
    if (!handlers || !(messageType in handlers)) {
      return Promise.reject(
        new Error(
          'Message type "' +
            messageType +
            '" not supported by firmware, supported message types are:' +
            Object.keys(handlers ?? {}).join(', '),
        ),
      );
    }
    const typeCode = MessageType[messageType];
    const handler = handlers[messageType];

    const buffer = new Uint8Array(handler.byteCount);
    const serializer = new Serializer(new DataView(buffer.buffer));
    handler.encode(serializer, data, options.extraMask);
    const maskArray = handler.maskArray(data, options.extraMask);
    let mask = 0;
    if (maskArray.length < 5) {
      mask =
        ((maskArray[0] ?? 0) << 0) |
        ((maskArray[1] ?? 0) << 8) |
        ((maskArray[2] ?? 0) << 16) |
        ((maskArray[3] ?? 0) << 24);
    }

    const dataLength = serializer.index;

    const output = new Uint8Array(dataLength + 3);
    output[0] = output[1] = typeCode;
    for (let idx = 0; idx < dataLength; ++idx) {
      output[0] ^= output[idx + 2] = buffer[idx];
    }
    output[dataLength + 2] = 0;

    const promise = new Promise<void>((resolve, reject) => {
      this.acknowledges.push({ mask, resolve, reject });
    });

    setTimeout(() => {
      void this.transport.send(cobsEncode(output));
    }, 0);

    if (options.logSend) {
      this.log('Sending command ' + typeCode);
    }

    return promise;
  }

  private acknowledge(mask: number, value: number): void {
    while (this.acknowledges.length > 0) {
      const v = this.acknowledges.shift()!;
      if (v.mask ^ mask) {
        v.reject(new Error('Missing ACK'));
        continue;
      }
      let relaxedMask = mask;
      relaxedMask &= ~1;
      if (relaxedMask ^ value) {
        v.reject(new Error('Request was not fully processed'));
        break;
      }
      v.resolve();
      break;
    }
  }

  private processData = (bytes: Uint8Array): void => {
    const messageType = MessageTypeInversion[bytes[0]];
    const handler = messageType
      ? this.firmware.serializationHandler()?.[messageType]
      : undefined;
    if (!messageType || !handler) {
      this.log('Illegal message type passed from firmware');
      return;
    }
    let message: any;
    try {
      const serializer = new Serializer(
        new DataView(bytes.buffer, bytes.byteOffset + 1, bytes.byteLength - 1),
      );
      message = handler.decode(serializer);
    } catch {
      // The legacy code logged this and then dispatched an undefined message;
      // this port stops here instead.
      this.log('Unrecognized message format received');
      return;
    }
    if (messageType === 'State') {
      message = this.processStateInput(message);
    }
    this.onReceiveListeners.forEach((listener) => {
      listener(messageType, message);
    });
  };

  private processStateInput(state: any): any {
    state = Object.assign({}, state);

    if ('timestamp_us' in state) {
      state.serial_update_rate_estimate = 1000000 / (state.timestamp_us - this.lastTimestampUs);
      this.lastTimestampUs = state.timestamp_us;
    }
    if ('temperature' in state) {
      state.temperature /= 100.0; // temperature given in Celsius * 100
    }
    if ('pressure' in state) {
      state.pressure /= 256.0; // pressure given in (Q24.8) format
    }

    return state;
  }

  private processStateOutput(state: any): any {
    state = Object.assign({}, state);
    if ('temperature' in state) {
      state.temperature *= 100.0;
    }
    if ('pressure' in state) {
      state.pressure *= 256.0;
    }
    return state;
  }
}
