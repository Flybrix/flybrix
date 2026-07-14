// COBS framing round-trip tests for @flybrix/core.
// The Flybrix wire frame is [checksum, ...bytes, 0] where checksum is the XOR
// of every byte after it; `encode` COBS-stuffs it and the `Reader` reverses
// the whole thing, delivering the payload with the checksum byte stripped.
import { describe, expect, it } from 'vitest';
import { CobsReader, cobsEncode, type CobsIssue } from '../src/index.js';

/** Replicate the router's outbound framing: [checksum, type, ...payload, 0]. */
function frame(type: number, payload: number[]): Uint8Array {
  const out = new Uint8Array(payload.length + 3);
  out[0] = out[1] = type;
  for (let i = 0; i < payload.length; i++) {
    out[0] ^= out[i + 2] = payload[i];
  }
  out[payload.length + 2] = 0;
  return cobsEncode(out);
}

function readOne(bytes: Uint8Array): { data?: Uint8Array; issue?: CobsIssue } {
  const reader = new CobsReader(2000);
  let result: { data?: Uint8Array; issue?: CobsIssue } = {};
  reader.readBytes(
    bytes,
    (data) => {
      result = { data };
    },
    (issue) => {
      result = { issue };
    },
  );
  return result;
}

describe('cobs', () => {
  it('round-trips a simple frame, stripping the checksum byte', () => {
    const { data } = readOne(frame(1, [10, 20, 30]));
    // Delivered payload is [type, ...payload].
    expect(Array.from(data!)).toEqual([1, 10, 20, 30]);
  });

  it('round-trips a payload containing zero bytes', () => {
    const payload = [0, 5, 0, 0, 200, 0];
    const { data } = readOne(frame(0x80, payload));
    expect(Array.from(data!)).toEqual([0x80, ...payload]);
  });

  it('round-trips a run longer than 254 non-zero bytes (0xFE boundary)', () => {
    const payload = Array.from({ length: 300 }, (_, i) => (i % 254) + 1);
    const { data } = readOne(frame(4, payload));
    expect(Array.from(data!)).toEqual([4, ...payload]);
  });

  it('reports a checksum error when a byte is corrupted', () => {
    const framed = frame(1, [10, 20, 30]);
    framed[2] ^= 0xff; // flip a byte inside the frame
    const { issue } = readOne(framed);
    expect(issue).toBe('checksum');
  });

  it('handles two frames arriving in one chunk', () => {
    const a = frame(1, [1, 2, 3]);
    const b = frame(2, [9, 8]);
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);

    const reader = new CobsReader(2000);
    const received: number[][] = [];
    reader.readBytes(
      combined,
      (data) => received.push(Array.from(data)),
      () => {},
    );
    expect(received).toEqual([
      [1, 1, 2, 3],
      [2, 9, 8],
    ]);
  });

  it('reassembles a frame split across two readBytes calls', () => {
    const framed = frame(1, [10, 20, 30]);
    const split = Math.floor(framed.length / 2);
    const reader = new CobsReader(2000);
    let data: Uint8Array | undefined;
    const onOk = (d: Uint8Array) => {
      data = d;
    };
    reader.readBytes(framed.subarray(0, split), onOk, () => {});
    expect(data).toBeUndefined();
    reader.readBytes(framed.subarray(split), onOk, () => {});
    expect(Array.from(data!)).toEqual([1, 10, 20, 30]);
  });
});
