/**
 * Wire-format handlers for the Flybrix serialization schema DSL.
 * Ported from flybrix-serialization/src/handlers.js, preserving exact
 * wire-format semantics (byte counts, little-endian numerics, bitmask
 * layout for masked maps/tuples/arrays, ASCII strings).
 */
import { Serializer } from './serializer.js';

/**
 * Mask specifications mirror the shape of the data they mask:
 * `true` means "encode everything non-null", objects/arrays carry per-child
 * masks plus an optional MASK entry for masked containers.
 */
export type MaskSpec = any;

const nullMask = (): MaskSpec => null;
const nullMaskArray = (): number[] => [];
const defaultIsNull = (val: unknown): boolean => val === null || val === undefined;

export class Handler<T = any> {
  descriptor: string;
  byteCount: number;
  empty: () => T;
  encode: (serializer: Serializer, data: T, masks?: MaskSpec) => void;
  decode: (serializer: Serializer) => T;
  fullMask: () => MaskSpec;
  maskArray: (data: T, masks?: MaskSpec) => number[];
  isNull: (val: unknown) => boolean;
  isBasic = false;
  /** Only present on masked maps: byte count for a given field subset. */
  maskedBytes?: (fields: Record<string, unknown>) => number;

  constructor(
    descriptor: string,
    byteCount: number,
    empty: () => T,
    encode: (serializer: Serializer, data: T, masks?: MaskSpec) => void,
    decode: (serializer: Serializer) => T,
    fullMask?: (() => MaskSpec) | null,
    maskArray?: ((data: T, masks?: MaskSpec) => number[]) | null,
    isNull?: ((val: unknown) => boolean) | null,
  ) {
    this.descriptor = descriptor;
    this.byteCount = byteCount;
    this.empty = empty;
    this.encode = encode;
    this.decode = decode;
    this.fullMask = fullMask ?? nullMask;
    this.maskArray = maskArray ?? nullMaskArray;
    this.isNull = isNull ?? defaultIsNull;
  }
}

export type HandlerLibrary = Record<string, Handler>;

export interface MapChild {
  key: string;
  handler: Handler;
}

const hasBit = (mask: number[], idx: number): boolean =>
  (mask[Math.floor(idx / 8)] & (1 << idx % 8)) !== 0;

const emptyNumeric = (): number => 0;

const zeroArray = (l: number): number[] => {
  const result: number[] = [];
  for (let idx = 0; idx < l; ++idx) {
    result.push(0);
  }
  return result;
};

const createNumericType = (
  descriptor: string,
  byteCount: number,
  get: (dataView: DataView, index: number) => number,
  set: (dataView: DataView, index: number, value: number) => void,
): Handler<number> => {
  const encode = (serializer: Serializer, data: number): void => {
    set(serializer.dataView, serializer.index, data);
    serializer.add(byteCount);
  };
  const decode = (serializer: Serializer): number => {
    const data = get(serializer.dataView, serializer.index);
    serializer.add(byteCount);
    return data;
  };
  const handler = new Handler<number>(descriptor, byteCount, emptyNumeric, encode, decode);
  handler.isBasic = true;
  return handler;
};

// All multi-byte values are little-endian on the wire.
export const u8 = createNumericType('u8', 1, (dv, i) => dv.getUint8(i), (dv, i, v) => dv.setUint8(i, v));
export const u16 = createNumericType('u16', 2, (dv, i) => dv.getUint16(i, true), (dv, i, v) => dv.setUint16(i, v, true));
export const u32 = createNumericType('u32', 4, (dv, i) => dv.getUint32(i, true), (dv, i, v) => dv.setUint32(i, v, true));
export const i8 = createNumericType('i8', 1, (dv, i) => dv.getInt8(i), (dv, i, v) => dv.setInt8(i, v));
export const i16 = createNumericType('i16', 2, (dv, i) => dv.getInt16(i, true), (dv, i, v) => dv.setInt16(i, v, true));
export const i32 = createNumericType('i32', 4, (dv, i) => dv.getInt32(i, true), (dv, i, v) => dv.setInt32(i, v, true));
export const f32 = createNumericType('f32', 4, (dv, i) => dv.getFloat32(i, true), (dv, i, v) => dv.setFloat32(i, v, true));
export const f64 = createNumericType('f64', 8, (dv, i) => dv.getFloat64(i, true), (dv, i, v) => dv.setFloat64(i, v, true));

