// End-to-end message-router tests for @flybrix/core: prove that a structure
// encoded and framed on one side is decoded and dispatched on the other, and
// that acknowledgement tracking resolves/rejects command promises correctly.
import { Serializer } from '@flybrix/protocol';
import { describe, expect, it } from 'vitest';
import {
  MessageType,
  SerializationHandlerRegistry,
  SerialRouter,
  cobsEncode,
  type MessageTypeName,
  type Transport,
} from '../src/index.js';

/** A Transport that records every framed buffer sent through it. */
class CapturingTransport implements Transport {
  readonly sent: Uint8Array[] = [];
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  busy(): boolean {
    return false;
  }
}

/** Encode a message with the registry's newest handler and frame it for onRead. */
function frameMessage(
  registry: SerializationHandlerRegistry,
  type: MessageTypeName,
  data: unknown,
): Uint8Array {
  const version = registry.getNewestVersion();
  const handlers = registry.getHandler(
    `${version.major}.${version.minor}.${version.patch}`,
  )!;
  const handler = handlers[type];
  const buffer = new Uint8Array(handler.byteCount);
  const serializer = new Serializer(new DataView(buffer.buffer));
  handler.encode(serializer, data);
  const payload = buffer.subarray(0, serializer.index);

  const out = new Uint8Array(payload.length + 3);
  out[0] = out[1] = MessageType[type];
  for (let i = 0; i < payload.length; i++) {
    out[0] ^= out[i + 2] = payload[i];
  }
  out[payload.length + 2] = 0;
  return cobsEncode(out);
}

describe('SerialRouter', () => {
  it('decodes and dispatches an inbound Response frame', () => {
    const router = new SerialRouter();
    const received: Array<{ type: MessageTypeName; message: any }> = [];
    router.addOnReceiveCallback((type, message) => received.push({ type, message }));

    const framed = frameMessage(router.registry, 'Response', { mask: 42, ack: 42 });
    router.onRead(framed);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('Response');
    expect(received[0].message.mask).toBe(42);
    expect(received[0].message.ack).toBe(42);
  });

  it('feeds outbound bytes to the transport as a decodable frame', async () => {
    const transport = new CapturingTransport();
    const sender = new SerialRouter();
    sender.setTransport(transport);

    // Fire a command; we only care that it produces a valid frame on the wire.
    void sender.sendStructure('Command', { request_response: true });
    await new Promise((r) => setTimeout(r, 0)); // sendStructure defers via setTimeout(0)

    expect(transport.sent).toHaveLength(1);

    // A second router must be able to decode what the first one framed.
    const receiver = new SerialRouter();
    const received: MessageTypeName[] = [];
    receiver.addOnReceiveCallback((type) => received.push(type));
    receiver.onRead(transport.sent[0]);

    expect(received).toEqual(['Command']);
  });

  it('resolves a command promise when a matching full ACK arrives', async () => {
    const router = new SerialRouter();
    router.setTransport(new CapturingTransport());

    const pending = router.sendStructure('Command', { request_response: true });
    let settled: 'resolved' | 'rejected' | 'pending' = 'pending';
    pending.then(
      () => (settled = 'resolved'),
      () => (settled = 'rejected'),
    );
    await new Promise((r) => setTimeout(r, 0));

    // The command's only field is request_response (mask bit 0). acknowledge()
    // clears bit 0 before comparing to ack, so a full ACK is {mask:1, ack:0}.
    const framed = frameMessage(router.registry, 'Response', { mask: 1, ack: 0 });
    router.onRead(framed);
    await new Promise((r) => setTimeout(r, 0));

    expect(settled).toBe('resolved');
  });

  it('rejects a command promise when the ACK reports partial processing', async () => {
    const router = new SerialRouter();
    router.setTransport(new CapturingTransport());

    const pending = router.sendStructure('Command', { request_response: true });
    let rejection: Error | undefined;
    pending.catch((err) => (rejection = err));
    await new Promise((r) => setTimeout(r, 0));

    // Matching mask, but a data bit set in ack (bit 0 is cleared before the
    // comparison) means the request was not fully processed.
    const framed = frameMessage(router.registry, 'Response', { mask: 1, ack: 1 });
    router.onRead(framed);
    await new Promise((r) => setTimeout(r, 0));

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection?.message).toMatch(/not fully processed/);
  });

  it('ignores an inbound frame whose type has no handler', () => {
    const router = new SerialRouter();
    const received: MessageTypeName[] = [];
    router.addOnReceiveCallback((type) => received.push(type));

    // Frame a Response but stamp an unsupported type byte (200) before it.
    const good = frameMessage(router.registry, 'Response', { mask: 1, ack: 1 });
    // Corrupting the type is hard post-COBS; instead build a raw framed buffer
    // with a type code (200) that is not in MessageType.
    const raw = new Uint8Array([200, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // type + 8 payload bytes
    let checksum = 0;
    for (let i = 0; i < raw.length; i++) checksum ^= raw[i];
    const framed = cobsEncode(new Uint8Array([checksum, ...raw, 0]));

    router.onRead(framed);
    router.onRead(good); // a valid one still dispatches afterward

    expect(received).toEqual(['Response']);
  });
});

describe('SerializationHandlerRegistry', () => {
  it('seeds handlers from bundled descriptors and tracks the newest version', () => {
    const registry = new SerializationHandlerRegistry();
    const newest = registry.getNewestVersion();
    expect(`${newest.major}.${newest.minor}.${newest.patch}`).toBe('1.6.0');
    expect(registry.getHandler('1.6.0')).toBeDefined();
    expect(registry.getHandler('1.4.0')).toBeDefined();
  });

  it('starts empty and accepts a runtime-registered handler', () => {
    const registry = new SerializationHandlerRegistry(false);
    expect(registry.getHandler('2.0.0')).toBeUndefined();
    registry.addHandler({ major: 2, minor: 0, patch: 0 }, 'Ping={value:u8};');
    const handlers = registry.getHandler('2.0.0');
    expect(handlers).toBeDefined();
    expect(handlers!['Ping'].byteCount).toBe(1);
    expect(registry.getNewestVersion()).toEqual({ major: 2, minor: 0, patch: 0 });
  });
});
