/**
 * Cursor over a DataView used by all encode/decode operations.
 * Ported from flybrix-serialization/src/serializer.js.
 */
export class Serializer {
  index = 0;

  constructor(public dataView: DataView) {}

  add(increment: number): void {
    this.index += increment;
  }
}