export const bool = new Handler<boolean>(
  'bool',
  u8.byteCount,
  () => false,
  (serializer, data) => {
    u8.encode(serializer, data ? 1 : 0);
  },
  (serializer) => u8.decode(serializer) !== 0,
);
bool.isBasic = true;

export const voidHandler = new Handler<any>(
  'void',
  0,
  () => true,
  () => {},
  () => true,
  null,
  null,
  (val) => !val,
);
voidHandler.isBasic = true;

const asciiEncode = (name: string, length: number): number[] => {
  const response = zeroArray(length);
  name.split('').forEach((c, idx) => {
    response[idx] = c.charCodeAt(0);
  });
  response[length - 1] = 0;
  return response;
};

const asciiDecode = (name: number[], length: number): string => {
  let response = '';
  const l = Math.min(name.length, length - 1);
  for (let i = 0; i < l; ++i) {
    if (name[i] === 0) {
      return response;
    }
    response += String.fromCharCode(name[i]);
  }
  return response;
};

/** Fixed-length null-terminated ASCII string ("sN" in the DSL). */
export const string = (length: number): Handler<string> => {
  const handler = arrayUnmasked(length, u8);
  const encode = (serializer: Serializer, data: string): void => {
    handler.encode(serializer, asciiEncode(data, length));
  };
  const decode = (serializer: Serializer): string =>
    asciiDecode(handler.decode(serializer), length);
  const empty = (): string => '';
  return new Handler<string>('s' + length, length, empty, encode, decode);
};

/** Unbounded ASCII string that consumes the rest of the buffer ("s" in the DSL). */
export const s = new Handler<string>(
  's',
  0,
  () => '',
  (serializer, data) => {
    const byteCount = Math.min(data.length, serializer.dataView.byteLength - serializer.index);
    for (let idx = 0; idx < byteCount; ++idx) {
      u8.encode(serializer, data.charCodeAt(idx));
    }
    if (serializer.index < serializer.dataView.byteLength) {
      u8.encode(serializer, 0);
    }
  },
  (serializer) => {
    let response = '';
    let byteCount = serializer.dataView.byteLength - serializer.index;
    while (byteCount-- > 0) {
      const charCode = u8.decode(serializer);
      if (!charCode) {
        return response;
      }
      response += String.fromCharCode(charCode);
    }
    return response;
  },
);
s.isBasic = true;

export const arrayUnmasked = (length: number, handler: Handler): Handler<any[]> => {
  const children: Handler[] = [];
  for (let idx = 0; idx < length; ++idx) {
    children.push(handler);
  }
  const result = tupleUnmasked(children);
  result.descriptor = '[' + handler.descriptor + ':' + length + ']';
  return result;
};

export const tupleUnmasked = (children: Handler[]): Handler<any[]> => {
  const encode = (serializer: Serializer, data: any[], masks?: MaskSpec): void => {
    if (masks === true) {
      masks = null;
    }
    children.forEach((child, idx) => {
      child.encode(serializer, data[idx], masks && masks[idx]);
    });
  };
  const decode = (serializer: Serializer): any[] =>
    children.map((child) => child.decode(serializer));
  const empty = (): any[] => children.map((child) => child.empty());
  const fullMask = (): MaskSpec => {
    let nonNullChild = false;
    const result: Record<number, MaskSpec> = {};
    children.forEach((child, idx) => {
      const value = child.fullMask();
      if (value !== null) {
        nonNullChild = true;
        result[idx] = value;
      }
    });
    if (!nonNullChild) {
      return null;
    }
    return result;
  };
  const byteCount = children.reduce((accum, child) => accum + child.byteCount, 0);
  const descriptor = '(' + children.map((child) => child.descriptor).join(',') + ')';
  return new Handler<any[]>(descriptor, byteCount, empty, encode, decode, fullMask);
};

