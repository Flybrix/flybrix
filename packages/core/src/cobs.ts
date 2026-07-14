/**
 * COBS (Consistent Overhead Byte Stuffing) framing with the Flybrix
 * XOR-checksum convention. Ported from flybrix-common/src/cobs.js.
 */

export type CobsIssue = 'overflow' | 'short' | 'frame' | 'checksum';

export type CobsOnSuccess = (data: Uint8Array) => void;
export type CobsOnError = (issue: CobsIssue, text: string) => void;

/**
 * Incremental COBS frame reader. Feed it raw bytes as they arrive; complete,
 * checksum-valid packets are delivered to onSuccess (with the leading
 * checksum byte stripped).
 */
export class Reader {
  N: number;
  buffer: Uint8Array;
  ready_for_new_message = true;
  buffer_length = 0;

  constructor(capacity = 2000) {
    this.N = capacity;
    this.buffer = new Uint8Array(capacity);
  }

  readBytes(data: ArrayLike<number>, onSuccess: CobsOnSuccess, onError: CobsOnError): void {
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (this.ready_for_new_message) {
        // first byte of a new message
        this.ready_for_new_message = false;
        this.buffer_length = 0;
      }

      this.buffer[this.buffer_length++] = c;

      if (c) {
        if (this.buffer_length === this.N) {
          // buffer overflow, probably due to errors in data
          onError('overflow', 'buffer overflow in COBS decoding');
          this.ready_for_new_message = true;
        }
        continue;
      }

      this.buffer_length = cobsDecode(this);
      const failed_decode = this.buffer_length === 0;
      if (failed_decode) {
        this.buffer[0] = 1;
      }
      for (let j = 1; j < this.buffer_length; ++j) {
        this.buffer[0] ^= this.buffer[j];
      }
      if (this.buffer[0] === 0) {
        // check sum is correct
        this.ready_for_new_message = true;
        if (this.buffer_length > 0) {
          onSuccess(this.buffer.slice(1, this.buffer_length));
        } else {
          onError('short', 'Too short packet');
        }
      } else {
        // bad checksum
        this.ready_for_new_message = true;
        let bytes = '';
        let message = '';
        for (let j = 0; j < this.buffer_length; j++) {
          bytes += this.buffer[j] + ',';
          message += String.fromCharCode(this.buffer[j]);
        }
        if (failed_decode) {
          onError('frame', 'Unexpected ending of packet');
        } else {
          onError(
            'checksum',
            'BAD CHECKSUM (' + this.buffer_length + ' bytes)' + bytes + message,
          );
        }
      }
    }
  }
}

function cobsDecode(reader: Reader): number {
  let src_ptr = 0;
  let dst_ptr = 0;
  let leftover_length = 0;
  let append_zero = false;
  while (reader.buffer[src_ptr]) {
    if (!leftover_length) {
      if (append_zero) {
        reader.buffer[dst_ptr++] = 0;
      }
      leftover_length = reader.buffer[src_ptr++] - 1;
      append_zero = leftover_length < 0xfe;
    } else {
      --leftover_length;
      reader.buffer[dst_ptr++] = reader.buffer[src_ptr++];
    }
  }
  return leftover_length ? 0 : dst_ptr;
}

/**
 * COBS-encode a buffer. The input is expected to end with a 0 byte, which
 * becomes the frame delimiter in the output.
 *
 * Note: the legacy implementation returned an ArrayBuffer; this returns the
 * equivalent Uint8Array.
 */
export function encode(buf: Uint8Array): Uint8Array {
  const retval = new Uint8Array(Math.floor((buf.byteLength * 255 + 761) / 254));
  let len = 1;
  let pos_ctr = 0;
  for (let i = 0; i < buf.length; ++i) {
    if (retval[pos_ctr] === 0xfe) {
      retval[pos_ctr] = 0xff;
      pos_ctr = len++;
      retval[pos_ctr] = 0;
    }
    const val = buf[i];
    ++retval[pos_ctr];
    if (val) {
      retval[len++] = val;
    } else {
      pos_ctr = len++;
      retval[pos_ctr] = 0;
    }
  }
  return retval.subarray(0, len).slice();
}
