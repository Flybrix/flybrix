/**
 * Tracks the connected board's firmware version and selects the matching
 * serialization handler library.
 * Ported from flybrix-common/src/firmwareVersion.js (Angular factory ->
 * plain class).
 */
import type { HandlerLibrary } from '@flybrix/protocol';
import { SerializationHandlerRegistry } from './serializationHandler.js';

export class FirmwareVersion {
  private version: number[] = [0, 0, 0];
  private keyString = '0.0.0';
  private readonly desiredVersion: number[];
  private readonly desiredKeyString: string;
  private readonly defaultSerializationHandler: HandlerLibrary | undefined;
  private currentSerializationHandler: HandlerLibrary | undefined;

  constructor(private readonly registry: SerializationHandlerRegistry) {
    const newestVersion = registry.getNewestVersion();
    this.desiredVersion = [newestVersion.major, newestVersion.minor, newestVersion.patch];
    this.desiredKeyString = this.desiredVersion.join('.');
    this.defaultSerializationHandler = registry.getHandler(this.desiredKeyString);
    this.currentSerializationHandler = this.defaultSerializationHandler;
  }

  /**
   * Set the connected firmware version, switching the active handler library
   * to that version's handlers when available (falling back to the newest
   * known handlers otherwise).
   *
   * Note: the legacy code looked up `desiredKey` here (making set() a no-op
   * for handler selection); this port looks up the version actually being
   * set, which is the evident intent.
   */
  set(value: number[]): void {
    this.version = value;
    this.keyString = value.join('.');
    this.currentSerializationHandler =
      this.registry.getHandler(this.keyString) ?? this.defaultSerializationHandler;
  }

  get(): number[] {
    return this.version;
  }

  key(): string {
    return this.keyString;
  }

  supported(): boolean {
    return !!this.registry.getHandler(this.keyString);
  }

  desired(): number[] {
    return this.desiredVersion;
  }

  desiredKey(): string {
    return this.desiredKeyString;
  }

  serializationHandler(): HandlerLibrary | undefined {
    return this.currentSerializationHandler;
  }
}
