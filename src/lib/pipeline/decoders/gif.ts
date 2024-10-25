import { PipelineError, type RawImageData } from '../types';

function readUint16LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function lzwDecode(minCodeSize: number, encoded: Uint8Array, expectedPixels: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has an invalid LZW code size.');
  }

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  for (let i = 0; i < clearCode; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }

  const output = new Uint8Array(expectedPixels);
  let outPos = 0;

  let bitBuf = 0;
  let bitCount = 0;
  let bytePos = 0;
  let prevCode = -1;
  let firstChar = 0;

  const readCode = (): number => {
    while (bitCount < codeSize) {
      if (bytePos >= encoded.length) return eoiCode;
      bitBuf |= encoded[bytePos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitCount -= codeSize;
    return code;
  };

  while (outPos < expectedPixels) {
    const code = readCode();
    if (code === eoiCode) break;

    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      prevCode = -1;
      continue;
    }

    let curCode = code;
    let stackTop = 0;

    if (curCode >= nextCode) {
      if (prevCode === -1 || curCode > nextCode) {
        throw new PipelineError('CORRUPT_IMAGE', 'This GIF file contains corrupt LZW data.');
      }
      stack[stackTop++] = firstChar;
      curCode = prevCode;
    }

    while (curCode >= clearCode) {
      if (stackTop >= 4096) {
        throw new PipelineError('CORRUPT_IMAGE', 'This GIF file contains a corrupt LZW table.');
      }
      stack[stackTop++] = suffix[curCode];
      curCode = prefix[curCode];
    }

    firstChar = suffix[curCode];
    stack[stackTop++] = firstChar;

    while (stackTop > 0 && outPos < expectedPixels) {
      output[outPos++] = stack[--stackTop];
    }

    if (prevCode !== -1 && nextCode < 4096) {
      prefix[nextCode] = prevCode;
      suffix[nextCode] = firstChar;
      nextCode++;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
    }

    prevCode = code;
  }

  return output;
}

export function decodeGifFirstFrame(bytes: Uint8Array): RawImageData {
  if (bytes.length < 14) {
    throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has a damaged header.');
  }

  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  if (width === 0 || height === 0) {
    throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has invalid dimensions.');
  }

  let pos = 13;
  const gctPacked = bytes[10];
  let gct: Uint8Array | null = null;
  if ((gctPacked & 0x80) !== 0) {
    const size = 3 * (1 << ((gctPacked & 0x07) + 1));
    if (pos + size > bytes.length) {
      throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has a truncated color table.');
    }
    gct = bytes.subarray(pos, pos + size);
    pos += size;
  }

  let transparentIndex = -1;

  while (pos < bytes.length) {
    const block = bytes[pos++];
    if (block === 0x3b) break; // Trailer

    if (block === 0x21) {
      if (pos >= bytes.length) break;
      const label = bytes[pos++];
      if (label === 0xf9 && pos + 5 <= bytes.length && bytes[pos] === 4) {
        const gcePacked = bytes[pos + 1];
        transparentIndex = (gcePacked & 0x01) !== 0 ? bytes[pos + 4] : -1;
        pos += 5;
        if (pos < bytes.length && bytes[pos] === 0) pos++;
      } else {
        while (pos < bytes.length) {
          const subLen = bytes[pos++];
          if (subLen === 0) break;
          pos += subLen;
        }
      }
      continue;
    }

    if (block === 0x2c) {
      if (pos + 9 > bytes.length) {
        throw new PipelineError('CORRUPT_IMAGE', 'This GIF frame descriptor is truncated.');
      }
      const left = readUint16LE(bytes, pos);
      const top = readUint16LE(bytes, pos + 2);
      const frameW = readUint16LE(bytes, pos + 4);
      const frameH = readUint16LE(bytes, pos + 6);
      const localPacked = bytes[pos + 8];
      pos += 9;

      const interlaced = (localPacked & 0x40) !== 0;
      let colorTable = gct;
      if ((localPacked & 0x80) !== 0) {
        const lctSize = 3 * (1 << ((localPacked & 0x07) + 1));
        if (pos + lctSize > bytes.length) {
          throw new PipelineError('CORRUPT_IMAGE', 'This GIF file has a truncated local palette.');
        }
        colorTable = bytes.subarray(pos, pos + lctSize);
        pos += lctSize;
      }

      if (!colorTable) {
        throw new PipelineError('CORRUPT_IMAGE', 'This GIF frame has no color table.');
      }

      if (pos >= bytes.length) {
        throw new PipelineError('CORRUPT_IMAGE', 'This GIF frame is missing image data.');
      }
      const minCodeSize = bytes[pos++];

      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      while (pos < bytes.length) {
        const subLen = bytes[pos++];
        if (subLen === 0) break;
        if (pos + subLen > bytes.length) {
          throw new PipelineError('CORRUPT_IMAGE', 'This GIF image stream is truncated.');
        }
        chunks.push(bytes.subarray(pos, pos + subLen));
        totalLen += subLen;
        pos += subLen;
      }

      const encoded = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        encoded.set(c, offset);
        offset += c.length;
      }

      const indices = lzwDecode(minCodeSize, encoded, frameW * frameH);
      const out = new Uint8ClampedArray(width * height * 4);

      const writeRow = (srcRow: number, dstRow: number) => {
        const canvasY = top + dstRow;
        if (canvasY < 0 || canvasY >= height) return;
        for (let x = 0; x < frameW; x++) {
          const canvasX = left + x;
          if (canvasX < 0 || canvasX >= width) continue;
          const idx = indices[srcRow * frameW + x];
          if (idx === transparentIndex) continue;
          const c = idx * 3;
          if (c + 2 >= colorTable!.length) continue;
          const outIdx = (canvasY * width + canvasX) * 4;
          out[outIdx] = colorTable![c];
          out[outIdx + 1] = colorTable![c + 1];
          out[outIdx + 2] = colorTable![c + 2];
          out[outIdx + 3] = 255;
        }
      };

      if (interlaced) {
        const passes = [
          [0, 8],
          [4, 8],
          [2, 4],
          [1, 2]
        ];
        let srcRow = 0;
        for (const [start, step] of passes) {
          for (let dstRow = start; dstRow < frameH && srcRow < frameH; dstRow += step) {
            writeRow(srcRow++, dstRow);
          }
        }
      } else {
        for (let row = 0; row < frameH; row++) {
          writeRow(row, row);
        }
      }

      return { width, height, data: out };
    }
  }

  throw new PipelineError('CORRUPT_IMAGE', 'This GIF file contains no image frames.');
}
