// Exercises the real bundled descriptors (1.4/1.5/1.6) end to end.
import { describe, expect, it } from 'vitest';
import {
  descriptorFiles,
  descriptorVersions,
  getHandlersForVersion,
  newestDescriptorVersion,
  Serializer,
  supportedDescriptorVersions,
} from '../src/index.js';

describe('bundled descriptors', () => {
  it('ships the descriptor assets', () => {
    expect(descriptorVersions).toEqual({
      '1.4.0': '1.4.txt',
      '1.5.0': '1.5.txt',
      '1.5.1': '1.5.txt',
      '1.6.0': '1.6.txt',
    });
    expect(Object.keys(descriptorFiles).sort()).toEqual(['1.4.txt', '1.5.txt', '1.6.txt']);
    expect(supportedDescriptorVersions()).toEqual(['1.4.0', '1.5.0', '1.5.1', '1.6.0']);
  });

  it('treats 1.6.0 as newest firmware', () => {
    expect(newestDescriptorVersion()).toEqual({ major: 1, minor: 6, patch: 0 });
  });

  it('returns a parsed handler library per version', () => {
    for (const key of ['1.4.0', '1.5.0', '1.5.1', '1.6.0']) {
      const handlers = getHandlersForVersion(key);
      expect(handlers, key).toBeDefined();
      expect(handlers!.Configuration, key).toBeDefined();
      expect(handlers!.State, key).toBeDefined();
      expect(handlers!.Command, key).toBeDefined();
    }
    expect(getHandlersForVersion('9.9.9')).toBeUndefined();
  });

  it('accepts version tuples and objects', () => {
    expect(getHandlersForVersion([1, 6, 0])).toBe(getHandlersForVersion('1.6.0'));
    expect(getHandlersForVersion({ major: 1, minor: 6, patch: 0 })).toBe(
      getHandlersForVersion('1.6.0'),
    );
  });

  it('shares a single parsed library between versions using the same file', () => {
    expect(getHandlersForVersion('1.5.1')).toBe(getHandlersForVersion('1.5.0'));
    expect(getHandlersForVersion('1.5.0')).not.toBe(getHandlersForVersion('1.6.0'));
  });
});

describe('1.6.0 handlers', () => {
  const handlers = getHandlersForVersion('1.6.0')!;

  it('status flag defaults to full flag', () => {
    expect(handlers.StatusFlag.empty()).toEqual({
      _0: true,
      _1: true,
      _2: true,
      no_signal: true,
      idle: true,
      arming: true,
      recording_sd: true,
      _7: true,
      loop_slow: true,
      _9: true,
      armed: true,
      battery_low: true,
      battery_critical: true,
      log_full: true,
      crash_detected: true,
      override: true,
    });
  });

  it('vector and PID settings default to zeros', () => {
    expect(handlers.Vector3f.empty()).toEqual({ x: 0, y: 0, z: 0 });
    expect(handlers.PIDSettings.empty()).toEqual({
      kp: 0,
      ki: 0,
      kd: 0,
      integral_windup_guard: 0,
      d_filter_time: 0,
      setpoint_filter_time: 0,
      command_to_value: 0,
    });
  });

  it('Configuration.empty() matches ConfigurationFixed.empty()', () => {
    expect(handlers.Configuration.empty()).toEqual(handlers.ConfigurationFixed.empty());
  });

  describe('State round-trip', () => {
    const State = handlers.State;

    it('has the expected mask width (32 bits) baked into its byte count', () => {
      // 4 mask bytes + sum of all field byte counts.
      expect(State.descriptor.startsWith('{/32/')).toBe(true);
    });

    it('round-trips a partial state message', () => {
      const partial = {
        timestamp_us: 0x04030201,
        status: { armed: true, idle: true },
        accel: { x: 1.5, y: -2.25, z: 0.5 },
        motor_out: [1, -2, 3, -4, 5, -6, 7, -8],
        loop_count: 42,
      };

      const buffer = new Uint8Array(State.byteCount);
      const serializer = new Serializer(new DataView(buffer.buffer));
      State.encode(serializer, partial);

      // 4 (state mask) + 4 (timestamp u32) + 2 (status flag mask)
      // + 12 (accel Vector3f) + 16 (motor_out [i16:8]) + 4 (loop_count u32)
      expect(serializer.index).toBe(42);

      const decoded = State.decode(new Serializer(new DataView(buffer.buffer)));
      expect(decoded).toEqual(partial);
    });

    it('omits fields that were not encoded', () => {
      const buffer = new Uint8Array(State.byteCount);
      State.encode(new Serializer(new DataView(buffer.buffer)), { timestamp_us: 7 });
      const decoded = State.decode(new Serializer(new DataView(buffer.buffer)));
      expect(decoded).toEqual({ timestamp_us: 7 });
      expect('accel' in decoded).toBe(false);
    });
  });

  describe('Configuration round-trip', () => {
    const Configuration = handlers.Configuration;

    it('round-trips a partial configuration message', () => {
      const partial = {
        version: { major: 1, minor: 6, patch: 0 },
        name: 'Flybrix',
        mix_table: {
          fz: [1, 1, 1, 1, 1, 1, 1, 1],
          tx: [1, -1, 1, -1, 0, 0, 0, 0],
          ty: [-1, -1, 1, 1, 0, 0, 0, 0],
          tz: [1, -1, -1, 1, 0, 0, 0, 0],
        },
      };

      const buffer = new Uint8Array(Configuration.byteCount);
      const serializer = new Serializer(new DataView(buffer.buffer));
      Configuration.encode(serializer, partial);

      // 2 (config mask /16/) + 3 (version) + 9 (name s9) + 32 (mix table 4x[i8:8])
      expect(serializer.index).toBe(46);
      expect(Configuration.maskedBytes!({ version: true, name: true, mix_table: true })).toBe(46);

      const decoded = Configuration.decode(new Serializer(new DataView(buffer.buffer)));
      expect(decoded).toEqual(partial);
    });

    it('respects an extra MASK when encoding', () => {
      const full = Configuration.empty();
      full.version = { major: 1, minor: 6, patch: 0 };

      const buffer = new Uint8Array(Configuration.byteCount);
      const serializer = new Serializer(new DataView(buffer.buffer));
      Configuration.encode(serializer, full, { MASK: { version: true } });

      expect(serializer.index).toBe(2 + 3);
      const decoded = Configuration.decode(new Serializer(new DataView(buffer.buffer)));
      expect(decoded).toEqual({ version: { major: 1, minor: 6, patch: 0 } });
    });

    it('round-trips a full configuration through the fixed layout', () => {
      const Fixed = handlers.ConfigurationFixed;
      const full = Fixed.empty();
      full.version = { major: 1, minor: 6, patch: 0 };
      full.id = 12345;
      full.name = 'Test';
      full.pcb_transform.orientation = { x: 0.25, y: -0.5, z: 1 };

      const buffer = new Uint8Array(Fixed.byteCount);
      const serializer = new Serializer(new DataView(buffer.buffer));
      Fixed.encode(serializer, full);
      expect(serializer.index).toBe(Fixed.byteCount);

      const decoded = Fixed.decode(new Serializer(new DataView(buffer.buffer)));
      expect(decoded).toEqual(full);
    });
  });
});