export const arrayMasked = (
  length: number,
  handler: Handler,
  maskBitCount?: number,
): Handler<any[]> => {
  const children: Handler[] = [];
  for (let idx = 0; idx < length; ++idx) {
    children.push(handler);
  }
  const result = tupleMasked(children, maskBitCount);
  const maskSize = (result.byteCount - length * handler.byteCount) * 8;
  result.descriptor = '[/' + maskSize + '/' + handler.descriptor + ':' + length + ']';
  return result;
};

export const tupleMasked = (children: Handler[], maskBitCount?: number): Handler<any[]> => {
  let maskBytes = Math.ceil(children.length / 8);
  if (maskBitCount) {
    maskBytes = Math.max(maskBytes, Math.ceil(maskBitCount / 8));
  }
  const maskHandler = arrayUnmasked(maskBytes, u8);
  const maskArray = (data: any[], masks?: MaskSpec): number[] => {
    if (masks === true) {
      masks = null;
    }
    const mask = zeroArray(maskBytes);
    let extraMask: MaskSpec = null;
    if (masks && 'MASK' in masks) {
      extraMask = masks.MASK;
    }
    children.forEach((child, idx) => {
      const value = data[idx];
      if (extraMask && !extraMask[idx]) {
        return;
      }
      if (!child.isNull(value)) {
        mask[Math.floor(idx / 8)] |= 1 << idx % 8;
      }
    });
    return mask;
  };
  const encode = (serializer: Serializer, data: any[], masks?: MaskSpec): void => {
    const mask = maskArray(data, masks);
    maskHandler.encode(serializer, mask);
    children.forEach((child, idx) => {
      if (hasBit(mask, idx)) {
        child.encode(serializer, data[idx], masks && masks[idx]);
      }
    });
  };
  const decode = (serializer: Serializer): any[] => {
    const mask = maskHandler.decode(serializer);
    return children.map((child, idx) => {
      if (hasBit(mask, idx)) {
        return child.decode(serializer);
      }
      return null;
    });
  };
  const empty = (): any[] => children.map((child) => child.empty());
  const fullMask = (): MaskSpec => {
    const result: Record<string, MaskSpec> = {};
    children.forEach((child, idx) => {
      const value = child.fullMask();
      if (value !== null) {
        result[idx] = value;
      }
    });
    result['MASK'] = children.map(() => true);
    return result;
  };
  const byteCount = children.reduce((accum, child) => accum + child.byteCount, maskBytes);
  const descriptor =
    '(/' + maskBytes * 8 + '/' + children.map((child) => child.descriptor).join(',') + ')';
  return new Handler<any[]>(descriptor, byteCount, empty, encode, decode, fullMask, maskArray);
};

export const mapUnmasked = (children: MapChild[]): Handler<Record<string, any>> => {
  const encode = (serializer: Serializer, data: Record<string, any>, masks?: MaskSpec): void => {
    if (masks === true) {
      masks = null;
    }
    children.forEach((child) => {
      child.handler.encode(serializer, data[child.key], masks && masks[child.key]);
    });
  };
  const decode = (serializer: Serializer): Record<string, any> => {
    const result: Record<string, any> = {};
    children.forEach((child) => {
      result[child.key] = child.handler.decode(serializer);
    });
    return result;
  };
  const empty = (): Record<string, any> => {
    const result: Record<string, any> = {};
    children.forEach((child) => {
      result[child.key] = child.handler.empty();
    });
    return result;
  };
  const fullMask = (): MaskSpec => {
    let nonNullChild = false;
    const result: Record<string, MaskSpec> = {};
    children.forEach((child) => {
      const value = child.handler.fullMask();
      if (value !== null) {
        nonNullChild = true;
        result[child.key] = value;
      }
    });
    if (!nonNullChild) {
      return null;
    }
    return result;
  };
  const byteCount = children.reduce((accum, child) => accum + child.handler.byteCount, 0);
  const descriptor =
    '{' + children.map((child) => child.key + ':' + child.handler.descriptor).join(',') + '}';
  return new Handler(descriptor, byteCount, empty, encode, decode, fullMask);
};

