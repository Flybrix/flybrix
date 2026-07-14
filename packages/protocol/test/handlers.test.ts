// Ported from flybrix-serialization/test/handlers.js (Jasmine -> Vitest).
import { describe, expect, it } from 'vitest';
import { handlers, Serializer } from '../src/index.js';

const makeSerializer = (data: Uint8Array): Serializer =>
  new Serializer(new DataView(data.buffer, 0));

describe('handlers', () => {
  describe('empty', () => {
    it('is false for bool', () => {
      expect(handlers.bool.empty()).toEqual(false);
    });

    it('is zero for number', () => {
      expect(handlers.f64.empty()).toEqual(0);
    });

    it('is true for void', () => {
      expect(handlers.void.empty()).toEqual(true);
    });

    it('is empty string for s', () => {
      expect(handlers.s.empty()).toEqual('');
    });

    it('is empty string for string', () => {
      expect(handlers.string(5).empty()).toEqual('');
    });

    it('is array of empties for array', () => {
      expect(handlers.arrayUnmasked(3, handlers.bool).empty()).toEqual([false, false, false]);
    });

    it('is array of empties for masked array', () => {
      expect(handlers.arrayMasked(3, handlers.bool).empty()).toEqual([false, false, false]);
    });

    it('is array of empties for tuple', () => {
      expect(handlers.tupleUnmasked([handlers.bool, handlers.string(2)]).empty()).toEqual([
        false,
        '',
      ]);
    });

    it('is map of empties for masked map', () => {
      expect(
        handlers
          .mapMasked([
            { key: 'name', handler: handlers.string(9) },
            { key: 'price', handler: handlers.u32 },
          ])
          .empty(),
      ).toEqual({ name: '', price: 0 });
    });
  });

  describe('fullMask', () => {
    it('is null for basic handlers', () => {
      expect(handlers.bool.fullMask()).toEqual(null);
      expect(handlers.f64.fullMask()).toEqual(null);
      expect(handlers.s.fullMask()).toEqual(null);
      expect(handlers.void.fullMask()).toEqual(null);
      expect(handlers.string(5).fullMask()).toEqual(null);
    });

    it('is null for array of unmasked values', () => {
      expect(handlers.arrayUnmasked(3, handlers.bool).fullMask()).toEqual(null);
    });

    it('is map of children masks for array of masked values', () => {
      const child = handlers.arrayMasked(4, handlers.bool);
      const childMask = child.fullMask();
      expect(handlers.arrayUnmasked(3, child).fullMask()).toEqual({
        0: childMask,
        1: childMask,
        2: childMask,
      });
    });

    it('is map of children masks with mask field for masked array', () => {
      expect(handlers.arrayMasked(3, handlers.bool).fullMask()).toEqual({
        MASK: [true, true, true],
      });
    });

    it('is map of children masks with mask field for masked tuple', () => {
      const child = handlers.arrayMasked(4, handlers.bool);
      const childMask = child.fullMask();
      expect(handlers.tupleMasked([handlers.bool, child]).fullMask()).toEqual({
        1: childMask,
        MASK: [true, true],
      });
    });

    it('is map of non-null children masks with mask field for masked map', () => {
      const child = handlers.arrayMasked(4, handlers.bool);
      const childMask = child.fullMask();
      expect(
        handlers
          .mapMasked([
            { key: 'name', handler: child },
            { key: 'price', handler: handlers.u32 },
          ])
          .fullMask(),
      ).toEqual({
        name: childMask,
        MASK: { name: true, price: true },
      });
    });
  });

  describe('boolean', () => {
    it('encodes true and false', () => {
      const data = new Uint8Array(1);
      handlers.bool.encode(makeSerializer(data), true);
      expect(data).toEqual(new Uint8Array([1]));
      handlers.bool.encode(makeSerializer(data), false);
      expect(data).toEqual(new Uint8Array([0]));
    });

    it('decodes any nonzero as true', () => {
      expect(handlers.bool.decode(makeSerializer(new Uint8Array([5])))).toEqual(true);
      expect(handlers.bool.decode(makeSerializer(new Uint8Array([0])))).toEqual(false);
    });

    it('has right amount of bytes and descriptor', () => {
      expect(handlers.bool.byteCount).toBe(1);
      expect(handlers.bool.descriptor).toBe('bool');
    });
  });

  describe('void', () => {
    it('encodes nothing', () => {
      const data = new Uint8Array([3, 5, 2]);
      const b = makeSerializer(data);
      handlers.void.encode(b, [2, 1, 4]);
      expect(data).toEqual(new Uint8Array([3, 5, 2]));
      expect(b.index).toBe(0);
    });

    it('decodes to true', () => {
      expect(handlers.void.decode(makeSerializer(new Uint8Array([3, 5, 2])))).toEqual(true);
    });

    it('has zero bytes and correct descriptor', () => {
      expect(handlers.void.byteCount).toBe(0);
      expect(handlers.void.descriptor).toBe('void');
    });
  });

  describe('numbers', () => {
    const cases: [keyof typeof handlers, number, number[]][] = [
      ['u8', 180, [180]],
      ['u16', 0xf00d, [0x0d, 0xf0]],
      ['u32', 0xf00dd33d, [0x3d, 0xd3, 0x0d, 0xf0]],
      ['i8', -100, [156]],
      ['i16', -10000, [240, 216]],
      ['i32', -1000000000, [0x00, 0x36, 0x65, 0xc4]],
      ['f32', 1005.75, [0x00, 0x70, 0x7b, 0x44]],
      ['f64', 1005.75, [0x00, 0x00, 0x00, 0x00, 0x00, 0x6e, 0x8f, 0x40]],
    ];

    it.each(cases)('%s round-trips little-endian', (name, value, bytes) => {
      const handler = handlers[name as 'u8'];
      const data = new Uint8Array(bytes.length);
      handler.encode(makeSerializer(data), value);
      expect(data).toEqual(new Uint8Array(bytes));
      expect(handler.decode(makeSerializer(new Uint8Array(bytes)))).toEqual(value);
      expect(handler.byteCount).toBe(bytes.length);
      expect(handler.descriptor).toBe(name);
    });
  });

  describe('string', () => {
    it('encodes short string', () => {
      const data = new Uint8Array(9);
      handlers.string(9).encode(makeSerializer(data), 'Abcd');
      expect(data).toEqual(new Uint8Array([65, 98, 99, 100, 0, 0, 0, 0, 0]));
    });

    it('encodes overflowed string with null terminator', () => {
      const data = new Uint8Array(6);
      handlers.string(6).encode(makeSerializer(data), 'Abc0123456');
      expect(data).toEqual(new Uint8Array([65, 98, 99, 48, 49, 0]));
    });

    it('decodes short string', () => {
      const data = new Uint8Array([65, 98, 99, 100, 0, 0, 0, 48, 49]);
      expect(handlers.string(9).decode(makeSerializer(data))).toEqual('Abcd');
    });

    it('decodes unterminated string by trimming the end', () => {
      const data = new Uint8Array([65, 98, 99, 48, 49, 50]);
      expect(handlers.string(6).decode(makeSerializer(data))).toEqual('Abc01');
    });

    it('has correct byte count and descriptor', () => {
      expect(handlers.string(9).byteCount).toBe(9);
      expect(handlers.string(12).descriptor).toBe('s12');
      expect(handlers.string(3).descriptor).toBe('s3');
    });
  });

  describe('s', () => {
    it('encodes short string with terminator', () => {
      const data = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
      handlers.s.encode(makeSerializer(data), 'Abcd');
      expect(data).toEqual(new Uint8Array([65, 98, 99, 100, 0, 1, 1, 1, 1]));
    });

    it('encodes exactly long string', () => {
      const data = new Uint8Array(9);
      handlers.s.encode(makeSerializer(data), '012345678');
      expect(data).toEqual(new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56]));
    });

    it('truncates too long string', () => {
      const data = new Uint8Array(9);
      handlers.s.encode(makeSerializer(data), '01234567890123456789');
      expect(data).toEqual(new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56]));
    });

    it('has 0 bytes in byte count', () => {
      expect(handlers.s.byteCount).toBe(0);
    });

    it('decodes short string', () => {
      const data = new Uint8Array([65, 98, 99, 100, 0, 0, 0, 48, 49]);
      expect(handlers.s.decode(makeSerializer(data))).toEqual('Abcd');
    });

    it('decodes unterminated string by consuming the buffer', () => {
      const data = new Uint8Array([65, 98, 99, 48, 49, 50]);
      expect(handlers.s.decode(makeSerializer(data))).toEqual('Abc012');
    });
  });

  describe('map without masking', () => {
    const makeHandler = () =>
      handlers.mapUnmasked([
        { key: 'a', handler: handlers.arrayMasked(4, handlers.u8, 8) },
        { key: 'b', handler: handlers.string(5) },
        { key: 'c', handler: handlers.arrayUnmasked(4, handlers.u8) },
      ]);

    it('has the correct descriptor', () => {
      expect(makeHandler().descriptor).toBe('{a:[/8/u8:4],b:s5,c:[u8:4]}');
    });

    it('encodes any data without mask field', () => {
      const data = new Uint8Array(12);
      makeHandler().encode(makeSerializer(data), {
        a: [0, 1, null, null],
        b: 'abcd',
        c: [4, 5, 6, 7],
      });
      expect(data).toEqual(new Uint8Array([3, 0, 1, 97, 98, 99, 100, 0, 4, 5, 6, 7]));
    });

    it('encodes any data with mask field', () => {
      const data = new Uint8Array(12);
      makeHandler().encode(
        makeSerializer(data),
        { a: [0, 1, null, 3], b: 'abcd', c: [4, 5, 6, 7] },
        { a: { MASK: [true, true, true, false] } },
      );
      expect(data).toEqual(new Uint8Array([3, 0, 1, 97, 98, 99, 100, 0, 4, 5, 6, 7]));
    });

    it('has right amount of bytes', () => {
      expect(makeHandler().byteCount).toBe(14);
    });

    it('decodes any data', () => {
      const data = new Uint8Array([3, 0, 1, 97, 98, 99, 100, 0, 4, 5, 6, 7]);
      expect(makeHandler().decode(makeSerializer(data))).toEqual({
        a: [0, 1, null, null],
        b: 'abcd',
        c: [4, 5, 6, 7],
      });
    });
  });

  describe('map with masking', () => {
    const makeHandler = () =>
      handlers.mapMasked(
        [
          { key: 'a', handler: handlers.arrayMasked(4, handlers.u8, 8) },
          { key: 'b', handler: handlers.string(5) },
          { key: 'c', handler: handlers.arrayUnmasked(4, handlers.u8) },
        ],
        35,
      );

    it('has the correct descriptor', () => {
      expect(makeHandler().descriptor).toBe('{/40/a:[/8/u8:4],b:s5,c:[u8:4]}');
    });

    it('encodes any data without mask field', () => {
      const data = new Uint8Array(13);
      makeHandler().encode(makeSerializer(data), {
        a: [0, 1, null, null],
        b: 'abcd',
        c: null,
      });
      expect(data).toEqual(new Uint8Array([3, 0, 0, 0, 0, 3, 0, 1, 97, 98, 99, 100, 0]));
    });

    it('encodes any data with mask field', () => {
      const data = new Uint8Array(13);
      makeHandler().encode(
        makeSerializer(data),
        { a: [0, 1, null, 3], b: 'abcd', c: [4, 5, 6, 7] },
        {
          a: { MASK: [true, true, true, false] },
          MASK: { a: true, b: true },
        },
      );
      expect(data).toEqual(new Uint8Array([3, 0, 0, 0, 0, 3, 0, 1, 97, 98, 99, 100, 0]));
    });

    it('has right amount of bytes', () => {
      expect(makeHandler().byteCount).toBe(19);
    });

    it('decodes any data, omitting unmasked keys', () => {
      const data = new Uint8Array([3, 0, 0, 0, 0, 3, 0, 1, 97, 98, 99, 100, 0]);
      expect(makeHandler().decode(makeSerializer(data))).toEqual({
        a: [0, 1, null, null],
        b: 'abcd',
      });
    });

    it('produces right numbers for masked bytes', () => {
      const handler = makeHandler();
      expect(handler.maskedBytes!({})).toEqual(5);
      expect(handler.maskedBytes!({ a: true, b: true, c: true })).toEqual(19);
      expect(handler.maskedBytes!({ a: true, b: true, c: false })).toEqual(15);
      expect(handler.maskedBytes!({ a: true, b: false, c: true })).toEqual(14);
      expect(handler.maskedBytes!({ a: true, b: false, c: false })).toEqual(10);
      expect(handler.maskedBytes!({ a: false, b: true, c: true })).toEqual(14);
      expect(handler.maskedBytes!({ a: false, b: true, c: false })).toEqual(10);
      expect(handler.maskedBytes!({ a: false, b: false, c: true })).toEqual(9);
      expect(handler.maskedBytes!({ a: false, b: false, c: false })).toEqual(5);
    });
  });

  describe('tuple with masking', () => {
    const makeHandler = () =>
      handlers.tupleMasked(
        [
          handlers.arrayMasked(4, handlers.u8, 8),
          handlers.string(5),
          handlers.arrayUnmasked(4, handlers.u8),
        ],
        35,
      );

    it('has the correct descriptor', () => {
      expect(makeHandler().descriptor).toBe('(/40/[/8/u8:4],s5,[u8:4])');
    });

    it('encodes any data without mask field', () => {
      const data = new Uint8Array(13);
      makeHandler().encode(makeSerializer(data), [[0, 1, null, null], 'abcd', null]);
      expect(data).toEqual(new Uint8Array([3, 0, 0, 0, 0, 3, 0, 1, 97, 98, 99, 100, 0]));
    });

    it('encodes any data with mask field', () => {
      const data = new Uint8Array(13);
      makeHandler().encode(
        makeSerializer(data),
        [[0, 1, null, 3], 'abcd', [4, 5, 6, 7]],
        {
          0: { MASK: [true, true, true, false] },
          MASK: [true, true, false],
        },
      );
      expect(data).toEqual(new Uint8Array([3, 0, 0, 0, 0, 3, 0, 1, 97, 98, 99, 100, 0]));
    });

    it('has right amount of bytes', () => {
      expect(makeHandler().byteCount).toBe(19);
    });

    it('decodes any data', () => {
      const data = new Uint8Array([3, 0, 0, 0, 0, 3, 0, 1, 97, 98, 99, 100, 0]);
      expect(makeHandler().decode(makeSerializer(data))).toEqual([
        [0, 1, null, null],
        'abcd',
        null,
      ]);
    });
  });

  describe('array without masking', () => {
    const makeHandler = () => handlers.arrayUnmasked(3, handlers.arrayMasked(4, handlers.u8, 8));

    it('has the correct descriptor', () => {
      expect(makeHandler().descriptor).toBe('[[/8/u8:4]:3]');
    });

    it('encodes any data without mask field', () => {
      const data = new Uint8Array(12);
      makeHandler().encode(makeSerializer(data), [
        [0, 1, null, null],
        [4, null, 6, 7],
        [8, 9, 10, 11],
      ]);
      expect(data).toEqual(new Uint8Array([3, 0, 1, 13, 4, 6, 7, 15, 8, 9, 10, 11]));
    });

    it('has right amount of bytes', () => {
      expect(makeHandler().byteCount).toBe(15);
    });

    it('decodes any data', () => {
      const data = new Uint8Array([3, 0, 1, 13, 4, 6, 7, 15, 8, 9, 10, 11]);
      expect(makeHandler().decode(makeSerializer(data))).toEqual([
        [0, 1, null, null],
        [4, null, 6, 7],
        [8, 9, 10, 11],
      ]);
    });
  });

  describe('array with masking', () => {
    const makeHandler = () =>
      handlers.arrayMasked(3, handlers.arrayMasked(4, handlers.u8, 8), 18);

    it('has the correct descriptor', () => {
      expect(makeHandler().descriptor).toBe('[/24/[/8/u8:4]:3]');
    });

    it('encodes any data without mask field', () => {
      const data = new Uint8Array(11);
      makeHandler().encode(makeSerializer(data), [[0, 1, null, null], null, [8, 9, 10, 11]]);
      expect(data).toEqual(new Uint8Array([5, 0, 0, 3, 0, 1, 15, 8, 9, 10, 11]));
    });

    it('encodes any data with mask field', () => {
      const data = new Uint8Array(11);
      makeHandler().encode(
        makeSerializer(data),
        [
          [0, 1, null, 3],
          [4, 5, 6, 7],
          [8, 9, 10, 11],
        ],
        {
          0: { MASK: [true, true, true, false] },
          MASK: [true, false, true],
        },
      );
      expect(data).toEqual(new Uint8Array([5, 0, 0, 3, 0, 1, 15, 8, 9, 10, 11]));
    });

    it('encodes any data with mask field, and missing fields', () => {
      const data = new Uint8Array(6);
      makeHandler().encode(
        makeSerializer(data),
        [[0, 1, null, 3], [4, 5, 6, 7], null],
        {
          0: { MASK: [true, true, true, false] },
          MASK: [true, false, true],
        },
      );
      expect(data).toEqual(new Uint8Array([1, 0, 0, 3, 0, 1]));
    });

    it('has right amount of bytes', () => {
      expect(makeHandler().byteCount).toBe(18);
    });

    it('decodes any data', () => {
      const data = new Uint8Array([5, 0, 0, 3, 0, 1, 15, 8, 9, 10, 11]);
      expect(makeHandler().decode(makeSerializer(data))).toEqual([
        [0, 1, null, null],
        null,
        [8, 9, 10, 11],
      ]);
    });
  });
});