export const mapMasked = (
  children: MapChild[],
  maskBitCount?: number,
): Handler<Record<string, any>> => {
  let maskBytes = Math.ceil(children.length / 8);
  if (maskBitCount) {
    maskBytes = Math.max(maskBytes, Math.ceil(maskBitCount / 8));
  }
  const maskHandler = arrayUnmasked(maskBytes, u8);
  const maskArray = (data: Record<string, any>, masks?: MaskSpec): number[] => {
    if (masks === true) {
      masks = null;
    }
    const mask = zeroArray(maskBytes);
    let extraMask: MaskSpec = null;
    if (masks && 'MASK' in masks) {
      extraMask = masks.MASK;
    }
    children.forEach((child, idx) => {
      const value = data[child.key];
      if (extraMask && !extraMask[child.key]) {
        return;
      }
      if (!child.handler.isNull(value)) {
        mask[Math.floor(idx / 8)] |= 1 << idx % 8;
      }
    });
    return mask;
  };
  const encode = (serializer: Serializer, data: Record<string, any>, masks?: MaskSpec): void => {
    const mask = maskArray(data, masks);
    maskHandler.encode(serializer, mask);
    children.forEach((child, idx) => {
      if (hasBit(mask, idx)) {
        child.handler.encode(serializer, data[child.key], masks && masks[child.key]);
      }
    });
  };
  const decode = (serializer: Serializer): Record<string, any> => {
    const mask = maskHandler.decode(serializer);
    const result: Record<string, any> = {};
    children.forEach((child, idx) => {
      if (hasBit(mask, idx)) {
        result[child.key] = child.handler.decode(serializer);
      }
    });
    return result;
  };
  const empty = (): Record<string, any> => {
    const result: Record<string, any> = {};
    children.forEach((child) => {
      result[child.key] = child.handler.empty();
    });
    return result;
  };
  const fullMask = (): MaskSpec => {
    const result: Record<string, MaskSpec> = {};
    const mask: Record<string, boolean> = {};
    children.forEach((child) => {
      const value = child.handler.fullMask();
      if (value !== null) {
        result[child.key] = value;
      }
      mask[child.key] = true;
    });
    result['MASK'] = mask;
    return result;
  };
  const byteCount = children.reduce((accum, child) => accum + child.handler.byteCount, maskBytes);
  const descriptor =
    '{/' +
    maskBytes * 8 +
    '/' +
    children.map((child) => child.key + ':' + child.handler.descriptor).join(',') +
    '}';
  const handler = new Handler<Record<string, any>>(
    descriptor,
    byteCount,
    empty,
    encode,
    decode,
    fullMask,
    maskArray,
  );
  handler.maskedBytes = (fields: Record<string, unknown>): number =>
    children.reduce((accum, child) => {
      if (!fields[child.key]) {
        return accum;
      }
      return accum + child.handler.byteCount;
    }, maskBytes);
  return handler;
};

/**
 * The handler registry, mirroring FlybrixSerialization._handlers.
 * Contains both basic handlers and composite handler factories.
 */
export const handlers = {
  u8,
  u16,
  u32,
  i8,
  i16,
  i32,
  f32,
  f64,
  bool,
  void: voidHandler,
  s,
  string,
  arrayUnmasked,
  arrayMasked,
  tupleUnmasked,
  tupleMasked,
  mapUnmasked,
  mapMasked,
} as const;
